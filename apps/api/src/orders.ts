import {
  Injectable,
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Headers,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { z } from 'zod';
import { Database, rows, run, Connection } from './db';
import { ApiRequest, Actor, actor, parse, id, text, amount, cents } from './validation';
import { digest } from './auth';
import { config } from './config';

const checkoutInput = z
  .object({
    delivery_address: text(255),
    payment_method: z.enum(['Cash on Delivery', 'M-Pesa']),
    phone_number: z.string().max(20).default(''),
  })
  .strict();
export const states = ['Pending', 'Confirmed', 'Shipped', 'Delivered', 'Cancelled'] as const;
export function overallStatus(statuses: string[]): string {
  const active = statuses.filter((s) => s !== 'Cancelled');
  if (!active.length) return 'Cancelled';
  return states.find((s) => active.includes(s)) ?? 'Pending';
}
@Injectable()
export class Orders {
  constructor(readonly db: Database) {}
  async event(
    c: Connection,
    orderId: number,
    farmerId: number,
    status: string,
    userId: number,
    note: string,
  ) {
    await run(
      c,
      'INSERT INTO node_fulfilment_events (order_id,farmer_id,status,note,actor_id) VALUES (?,?,?,?,?)',
      [orderId, farmerId, status, note, userId],
    );
  }
  async checkout(userId: number, input: unknown, key: unknown) {
    const body = parse(checkoutInput, input),
      requestKey = parse(z.string().regex(/^[a-zA-Z0-9_-]{16,80}$/), key);
    if (body.payment_method === 'M-Pesa') {
      if (!config.MPESA_ENABLED)
        throw new BadRequestException('M-Pesa is not configured. Choose Cash on Delivery.');
      const digits = body.phone_number.replace(/\D/g, '');
      body.phone_number = digits.startsWith('0') ? '254' + digits.slice(1) : digits;
      if (!/^254[17]\d{8}$/.test(body.phone_number))
        throw new BadRequestException('Enter a Kenyan mobile number.');
    }
    const hash = digest(JSON.stringify(body));
    return this.db.transaction(async (c) => {
      await rows(c, 'SELECT user_id FROM users WHERE user_id=? FOR UPDATE', [userId]);
      const [old] = await rows(
        c,
        'SELECT * FROM node_checkouts WHERE buyer_id=? AND request_key=? FOR UPDATE',
        [userId, requestKey],
      );
      if (old) {
        if (old.request_hash !== hash)
          throw new ConflictException('This checkout key was already used for different details.');
        return { order_id: old.order_id };
      }
      const cart = await rows(
        c,
        'SELECT product_id,quantity FROM node_cart WHERE buyer_id=? ORDER BY product_id FOR UPDATE',
        [userId],
      );
      if (!cart.length) throw new BadRequestException('Your cart is empty.');
      const products = [];
      let total = 0;
      for (const item of cart) {
        const [p] = await rows(
          c,
          'SELECT p.*,u.is_active,u.is_verified FROM products p JOIN users u ON u.user_id=p.farmer_id WHERE p.product_id=? FOR UPDATE',
          [item.product_id],
        );
        if (
          !p ||
          !p.is_active ||
          !p.is_verified ||
          p.status !== 'Available' ||
          p.quantity < item.quantity
        )
          throw new ConflictException(
            'A product changed or has insufficient stock. Review your cart.',
          );
        products.push({ p, quantity: item.quantity });
        total += cents(p.price) * item.quantity;
      }
      if (!Number.isSafeInteger(total) || total > 999999999999)
        throw new BadRequestException('Order amount exceeds the supported limit.');
      if (body.payment_method === 'M-Pesa' && total % 100 !== 0)
        throw new BadRequestException(
          'M-Pesa requires a whole-shilling total. Choose Cash on Delivery.',
        );
      const order = await run(
        c,
        "INSERT INTO orders (buyer_id,total_amount,status,delivery_address) VALUES (?,?,'Pending',?)",
        [userId, amount(total), body.delivery_address],
      );
      const farmers = [...new Set(products.map(({ p }) => p.farmer_id))];
      for (const farmer of farmers) {
        await run(c, 'INSERT INTO node_fulfilments (order_id,farmer_id) VALUES (?,?)', [
          order.insertId,
          farmer,
        ]);
        await this.event(c, order.insertId, farmer, 'Pending', userId, 'Order placed.');
      }
      for (const { p, quantity } of products) {
        const item = await run(
          c,
          'INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)',
          [order.insertId, p.product_id, quantity, p.price],
        );
        await run(
          c,
          'INSERT INTO node_order_item_snapshots (item_id,farmer_id,product_name,unit) VALUES (?,?,?,?)',
          [item.insertId, p.farmer_id, p.product_name, p.unit],
        );
        await run(c, 'UPDATE products SET quantity=quantity-? WHERE product_id=?', [
          quantity,
          p.product_id,
        ]);
      }
      await run(
        c,
        "INSERT INTO transactions (order_id,amount,payment_method,phone_number,payment_status) VALUES (?,?,?,?,'Pending')",
        [order.insertId, amount(total), body.payment_method, body.phone_number || null],
      );
      await run(
        c,
        'INSERT INTO node_checkouts (buyer_id,request_key,request_hash,order_id) VALUES (?,?,?,?)',
        [userId, requestKey, hash, order.insertId],
      );
      await run(c, 'DELETE FROM node_cart WHERE buyer_id=?', [userId]);
      return { order_id: order.insertId };
    });
  }
  async list(user: Actor, pageValue: unknown) {
    const page = parse(z.coerce.number().int().min(1).max(10000).default(1), pageValue);
    const condition =
      user.role === 'Buyer'
        ? 'o.buyer_id=?'
        : user.role === 'Farmer'
          ? 'EXISTS (SELECT 1 FROM node_fulfilments f WHERE f.order_id=o.order_id AND f.farmer_id=?)'
          : '1=1';
    const values = user.role === 'Admin' ? [] : [user.user_id];
    const items = await this.db.rows(
      `SELECT o.order_id,o.status,o.order_date,${user.role === 'Farmer' ? '(SELECT SUM(i.quantity*i.unit_price) FROM order_items i JOIN node_order_item_snapshots s ON s.item_id=i.item_id WHERE i.order_id=o.order_id AND s.farmer_id=?)' : 'o.total_amount'} total_amount,
      (SELECT t.payment_status FROM transactions t WHERE t.order_id=o.order_id ORDER BY t.txn_id DESC LIMIT 1) payment_status
      FROM orders o WHERE ${condition} ORDER BY o.order_id DESC LIMIT 25 OFFSET ?`,
      [...(user.role === 'Farmer' ? [user.user_id] : []), ...values, (page - 1) * 24],
    );
    return { items: items.slice(0, 24), page, has_more: items.length > 24 };
  }
  async detail(user: Actor, orderId: number) {
    const [order] = await this.db.rows(
      'SELECT order_id,buyer_id,total_amount,status,delivery_address,order_date FROM orders WHERE order_id=?',
      [orderId],
    );
    if (!order) throw new NotFoundException();
    let fulfilments = await this.db.rows(
      'SELECT f.*,u.full_name farmer_name,u.business_name FROM node_fulfilments f JOIN users u ON u.user_id=f.farmer_id WHERE order_id=? ORDER BY farmer_id',
      [orderId],
    );
    if (user.role === 'Buyer' && order.buyer_id !== user.user_id) throw new NotFoundException();
    if (user.role === 'Farmer')
      fulfilments = fulfilments.filter((f) => f.farmer_id === user.user_id);
    if (!fulfilments.length && user.role === 'Farmer') throw new NotFoundException();
    const items = await this.db.rows(
      `SELECT i.item_id,i.product_id,i.quantity,i.unit_price,s.farmer_id,s.product_name,s.unit FROM order_items i JOIN node_order_item_snapshots s ON s.item_id=i.item_id WHERE i.order_id=? ${user.role === 'Farmer' ? 'AND s.farmer_id=?' : ''}`,
      [orderId, ...(user.role === 'Farmer' ? [user.user_id] : [])],
    );
    const events = await this.db.rows(
      `SELECT event_id,farmer_id,status,note,created_at FROM node_fulfilment_events WHERE order_id=? ${user.role === 'Farmer' ? 'AND farmer_id=?' : ''} ORDER BY event_id`,
      [orderId, ...(user.role === 'Farmer' ? [user.user_id] : [])],
    );
    const payments = await this.db.rows(
      `SELECT txn_id,${user.role === 'Farmer' ? '' : 'amount,'}payment_method,payment_status,paid_at FROM transactions WHERE order_id=? ORDER BY txn_id`,
      [orderId],
    );
    if (user.role === 'Farmer')
      order.total_amount = amount(
        items.reduce((sum, i) => sum + cents(i.unit_price) * i.quantity, 0),
      );
    delete order.buyer_id;
    return { ...order, items, fulfilments, events, payments, mpesa_enabled: config.MPESA_ENABLED };
  }
  async refreshOverall(c: Connection, orderId: number) {
    const fulfilments = await rows(
      c,
      'SELECT status FROM node_fulfilments WHERE order_id=? ORDER BY farmer_id FOR UPDATE',
      [orderId],
    );
    const status = overallStatus(fulfilments.map((f) => f.status));
    await run(c, 'UPDATE orders SET status=? WHERE order_id=?', [status, orderId]);
    if (status === 'Delivered')
      await run(
        c,
        "UPDATE transactions SET payment_status='Completed',paid_at=UTC_TIMESTAMP() WHERE order_id=? AND payment_method='Cash on Delivery' AND payment_status='Pending'",
        [orderId],
      );
    return status;
  }
  async transition(user: Actor, orderId: number, farmerId: number, input: unknown) {
    const body = parse(
      z
        .object({
          status: z.enum(states),
          version: z.number().int().min(0),
          note: text(500, 0).default(''),
          estimated_delivery_date: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          estimated_delivery_window: z.enum(['Morning', 'Afternoon', 'Evening']).optional(),
        })
        .strict(),
      input,
    );
    if (body.estimated_delivery_date) {
      const d = new Date(body.estimated_delivery_date);
      if (
        !Number.isFinite(d.getTime()) ||
        d.toISOString().slice(0, 10) !== body.estimated_delivery_date ||
        body.estimated_delivery_date < new Date().toISOString().slice(0, 10)
      )
        throw new BadRequestException('Choose a valid future delivery date.');
    }
    return this.db.transaction(async (c) => {
      const [order] = await rows(c, 'SELECT * FROM orders WHERE order_id=? FOR UPDATE', [orderId]);
      const [f] = await rows(
        c,
        'SELECT * FROM node_fulfilments WHERE order_id=? AND farmer_id=? FOR UPDATE',
        [orderId, farmerId],
      );
      if (
        !order ||
        !f ||
        (user.role === 'Farmer' && farmerId !== user.user_id) ||
        (user.role === 'Buyer' && order.buyer_id !== user.user_id)
      )
        throw new NotFoundException();
      if (f.version !== body.version)
        throw new ConflictException('This delivery changed. Refresh before updating.');
      const transitions: Record<string, string[]> = {
        Pending: ['Confirmed', 'Cancelled'],
        Confirmed: ['Shipped', 'Cancelled'],
        Shipped: ['Delivered'],
        Delivered: [],
        Cancelled: [],
      };
      if (
        !transitions[f.status]?.includes(body.status) ||
        (user.role === 'Buyer' && (body.status !== 'Cancelled' || f.status !== 'Pending'))
      )
        throw new ConflictException('This status change is not allowed.');
      const payments = await rows(
        c,
        'SELECT * FROM transactions WHERE order_id=? ORDER BY txn_id FOR UPDATE',
        [orderId],
      );
      if (
        body.status === 'Cancelled' &&
        payments.some((p) => p.payment_method !== 'Cash on Delivery')
      )
        throw new ConflictException(
          'Online-payment cancellations require reconciliation/refund review.',
        );
      if (
        body.status === 'Confirmed' &&
        payments.some(
          (p) => p.payment_method !== 'Cash on Delivery' && p.payment_status !== 'Completed',
        )
      )
        throw new ConflictException('Online payment must be verified before confirmation.');
      if (
        body.status === 'Confirmed' &&
        (!body.estimated_delivery_date || !body.estimated_delivery_window)
      )
        throw new BadRequestException('Set an estimated delivery date and window.');
      await run(
        c,
        'UPDATE node_fulfilments SET status=?,version=version+1,estimated_delivery_date=COALESCE(?,estimated_delivery_date),estimated_delivery_window=COALESCE(?,estimated_delivery_window) WHERE order_id=? AND farmer_id=?',
        [
          body.status,
          body.estimated_delivery_date ?? null,
          body.estimated_delivery_window ?? null,
          orderId,
          farmerId,
        ],
      );
      if (body.status === 'Cancelled') {
        const items = await rows(
          c,
          'SELECT i.* FROM order_items i JOIN node_order_item_snapshots s ON s.item_id=i.item_id WHERE i.order_id=? AND s.farmer_id=? ORDER BY i.product_id',
          [orderId, farmerId],
        );
        for (const item of items)
          await run(c, 'UPDATE products SET quantity=quantity+? WHERE product_id=?', [
            item.quantity,
            item.product_id,
          ]);
        const cancelled = items.reduce((sum, i) => sum + cents(i.unit_price) * i.quantity, 0);
        await run(c, 'UPDATE orders SET total_amount=total_amount-? WHERE order_id=?', [
          amount(cancelled),
          orderId,
        ]);
        await run(
          c,
          "UPDATE transactions SET amount=amount-? WHERE order_id=? AND payment_method='Cash on Delivery' AND payment_status='Pending'",
          [amount(cancelled), orderId],
        );
      }
      await this.event(
        c,
        orderId,
        farmerId,
        body.status,
        user.user_id,
        body.note || `Delivery ${body.status.toLowerCase()}.`,
      );
      const overall = await this.refreshOverall(c, orderId);
      if (overall === 'Cancelled')
        await run(
          c,
          "UPDATE transactions SET payment_status='Failed',result_desc='Order cancelled' WHERE order_id=? AND payment_method='Cash on Delivery' AND payment_status='Pending'",
          [orderId],
        );
      return { status: body.status, version: body.version + 1 };
    });
  }
}
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: Orders) {}
  @Post() checkout(
    @Req() req: ApiRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') key: string,
  ) {
    return this.orders.checkout(actor(req, 'Buyer').user_id, body, key);
  }
  @Get() list(@Req() req: ApiRequest, @Query('page') page: string) {
    return this.orders.list(actor(req), page);
  }
  @Get(':id') detail(@Req() req: ApiRequest, @Param('id') orderId: string) {
    return this.orders.detail(actor(req), id(orderId));
  }
  @Post(':id/fulfilments/:farmerId') transition(
    @Req() req: ApiRequest,
    @Param('id') orderId: string,
    @Param('farmerId') farmerId: string,
    @Body() body: unknown,
  ) {
    return this.orders.transition(actor(req), id(orderId), id(farmerId), body);
  }
}
