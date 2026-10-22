import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { Database, rows, run } from './db';
import { Catalogue } from './catalogue';
import { ApiRequest, actor, parse, id } from './validation';
export const csvCell = (value: unknown) =>
  '"' +
  String(value ?? '')
    .replace(/^[\s]*[=+@\-\t\r]/, "'$&")
    .replaceAll('"', '""') +
  '"';
@Controller('admin')
export class AdminController {
  constructor(
    private readonly db: Database,
    private readonly catalogue: Catalogue,
  ) {}
  @Get('summary') async summary(@Req() req: ApiRequest) {
    actor(req, 'Admin');
    const [result] = await this.db
      .rows(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM products) products,
      (SELECT COUNT(*) FROM orders) orders,(SELECT COALESCE(SUM(amount),0) FROM transactions WHERE payment_status='Completed') paid_revenue,
      (SELECT COUNT(*) FROM node_mail_outbox WHERE sent_at IS NULL AND attempts>=8) failed_emails,
      (SELECT COUNT(*) FROM node_payment_jobs WHERE attempts>=20) payment_reviews`);
    return result;
  }
  @Get('users') users(@Req() req: ApiRequest, @Query('page') pageValue: string) {
    actor(req, 'Admin');
    const page = parse(z.coerce.number().int().min(1).max(10000).default(1), pageValue);
    return this.db.rows(
      'SELECT user_id,full_name,email,role,phone,location,business_name,is_active,is_verified,created_at FROM users ORDER BY user_id DESC LIMIT 24 OFFSET ?',
      [(page - 1) * 24],
    );
  }
  @Post('users/:id/status') async status(
    @Req() req: ApiRequest,
    @Param('id') userId: string,
    @Body() input: unknown,
  ) {
    const admin = actor(req, 'Admin'),
      target = id(userId),
      b = parse(z.object({ is_active: z.boolean() }).strict(), input);
    if (admin.user_id === target)
      throw new ConflictException('You cannot deactivate your own account.');
    return this.db.transaction(async (c) => {
      // Admin rows lock in a stable order before a possible admin status change.
      const admins = await rows(
        c,
        "SELECT user_id,is_active FROM users WHERE role='Admin' ORDER BY user_id FOR UPDATE",
      );
      const [u] = await rows(c, 'SELECT user_id,role FROM users WHERE user_id=? FOR UPDATE', [
        target,
      ]);
      if (!u) throw new NotFoundException();
      if (
        u.role === 'Admin' &&
        !b.is_active &&
        admins.filter((a) => a.is_active && a.user_id !== target).length === 0
      )
        throw new ConflictException('Keep at least one active administrator.');
      await run(c, 'UPDATE users SET is_active=? WHERE user_id=?', [Number(b.is_active), target]);
      if (!b.is_active) await run(c, 'DELETE FROM node_sessions WHERE user_id=?', [target]);
      await run(c, 'INSERT INTO node_audit (actor_id,action,target_id) VALUES (?,?,?)', [
        admin.user_id,
        b.is_active ? 'user.activated' : 'user.deactivated',
        target,
      ]);
      return { message: 'Account status updated.' };
    });
  }
  @Get('products') products(@Req() req: ApiRequest, @Query() q: unknown) {
    actor(req, 'Admin');
    return this.catalogue.list(q, undefined, true);
  }
  @Post('products/:id/archive') async archive(
    @Req() req: ApiRequest,
    @Param('id') productId: string,
  ) {
    const u = actor(req, 'Admin');
    await this.db.transaction(async (c) => {
      const r = await run(c, "UPDATE products SET status='Unavailable' WHERE product_id=?", [
        id(productId),
      ]);
      if (!r.affectedRows) throw new NotFoundException();
      await run(c, 'INSERT INTO node_audit (actor_id,action,target_id) VALUES (?,?,?)', [
        u.user_id,
        'product.archived',
        id(productId),
      ]);
    });
    return { message: 'Listing archived.' };
  }
  @Get('report.csv') async report(@Req() req: ApiRequest, @Res() res: Response) {
    actor(req, 'Admin');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agrimarket-orders.csv"');
    res.write(
      ['Order', 'Buyer', 'Amount (KES)', 'Status', 'Placed (UTC)'].map(csvCell).join(',') + '\r\n',
    );
    let after = 0;
    for (;;) {
      const orders = await this.db.rows(
        'SELECT o.order_id,u.full_name,o.total_amount,o.status,o.order_date FROM orders o JOIN users u ON u.user_id=o.buyer_id WHERE o.order_id>? ORDER BY o.order_id LIMIT 500',
        [after],
      );
      if (!orders.length) break;
      for (const o of orders) {
        if (res.destroyed) return;
        res.write(
          [o.order_id, o.full_name, o.total_amount, o.status, o.order_date].map(csvCell).join(',') +
            '\r\n',
        );
        after = o.order_id;
      }
    }
    res.end();
  }
}
