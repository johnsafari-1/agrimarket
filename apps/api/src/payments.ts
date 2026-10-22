import {
  Injectable,
  Controller,
  Post,
  Param,
  Body,
  Req,
  BadRequestException,
  NotFoundException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Database, rows, run } from './db';
import { Orders } from './orders';
import { Auth } from './auth';
import { ApiRequest, actor, id, parse, text } from './validation';
import { config } from './config';

@Injectable()
export class Payments {
  constructor(
    private readonly db: Database,
    private readonly orders: Orders,
  ) {}
  private enabled() {
    if (!config.MPESA_ENABLED) throw new ServiceUnavailableException('M-Pesa is not configured.');
  }
  private async request(path: string, body?: unknown) {
    this.enabled();
    const base =
      config.MPESA_ENV === 'production'
        ? 'https://api.safaricom.co.ke'
        : 'https://sandbox.safaricom.co.ke';
    const oauth = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(config.MPESA_CONSUMER_KEY + ':' + config.MPESA_CONSUMER_SECRET).toString('base64')}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    const auth = (await oauth.json()) as Record<string, unknown>;
    if (!oauth.ok || typeof auth.access_token !== 'string')
      throw new ServiceUnavailableException('The payment provider is unavailable.');
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new ServiceUnavailableException('The payment provider is unavailable.');
    return (await response.json()) as Record<string, unknown>;
  }
  private credentials() {
    const timestamp = new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
      .format(new Date())
      .replace(/\D/g, '');
    return {
      BusinessShortCode: config.MPESA_SHORTCODE,
      Timestamp: timestamp,
      Password: Buffer.from(config.MPESA_SHORTCODE + config.MPESA_PASSKEY + timestamp).toString(
        'base64',
      ),
    };
  }
  async initiate(userId: number, orderId: number) {
    this.enabled();
    const marker = `node-start-${randomBytes(12).toString('hex')}`;
    const txn = await this.db.transaction(async (c) => {
      const [order] = await rows(
        c,
        'SELECT * FROM orders WHERE order_id=? AND buyer_id=? FOR UPDATE',
        [orderId, userId],
      );
      if (!order) throw new NotFoundException();
      const [t] = await rows(
        c,
        "SELECT * FROM transactions WHERE order_id=? AND payment_method='M-Pesa' ORDER BY txn_id DESC LIMIT 1 FOR UPDATE",
        [orderId],
      );
      if (!t || t.payment_status !== 'Pending' || order.status === 'Cancelled')
        throw new ConflictException('This order cannot start a payment.');
      if (!/^254[17]\d{8}$/.test(t.phone_number ?? '') || !Number.isInteger(Number(t.amount)))
        throw new BadRequestException(
          'This payment needs a valid phone and whole-shilling amount.',
        );
      if (t.checkout_request_id)
        throw new ConflictException(
          'A payment was already initiated. Check its status; do not submit another prompt.',
        );
      await run(c, 'UPDATE transactions SET checkout_request_id=? WHERE txn_id=?', [
        marker,
        t.txn_id,
      ]);
      return t;
    });
    try {
      const result = await this.request('/mpesa/stkpush/v1/processrequest', {
        ...this.credentials(),
        TransactionType: 'CustomerPayBillOnline',
        Amount: Number(txn.amount),
        PartyA: txn.phone_number,
        PartyB: config.MPESA_SHORTCODE,
        PhoneNumber: txn.phone_number,
        CallBackURL: config.MPESA_CALLBACK_URL,
        AccountReference: `Order${orderId}`.slice(0, 12),
        TransactionDesc: 'AgriMarket',
      });
      if (typeof result.CheckoutRequestID !== 'string' || result.ResponseCode !== '0')
        throw new ServiceUnavailableException(
          'The payment initiation outcome is uncertain. Contact support before retrying.',
        );
      await this.db.run(
        'UPDATE transactions SET checkout_request_id=?,merchant_request_id=? WHERE txn_id=? AND checkout_request_id=?',
        [result.CheckoutRequestID, String(result.MerchantRequestID ?? ''), txn.txn_id, marker],
      );
      await this.db.run(
        'INSERT INTO node_payment_jobs (txn_id,available_at) VALUES (?,UTC_TIMESTAMP()+INTERVAL 30 SECOND) ON DUPLICATE KEY UPDATE txn_id=VALUES(txn_id)',
        [txn.txn_id],
      );
      return { message: 'Approve the M-Pesa prompt on your phone, then check payment status.' };
    } catch {
      throw new ServiceUnavailableException(
        'Payment initiation could not be confirmed. This order remains unpaid. Contact support before trying another payment.',
      );
    }
  }
  async reconcile(txnId: number) {
    const [txn] = await this.db.rows(
      "SELECT * FROM transactions WHERE txn_id=? AND payment_method='M-Pesa'",
      [txnId],
    );
    if (
      !txn ||
      txn.payment_status !== 'Pending' ||
      !txn.checkout_request_id ||
      txn.checkout_request_id.startsWith('node-start-')
    )
      return { pending: false };
    const result = await this.request('/mpesa/stkpushquery/v1/query', {
      ...this.credentials(),
      CheckoutRequestID: txn.checkout_request_id,
    });
    // Only a direct, authenticated response for this locally-issued request can affect payment state.
    if (
      result.CheckoutRequestID !== txn.checkout_request_id ||
      (typeof result.ResultCode !== 'string' && typeof result.ResultCode !== 'number') ||
      !/^\d+$/.test(String(result.ResultCode))
    )
      return { pending: true };
    if (result.MerchantRequestID && String(result.MerchantRequestID) !== txn.merchant_request_id)
      throw new ConflictException('Provider reference mismatch.');
    await this.db.transaction(async (c) => {
      const [order] = await rows(c, 'SELECT * FROM orders WHERE order_id=? FOR UPDATE', [
        txn.order_id,
      ]);
      const [current] = await rows(c, 'SELECT * FROM transactions WHERE txn_id=? FOR UPDATE', [
        txnId,
      ]);
      if (current.payment_status !== 'Pending') return;
      if (order.status === 'Cancelled')
        throw new ConflictException(
          'Payment requires manual reconciliation for a cancelled order.',
        );
      const success = String(result.ResultCode) === '0';
      await run(
        c,
        'UPDATE transactions SET payment_status=?,paid_at=IF(?,UTC_TIMESTAMP(),NULL),result_desc=? WHERE txn_id=?',
        [
          success ? 'Completed' : 'Failed',
          Number(success),
          String(result.ResultDesc ?? 'Provider query completed').slice(0, 255),
          txnId,
        ],
      );
      if (success) {
        const farmers = await rows(
          c,
          'SELECT farmer_id,status FROM node_fulfilments WHERE order_id=? ORDER BY farmer_id FOR UPDATE',
          [txn.order_id],
        );
        for (const f of farmers)
          await this.orders.event(
            c,
            txn.order_id,
            f.farmer_id,
            f.status,
            order.buyer_id,
            'Payment verified directly with M-Pesa.',
          );
      }
    });
    return { pending: false };
  }
  async check(userId: number, orderId: number) {
    const [t] = await this.db.rows(
      "SELECT t.txn_id FROM transactions t JOIN orders o ON o.order_id=t.order_id WHERE o.order_id=? AND o.buyer_id=? AND t.payment_method='M-Pesa' ORDER BY t.txn_id DESC LIMIT 1",
      [orderId, userId],
    );
    if (!t) throw new NotFoundException();
    return this.reconcile(t.txn_id);
  }
  async callback(input: unknown) {
    this.enabled();
    const body = parse(
      z.object({ Body: z.object({ stkCallback: z.object({ CheckoutRequestID: text(60) }) }) }),
      input,
    );
    const checkoutId = body.Body.stkCallback.CheckoutRequestID;
    // A callback is an untrusted notification. Ignore its claimed result/amount/receipt.
    await this.db.run(
      `INSERT INTO node_payment_jobs (txn_id) SELECT txn_id FROM transactions WHERE checkout_request_id=? AND payment_method='M-Pesa' AND payment_status='Pending'
      ON DUPLICATE KEY UPDATE available_at=LEAST(available_at,UTC_TIMESTAMP())`,
      [checkoutId],
    );
    return { ResultCode: 0, ResultDesc: 'Accepted for independent verification' };
  }
  async processOne() {
    if (!config.MPESA_ENABLED) return false;
    return this.db.transaction(async (c) => {
      const [job] = await rows(
        c,
        'SELECT * FROM node_payment_jobs WHERE attempts<20 AND available_at<=UTC_TIMESTAMP() ORDER BY available_at LIMIT 1 FOR UPDATE',
      );
      if (!job) return false;
      try {
        const result = await this.reconcile(job.txn_id);
        if (!result.pending) {
          await run(c, 'DELETE FROM node_payment_jobs WHERE txn_id=?', [job.txn_id]);
          return true;
        }
      } catch {
        console.error(`Payment query deferred for transaction ${job.txn_id}.`);
      }
      await run(
        c,
        'UPDATE node_payment_jobs SET attempts=attempts+1,available_at=UTC_TIMESTAMP()+INTERVAL 60 SECOND WHERE txn_id=?',
        [job.txn_id],
      );
      return true;
    });
  }
}
@Controller('payments/mpesa')
export class PaymentsController {
  constructor(
    private readonly payments: Payments,
    private readonly auth: Auth,
  ) {}
  @Post('callback') callback(@Body() body: unknown) {
    return this.payments.callback(body);
  }
  @Post(':id/start') async start(@Req() req: ApiRequest, @Param('id') orderId: string) {
    const u = actor(req, 'Buyer');
    await this.auth.limit('mpesa-start', String(u.user_id), 5);
    return this.payments.initiate(u.user_id, id(orderId));
  }
  @Post(':id/check') async check(@Req() req: ApiRequest, @Param('id') orderId: string) {
    const u = actor(req, 'Buyer');
    await this.auth.limit('mpesa-check', String(u.user_id), 60);
    return this.payments.check(u.user_id, id(orderId));
  }
}
