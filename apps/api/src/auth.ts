import {
  Injectable,
  Controller,
  Get,
  Post,
  Body,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
  HttpException,
  ForbiddenException,
} from '@nestjs/common';
import { Response, NextFunction } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Database, rows, run, Row } from './db';
import { Mail } from './mail';
import { config } from './config';
import { ApiRequest, Actor, Session, parse, email, password, text } from './validation';

export const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('hex');
const dummy = '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q';
const cookie = 'agri_session';
const generic = {
  message: 'If these details match an eligible account, an email will arrive shortly.',
};
const safeUser = (u: Row): Actor => ({
  user_id: u.user_id,
  full_name: u.full_name,
  email: u.email,
  role: u.role,
  phone: u.phone,
  location: u.location,
  business_name: u.business_name,
});
export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  if (Buffer.byteLength(value) > 72 || value.includes('\0')) return false;
  if (!/^\$2[aby]\$\d{2}\$/.test(hash)) return false;
  // PHP's $2y$ bcrypt hashes use the same corrected algorithm as $2b$.
  return bcrypt.compare(value, hash.replace(/^\$2y\$/, '$2b$'));
}
@Injectable()
export class Auth {
  constructor(
    private readonly db: Database,
    private readonly mail: Mail,
  ) {}
  async limit(scope: string, address: string, maximum = 20) {
    const key = digest(`node:${scope}|${address}`);
    const allowed = await this.db.transaction(async (c) => {
      await run(
        c,
        'INSERT INTO auth_rate_limits (bucket_key,attempts,started_at) VALUES (?,0,UTC_TIMESTAMP()) ON DUPLICATE KEY UPDATE bucket_key=VALUES(bucket_key)',
        [key],
      );
      const [bucket] = await rows(
        c,
        'SELECT attempts,started_at<=UTC_TIMESTAMP()-INTERVAL 15 MINUTE expired FROM auth_rate_limits WHERE bucket_key=? FOR UPDATE',
        [key],
      );
      const count = bucket.expired ? 1 : Math.min(bucket.attempts + 1, maximum + 1);
      await run(
        c,
        'UPDATE auth_rate_limits SET attempts=?,started_at=IF(?,UTC_TIMESTAMP(),started_at) WHERE bucket_key=?',
        [count, Number(bucket.expired), key],
      );
      return count <= maximum;
    });
    if (!allowed) throw new HttpException('Too many attempts. Try again in 15 minutes.', 429);
  }
  async create(res: Response, user?: Row, previous?: Session): Promise<Session> {
    const raw = token(),
      csrf = token();
    await this.db.transaction(async (c) => {
      if (previous) await run(c, 'DELETE FROM node_sessions WHERE session_id=?', [previous.id]);
      await run(
        c,
        'INSERT INTO node_sessions (session_id,csrf_token,user_id,fingerprint,created_at,last_seen) VALUES (?,?,?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())',
        [digest(raw), csrf, user?.user_id ?? null, user ? digest(user.password_hash) : null],
      );
    });
    res.cookie(cookie, raw, {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.COOKIE_SECURE,
      path: '/',
      maxAge: 12 * 60 * 60 * 1000,
    });
    return { id: digest(raw), csrf, actor: user ? safeUser(user) : null };
  }
  async load(req: ApiRequest) {
    const raw = req.cookies?.[cookie];
    if (typeof raw !== 'string' || !/^[a-f0-9]{64}$/.test(raw)) return;
    const [s] = await this.db.rows(
      `SELECT s.*,u.full_name,u.email,u.role,u.phone,u.location,u.business_name,u.password_hash,u.is_active,u.is_verified,
      s.last_seen>UTC_TIMESTAMP()-INTERVAL 30 MINUTE AND s.created_at>UTC_TIMESTAMP()-INTERVAL 12 HOUR valid_time
      FROM node_sessions s LEFT JOIN users u ON u.user_id=s.user_id WHERE session_id=?`,
      [digest(raw)],
    );
    if (!s) return;
    if (
      !s.valid_time ||
      (s.user_id && (!s.is_active || !s.is_verified || s.fingerprint !== digest(s.password_hash)))
    ) {
      await this.db.run('DELETE FROM node_sessions WHERE session_id=?', [s.session_id]);
      return;
    }
    await this.db.run('UPDATE node_sessions SET last_seen=UTC_TIMESTAMP() WHERE session_id=?', [
      s.session_id,
    ]);
    req.session = { id: s.session_id, csrf: s.csrf_token, actor: s.user_id ? safeUser(s) : null };
  }
  middleware = async (req: ApiRequest, res: Response, next: NextFunction) => {
    try {
      if (req.path === '/api/payments/mpesa/callback' && req.method === 'POST') {
        return next();
      }
      await this.load(req);
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        if (req.get('origin') !== config.APP_ORIGIN)
          throw new ForbiddenException('Request origin is not allowed.');
        const csrf = req.get('x-csrf-token') ?? '';
        if (
          !req.session ||
          !/^[a-f0-9]{64}$/.test(csrf) ||
          !timingSafeEqual(Buffer.from(csrf), Buffer.from(req.session.csrf))
        )
          throw new ForbiddenException('Refresh this page and try again.');
      }
      next();
    } catch (error: any) {
      res.status(typeof error.getStatus === 'function' ? error.getStatus() : 503).json({
        message:
          typeof error.getStatus === 'function'
            ? error.message
            : 'The service is temporarily unavailable.',
      });
    }
  };
  async login(address: string, input: unknown): Promise<Row> {
    await this.limit('login', address);
    const body = parse(z.object({ email, password: z.string().min(1).max(1024) }).strict(), input);
    const result = await this.db.transaction(async (c) => {
      const [u] = await rows(
        c,
        'SELECT *,locked_until>UTC_TIMESTAMP() locked FROM users WHERE email=? FOR UPDATE',
        [body.email],
      );
      const valid = await verifyPassword(body.password, u?.password_hash ?? dummy);
      if (!u || !valid || u.locked || !u.is_active || !u.is_verified) {
        if (u && !valid && !u.locked) {
          const count = u.locked_until ? 1 : Math.min(5, u.failed_login_attempts + 1);
          await run(
            c,
            'UPDATE users SET failed_login_attempts=?,locked_until=IF(? >= 5,UTC_TIMESTAMP()+INTERVAL 15 MINUTE,NULL) WHERE user_id=?',
            [count, count, u.user_id],
          );
        }
        return null;
      }
      if (bcrypt.getRounds(u.password_hash) < 12) {
        u.password_hash = await bcrypt.hash(body.password, 12);
        await run(c, 'UPDATE users SET password_hash=? WHERE user_id=?', [
          u.password_hash,
          u.user_id,
        ]);
      }
      await run(c, 'UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE user_id=?', [
        u.user_id,
      ]);
      return u;
    });
    if (!result) throw new UnauthorizedException('Unable to sign in with these details.');
    return result;
  }
  async register(address: string, input: unknown) {
    await this.limit('register', address, 5);
    const body = parse(
      z
        .object({
          full_name: text(100),
          email,
          password,
          role: z.enum(['Buyer', 'Farmer']),
          phone: text(20, 0),
          national_id: z.string().regex(/^\d{6,10}$/),
          location: text(150, 2),
          business_name: text(150, 0).default(''),
        })
        .strict()
        .refine((v) => v.role !== 'Farmer' || v.business_name.length > 0, {
          message: 'Farmers need a farm/business name.',
          path: ['business_name'],
        }),
      input,
    );
    const hash = await bcrypt.hash(body.password, 12),
      raw = token();
    try {
      await this.db.transaction(async (c) => {
        await run(
          c,
          `INSERT INTO users (full_name,email,password_hash,role,phone,national_id,location,business_name,is_verified,verification_token,verification_sent_at)
          VALUES (?,?,?,?,?,?,?,?,0,?,UTC_TIMESTAMP())`,
          [
            body.full_name,
            body.email,
            hash,
            body.role,
            body.phone,
            body.national_id,
            body.location,
            body.role === 'Farmer' ? body.business_name : null,
            digest(raw),
          ],
        );
        await this.mail.queue(c, body.email, 'verification', raw);
      });
    } catch (error: any) {
      if (error.code !== 'ER_DUP_ENTRY') throw error;
    }
    return generic;
  }
  async issue(address: string, input: unknown, purpose: 'reset' | 'verification') {
    await this.limit(purpose, address, 5);
    const body = parse(z.object({ email }).strict(), input);
    const field = purpose === 'reset' ? 'reset_token' : 'verification_token',
      sent = purpose === 'reset' ? 'reset_sent_at' : 'verification_sent_at';
    await this.db.transaction(async (c) => {
      const [u] = await rows(
        c,
        `SELECT *,(${sent} IS NULL OR ${sent}<UTC_TIMESTAMP()-INTERVAL 60 SECOND) can_send FROM users WHERE email=? FOR UPDATE`,
        [body.email],
      );
      if (!u || !u.is_active || !u.can_send || (purpose === 'verification' && u.is_verified))
        return;
      const raw = token();
      await run(c, `UPDATE users SET ${field}=?,${sent}=UTC_TIMESTAMP() WHERE user_id=?`, [
        digest(raw),
        u.user_id,
      ]);
      await this.mail.queue(c, u.email, purpose, raw);
    });
    return generic;
  }
  async consume(address: string, input: unknown, purpose: 'reset' | 'verification') {
    await this.limit(`consume-${purpose}`, address, 10);
    const body = parse(
      z
        .object({
          token: z.string().regex(/^[a-f0-9]{64}$/),
          ...(purpose === 'reset' ? { password } : {}),
        })
        .strict(),
      input,
    ) as { token: string; password?: string };
    const field = purpose === 'reset' ? 'reset_token' : 'verification_token',
      sent = purpose === 'reset' ? 'reset_sent_at' : 'verification_sent_at';
    const update =
      purpose === 'reset'
        ? 'password_hash=?,failed_login_attempts=0,locked_until=NULL'
        : 'is_verified=1';
    const hashed = body.password ? await bcrypt.hash(body.password, 12) : null;
    const result = await this.db.run(
      `UPDATE users SET ${update},${field}=NULL,${sent}=NULL WHERE ${field}=? AND is_active=1
      ${purpose === 'verification' ? 'AND is_verified=0' : ''} AND ${sent} BETWEEN UTC_TIMESTAMP()-INTERVAL ${purpose === 'reset' ? '1 HOUR' : '1 DAY'} AND UTC_TIMESTAMP()`,
      [...(hashed ? [hashed] : []), digest(body.token)],
    );
    if (result.affectedRows !== 1) throw new BadRequestException('Invalid or expired link.');
    return {
      message:
        purpose === 'reset'
          ? 'Password updated. Sign in again.'
          : 'Email verified. You can sign in.',
    };
  }
}
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: Auth) {}
  @Get('session') async session(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const session = req.session ?? (await this.auth.create(res));
    return { user: session.actor, csrf: session.csrf };
  }
  @Post('login') async login(
    @Req() req: ApiRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    const user = await this.auth.login(req.ip ?? req.socket.remoteAddress ?? 'unknown', body);
    const session = await this.auth.create(res, user, req.session);
    return { user: session.actor, csrf: session.csrf };
  }
  @Post('logout') async logout(@Req() req: ApiRequest, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.create(res, undefined, req.session);
    return { user: null, csrf: session.csrf };
  }
  @Post('register') register(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.auth.register(req.ip ?? req.socket.remoteAddress ?? 'unknown', body);
  }
  @Post('forgot-password') forgot(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.auth.issue(req.ip ?? req.socket.remoteAddress ?? 'unknown', body, 'reset');
  }
  @Post('resend-verification') resend(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.auth.issue(req.ip ?? req.socket.remoteAddress ?? 'unknown', body, 'verification');
  }
  @Post('reset-password') reset(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.auth.consume(req.ip ?? req.socket.remoteAddress ?? 'unknown', body, 'reset');
  }
  @Post('verify-email') verify(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.auth.consume(req.ip ?? req.socket.remoteAddress ?? 'unknown', body, 'verification');
  }
}
