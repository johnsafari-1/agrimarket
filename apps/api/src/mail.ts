import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';
import { config } from './config';
import { Database, Connection, run, rows } from './db';

@Injectable()
export class Mail {
  constructor(private readonly db: Database) {}
  async queue(c: Connection, email: string, purpose: 'reset' | 'verification', token: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(config.MAIL_ENCRYPTION_KEY, 'hex'),
      iv,
    );
    const payload = JSON.stringify({ email, purpose, token });
    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    await run(c, 'INSERT INTO node_mail_outbox (payload) VALUES (?)', [
      [iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(
        '.',
      ),
    ]);
  }
  async deliverOne(): Promise<boolean> {
    return this.db.transaction(async (c) => {
      const [mail] = await rows(
        c,
        'SELECT * FROM node_mail_outbox WHERE sent_at IS NULL AND attempts<8 AND available_at<=UTC_TIMESTAMP() ORDER BY mail_id LIMIT 1 FOR UPDATE',
      );
      if (!mail) return false;
      try {
        const [iv, tag, data] = mail.payload.split('.');
        const decipher = createDecipheriv(
          'aes-256-gcm',
          Buffer.from(config.MAIL_ENCRYPTION_KEY, 'hex'),
          Buffer.from(iv, 'hex'),
        );
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
        const message = JSON.parse(
          Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]).toString(),
        );
        const link = `${config.APP_ORIGIN}/${message.purpose === 'reset' ? 'reset-password' : 'verify-email'}#token=${message.token}`;
        const transport = nodemailer.createTransport({
          host: config.SMTP_HOST,
          port: config.SMTP_PORT,
          secure: config.SMTP_SECURE,
          requireTLS: config.NODE_ENV === 'production',
          ...(config.SMTP_USER
            ? { auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } }
            : {}),
          connectionTimeout: 10000,
          socketTimeout: 15000,
        });
        await transport.sendMail({
          from: config.MAIL_FROM,
          to: message.email,
          subject:
            message.purpose === 'reset'
              ? 'Reset your AgriMarket password'
              : 'Verify your AgriMarket email',
          text: `Open this link to ${message.purpose === 'reset' ? 'reset your password (valid for one hour)' : 'verify your email (valid for 24 hours)'}:\n${link}\nIf you did not request this, ignore this email.`,
        });
        await run(
          c,
          "UPDATE node_mail_outbox SET sent_at=UTC_TIMESTAMP(),payload='' WHERE mail_id=?",
          [mail.mail_id],
        );
      } catch {
        await run(
          c,
          'UPDATE node_mail_outbox SET attempts=attempts+1,available_at=TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP()) WHERE mail_id=?',
          [Math.min(3600, 30 * 2 ** mail.attempts), mail.mail_id],
        );
        console.error(`Email delivery deferred for outbox record ${mail.mail_id}.`);
      }
      return true;
    });
  }
}
