import {
  Injectable,
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { z } from 'zod';
import { Database, rows, run } from './db';
import { Auth } from './auth';
import { ApiRequest, Actor, actor, parse, id, text, categories, money } from './validation';
@Injectable()
export class Community {
  constructor(readonly db: Database) {}
  async requests(user: Actor, pageValue: unknown) {
    const page = parse(z.coerce.number().int().min(1).max(10000).default(1), pageValue);
    const items = await this.db.rows(
      `SELECT r.*,u.full_name buyer_name FROM product_requests r JOIN users u ON u.user_id=r.buyer_id
      WHERE ${user.role === 'Buyer' ? 'r.buyer_id=?' : "r.status='Open' AND u.is_active=1"} ORDER BY r.request_id DESC LIMIT 25 OFFSET ?`,
      [...(user.role === 'Buyer' ? [user.user_id] : []), (page - 1) * 24],
    );
    for (const request of items.slice(0, 24))
      request.offers = await this.db.rows(
        `SELECT o.*,u.full_name farmer_name,p.product_name FROM request_offers o JOIN users u ON u.user_id=o.farmer_id LEFT JOIN products p ON p.product_id=o.product_id WHERE o.request_id=? ${user.role === 'Farmer' ? 'AND o.farmer_id=?' : ''} ORDER BY o.offer_id`,
        [request.request_id, ...(user.role === 'Farmer' ? [user.user_id] : [])],
      );
    return { items: items.slice(0, 24), page, has_more: items.length > 24 };
  }
  async create(buyerId: number, input: unknown) {
    const b = parse(
      z
        .object({
          title: text(150),
          description: text(10000, 10),
          category: z.enum(categories),
          quantity: z.number().int().min(1).max(10000000),
          unit: text(30),
          budget_max: money.nullable().default(null),
        })
        .strict(),
      input,
    );
    const result = await this.db.run(
      'INSERT INTO product_requests (buyer_id,title,description,category,quantity,unit,budget_max) VALUES (?,?,?,?,?,?,?)',
      [buyerId, b.title, b.description, b.category, b.quantity, b.unit, b.budget_max],
    );
    const words = b.title
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
      .slice(0, 6);
    const matches = await this.db.rows(
      `SELECT p.product_id,p.product_name,p.price,p.unit FROM products p JOIN users u ON u.user_id=p.farmer_id WHERE p.status='Available' AND p.quantity>0 AND u.is_active=1 AND u.is_verified=1 AND p.category=? ${words.length ? `AND (${words.map(() => 'p.product_name LIKE ?').join(' OR ')})` : ''} ORDER BY p.product_id DESC LIMIT 6`,
      [b.category, ...words.map((w) => `%${w}%`)],
    );
    return { request_id: result.insertId, matches };
  }
  async offer(farmerId: number, requestId: number, input: unknown) {
    const b = parse(
      z
        .object({
          message: text(2000),
          price: money,
          product_id: z.number().int().positive().nullable().default(null),
        })
        .strict(),
      input,
    );
    return this.db.transaction(async (c) => {
      const [request] = await rows(
        c,
        "SELECT * FROM product_requests WHERE request_id=? AND status='Open' FOR UPDATE",
        [requestId],
      );
      if (!request) throw new NotFoundException();
      const [old] = await rows(
        c,
        'SELECT offer_id FROM request_offers WHERE request_id=? AND farmer_id=?',
        [requestId, farmerId],
      );
      if (old) throw new ConflictException('You have already offered on this request.');
      if (b.product_id) {
        const [p] = await rows(
          c,
          "SELECT product_id FROM products WHERE product_id=? AND farmer_id=? AND status='Available'",
          [b.product_id, farmerId],
        );
        if (!p) throw new NotFoundException('Listing not available.');
      }
      const result = await run(
        c,
        'INSERT INTO request_offers (request_id,farmer_id,product_id,message,price) VALUES (?,?,?,?,?)',
        [requestId, farmerId, b.product_id, b.message, b.price],
      );
      return { offer_id: result.insertId };
    });
  }
  async accept(buyerId: number, requestId: number, offerId: number) {
    return this.db.transaction(async (c) => {
      const [request] = await rows(
        c,
        'SELECT * FROM product_requests WHERE request_id=? AND buyer_id=? FOR UPDATE',
        [requestId, buyerId],
      );
      if (!request) throw new NotFoundException();
      const [offer] = await rows(
        c,
        'SELECT * FROM request_offers WHERE offer_id=? AND request_id=? FOR UPDATE',
        [offerId, requestId],
      );
      if (!offer) throw new NotFoundException();
      if (request.status !== 'Open' || offer.status !== 'Pending')
        throw new ConflictException('This request already changed.');
      await run(
        c,
        "UPDATE request_offers SET status=IF(offer_id=?,'Accepted','Declined') WHERE request_id=?",
        [offerId, requestId],
      );
      await run(c, "UPDATE product_requests SET status='Fulfilled' WHERE request_id=?", [
        requestId,
      ]);
      return {
        farmer_id: offer.farmer_id,
        product_id: offer.product_id,
        message:
          'Offer accepted. Message the farmer to arrange fulfilment. Standard checkout uses the listing price.',
      };
    });
  }
}
@Controller()
export class CommunityController {
  constructor(
    private readonly community: Community,
    private readonly auth: Auth,
  ) {}
  @Get('requests') requests(@Req() req: ApiRequest, @Query('page') page: string) {
    return this.community.requests(actor(req, 'Buyer', 'Farmer'), page);
  }
  @Post('requests') create(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.community.create(actor(req, 'Buyer').user_id, body);
  }
  @Post('requests/:id/offers') offer(
    @Req() req: ApiRequest,
    @Param('id') requestId: string,
    @Body() body: unknown,
  ) {
    return this.community.offer(actor(req, 'Farmer').user_id, id(requestId), body);
  }
  @Post('requests/:id/accept') accept(
    @Req() req: ApiRequest,
    @Param('id') requestId: string,
    @Body() input: unknown,
  ) {
    const b = parse(z.object({ offer_id: z.number().int().positive() }).strict(), input);
    return this.community.accept(actor(req, 'Buyer').user_id, id(requestId), b.offer_id);
  }
  @Post('requests/:id/close') async close(@Req() req: ApiRequest, @Param('id') requestId: string) {
    const result = await this.community.db.run(
      "UPDATE product_requests SET status='Closed' WHERE request_id=? AND buyer_id=? AND status='Open'",
      [id(requestId), actor(req, 'Buyer').user_id],
    );
    if (!result.affectedRows)
      throw new ConflictException('Request unavailable or already changed.');
    return { message: 'Request closed.' };
  }
  @Get('messages/threads') threads(@Req() req: ApiRequest) {
    const u = actor(req);
    return this.community.db.rows(
      `SELECT u.user_id,u.full_name,
      (SELECT content FROM messages m WHERE (m.sender_id=? AND m.receiver_id=u.user_id) OR (m.sender_id=u.user_id AND m.receiver_id=?) ORDER BY m.msg_id DESC LIMIT 1) latest_message,
      (SELECT COUNT(*) FROM messages m WHERE m.sender_id=u.user_id AND m.receiver_id=? AND m.is_read=0) unread
      FROM users u WHERE EXISTS (SELECT 1 FROM messages m WHERE (m.sender_id=? AND m.receiver_id=u.user_id) OR (m.sender_id=u.user_id AND m.receiver_id=?)) ORDER BY u.full_name LIMIT 200`,
      Array(5).fill(u.user_id),
    );
  }
  @Get('messages/thread/:id') async messages(
    @Req() req: ApiRequest,
    @Param('id') peer: string,
    @Query('before') before?: string,
  ) {
    const u = actor(req),
      peerId = id(peer);
    const [person] = await this.community.db.rows(
      'SELECT user_id,full_name FROM users WHERE user_id=?',
      [peerId],
    );
    if (!person) throw new NotFoundException();
    const items = await this.community.db.rows(
      `SELECT msg_id,sender_id,receiver_id,content,is_read,sent_at FROM messages WHERE ((sender_id=? AND receiver_id=?) OR(sender_id=? AND receiver_id=?)) AND msg_id<? ORDER BY msg_id DESC LIMIT 51`,
      [u.user_id, peerId, peerId, u.user_id, before ? id(before) : 2147483647],
    );
    return { peer: person, items: items.slice(0, 50).reverse(), has_more: items.length > 50 };
  }
  @Post('messages/thread/:id') async send(
    @Req() req: ApiRequest,
    @Param('id') peer: string,
    @Body() input: unknown,
  ) {
    const u = actor(req),
      peerId = id(peer),
      b = parse(z.object({ content: text(4000) }).strict(), input);
    await this.auth.limit('messages', String(u.user_id), 100);
    const [person] = await this.community.db.rows(
      'SELECT user_id FROM users WHERE user_id=? AND is_active=1 AND is_verified=1',
      [peerId],
    );
    if (!person || peerId === u.user_id) throw new NotFoundException('Recipient unavailable.');
    const result = await this.community.db.run(
      'INSERT INTO messages (sender_id,receiver_id,content) VALUES (?,?,?)',
      [u.user_id, peerId, b.content],
    );
    return { msg_id: result.insertId };
  }
  @Post('messages/thread/:id/read') async read(@Req() req: ApiRequest, @Param('id') peer: string) {
    await this.community.db.run(
      'UPDATE messages SET is_read=1 WHERE sender_id=? AND receiver_id=?',
      [id(peer), actor(req).user_id],
    );
    return { message: 'Messages marked read.' };
  }
}
