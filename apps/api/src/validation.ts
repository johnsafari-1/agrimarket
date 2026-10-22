import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';
import { Request } from 'express';
export type Role = 'Buyer' | 'Farmer' | 'Admin';
export interface Actor {
  user_id: number;
  full_name: string;
  email: string;
  role: Role;
  phone: string | null;
  location: string | null;
  business_name: string | null;
}
export interface Session {
  id: string;
  csrf: string;
  actor: Actor | null;
}
export interface ApiRequest extends Request {
  session?: Session;
}
export function actor(req: ApiRequest, ...roles: Role[]): Actor {
  if (!req.session?.actor || (roles.length && !roles.includes(req.session.actor.role)))
    throw new ForbiddenException('You do not have access to this action.');
  return req.session.actor;
}
export function parse<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return result.data;
}
export const id = (value: unknown) =>
  parse(z.coerce.number().int().positive().max(2147483647), value);
export const text = (max: number, min = 1) => z.string().trim().min(min).max(max);
export const password = z
  .string()
  .refine(
    (v) => [...v].length >= 15 && Buffer.byteLength(v) <= 72 && !v.includes('\0'),
    'Use at least 15 characters and at most 72 bytes, without null characters.',
  );
export const email = z.string().trim().toLowerCase().pipe(z.email().max(150));
export const categories = [
  'Cereals',
  'Vegetables',
  'Fruits',
  'Dairy',
  'Poultry',
  'Livestock',
  'Tubers',
  'Other',
] as const;
export const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine(
    (v) => /^\d{1,8}(\.\d{1,2})?$/.test(v) && Number(v) > 0,
    'Enter a positive amount with at most two decimal places.',
  );
export function cents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
export function amount(value: number): string {
  return (value / 100).toFixed(2);
}
