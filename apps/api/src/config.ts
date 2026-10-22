import 'dotenv/config';
import { z } from 'zod';
import { resolve } from 'node:path';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),
  DB_NAME: z.string().regex(/^[a-zA-Z0-9_]+$/),
  COOKIE_SECURE: bool,
  TRUST_PROXY: z.enum(['', 'loopback']).default(''),
  MAIL_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().default(''),
  SMTP_PASSWORD: z.string().default(''),
  MAIL_FROM: z.string().default('AgriMarket <noreply@agrimarket.local>'),
  UPLOAD_DIR: z.string().default('../../storage/node-uploads'),
  MPESA_ENABLED: bool,
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().default(''),
  MPESA_CONSUMER_SECRET: z.string().default(''),
  MPESA_SHORTCODE: z.string().default(''),
  MPESA_PASSKEY: z.string().default(''),
  MPESA_CALLBACK_URL: z.string().default(''),
});
export const config = schema.parse(process.env);
if (new URL(config.APP_ORIGIN).origin !== config.APP_ORIGIN)
  throw new Error('APP_ORIGIN must be an origin without a trailing slash/path.');
if (
  config.NODE_ENV === 'production' &&
  (!config.COOKIE_SECURE || !config.APP_ORIGIN.startsWith('https://'))
) {
  throw new Error('Production requires HTTPS APP_ORIGIN and COOKIE_SECURE=true.');
}
if (
  config.MPESA_ENABLED &&
  (!config.MPESA_CONSUMER_KEY ||
    !config.MPESA_CONSUMER_SECRET ||
    !config.MPESA_SHORTCODE ||
    !config.MPESA_PASSKEY ||
    !config.MPESA_CALLBACK_URL.startsWith('https://'))
) {
  throw new Error('Enabled M-Pesa requires credentials and an HTTPS callback URL.');
}
export const uploadDir = resolve(config.UPLOAD_DIR);
