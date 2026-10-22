import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Query,
  Param,
  Req,
  Res,
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { z } from 'zod';
import sharp from 'sharp';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { Database, rows, run, Connection, Row } from './db';
import { ApiRequest, actor, parse, id, text, categories, money } from './validation';
import { uploadDir } from './config';
const productInput = z.object({
  product_name: text(150),
  description: text(10000, 0),
  price: money,
  quantity: z.coerce.number().int().min(0).max(10000000),
  unit: text(30),
  category: z.enum(categories),
  image_url: z
    .string()
    .regex(/^(|node-[a-f0-9]{32}\.webp)$/)
    .default(''),
  status: z.enum(['Available', 'Unavailable']),
  expected_quantity: z.number().int().min(0).optional(),
});
export const presentProduct = (p: Row) => ({
  ...p,
  image_url: p.image_url ? `/api/images/${String(p.image_url).split(/[\\/]/).pop()}` : null,
});
@Injectable()
export class Catalogue {
  constructor(readonly db: Database) {}
  async list(query: unknown, mine?: number, admin = false) {
    const q = parse(
      z.object({
        q: text(100, 0).default(''),
        category: z.enum(categories).optional(),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      }),
      query,
    );
    const conditions = ['1=1'],
      values: unknown[] = [];
    if (!mine && !admin)
      conditions.push("p.status='Available'", 'p.quantity>0', 'u.is_active=1', 'u.is_verified=1');
    if (mine) {
      conditions.push('p.farmer_id=?');
      values.push(mine);
    }
    if (q.q) {
      conditions.push('(p.product_name LIKE ? OR p.description LIKE ?)');
      values.push(`%${q.q}%`, `%${q.q}%`);
    }
    if (q.category) {
      conditions.push('p.category=?');
      values.push(q.category);
    }
    const products = await this.db.rows(
      `SELECT p.*,u.full_name farmer_name,u.location,u.business_name FROM products p JOIN users u ON u.user_id=p.farmer_id WHERE ${conditions.join(' AND ')} ORDER BY p.product_id DESC LIMIT 25 OFFSET ?`,
      [...values, (q.page - 1) * 24],
    );
    return {
      items: products.slice(0, 24).map(presentProduct),
      page: q.page,
      has_more: products.length > 24,
    };
  }
  async product(productId: number) {
    const [p] = await this.db.rows(
      `SELECT p.*,u.full_name farmer_name,u.location,u.business_name FROM products p JOIN users u ON u.user_id=p.farmer_id
      WHERE p.product_id=? AND p.status='Available' AND u.is_active=1 AND u.is_verified=1`,
      [productId],
    );
    if (!p) throw new NotFoundException('Product unavailable.');
    return presentProduct(p);
  }
  async save(farmerId: number, input: unknown, productId?: number) {
    const body = parse(productInput.strict(), input);
    if (productId) {
      if (body.expected_quantity === undefined)
        throw new BadRequestException('Refresh this listing before editing.');
      const result = await this.db.run(
        'UPDATE products SET product_name=?,description=?,price=?,quantity=?,unit=?,category=?,image_url=IF(?="",image_url,?),status=? WHERE product_id=? AND farmer_id=? AND quantity=?',
        [
          body.product_name,
          body.description,
          body.price,
          body.quantity,
          body.unit,
          body.category,
          body.image_url,
          body.image_url,
          body.status,
          productId,
          farmerId,
          body.expected_quantity,
        ],
      );
      if (!result.affectedRows)
        throw new ConflictException(
          'Listing stock changed or the listing is unavailable. Refresh before editing.',
        );
      return { product_id: productId };
    }
    const result = await this.db.run(
      'INSERT INTO products (farmer_id,product_name,description,price,quantity,unit,category,image_url,status) VALUES (?,?,?,?,?,?,?,?,?)',
      [
        farmerId,
        body.product_name,
        body.description,
        body.price,
        body.quantity,
        body.unit,
        body.category,
        body.image_url || null,
        body.status,
      ],
    );
    return { product_id: result.insertId };
  }
  async cart(buyerId: number, c?: Connection) {
    return (
      await rows(
        c ?? this.db.pool,
        `SELECT p.*,u.full_name farmer_name,u.is_active farmer_active,u.is_verified farmer_verified,c.quantity cart_quantity
      FROM node_cart c JOIN products p ON p.product_id=c.product_id JOIN users u ON u.user_id=p.farmer_id WHERE c.buyer_id=? ORDER BY p.product_id`,
        [buyerId],
      )
    ).map(presentProduct);
  }
  async setCart(buyerId: number, productId: number, quantity: number) {
    await this.db.transaction(async (c) => {
      await rows(c, 'SELECT user_id FROM users WHERE user_id=? FOR UPDATE', [buyerId]);
      if (quantity === 0) {
        await run(c, 'DELETE FROM node_cart WHERE buyer_id=? AND product_id=?', [
          buyerId,
          productId,
        ]);
        return;
      }
      const [p] = await rows(
        c,
        `SELECT p.*,u.is_active,u.is_verified FROM products p JOIN users u ON u.user_id=p.farmer_id WHERE p.product_id=?`,
        [productId],
      );
      if (!p || p.status !== 'Available' || !p.is_active || !p.is_verified || p.quantity < quantity)
        throw new ConflictException('This quantity is unavailable.');
      const [count] = await rows(c, 'SELECT COUNT(*) n FROM node_cart WHERE buyer_id=?', [buyerId]);
      const [existing] = await rows(
        c,
        'SELECT product_id FROM node_cart WHERE buyer_id=? AND product_id=?',
        [buyerId, productId],
      );
      if (!existing && Number(count.n) >= 50)
        throw new BadRequestException('A cart can contain up to 50 products.');
      await run(
        c,
        'INSERT INTO node_cart (buyer_id,product_id,quantity) VALUES (?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity)',
        [buyerId, productId, quantity],
      );
    });
    return this.cart(buyerId);
  }
}
@Controller()
export class CatalogueController {
  constructor(private readonly catalogue: Catalogue) {}
  @Get('products') products(@Query() q: unknown) {
    return this.catalogue.list(q);
  }
  @Get('products/:id') product(@Param('id') productId: string) {
    return this.catalogue.product(id(productId));
  }
  @Get('farmer/products') mine(@Req() req: ApiRequest, @Query() q: unknown) {
    return this.catalogue.list(q, actor(req, 'Farmer').user_id);
  }
  @Post('farmer/products') create(@Req() req: ApiRequest, @Body() body: unknown) {
    return this.catalogue.save(actor(req, 'Farmer').user_id, body);
  }
  @Put('farmer/products/:id') update(
    @Req() req: ApiRequest,
    @Param('id') productId: string,
    @Body() body: unknown,
  ) {
    return this.catalogue.save(actor(req, 'Farmer').user_id, body, id(productId));
  }
  @Delete('farmer/products/:id') async archive(
    @Req() req: ApiRequest,
    @Param('id') productId: string,
  ) {
    const result = await this.catalogue.db.run(
      "UPDATE products SET status='Unavailable' WHERE product_id=? AND farmer_id=?",
      [id(productId), actor(req, 'Farmer').user_id],
    );
    if (!result.affectedRows) throw new NotFoundException();
    return { message: 'Listing archived. Order history retained.' };
  }
  @Get('cart') cart(@Req() req: ApiRequest) {
    return this.catalogue.cart(actor(req, 'Buyer').user_id);
  }
  @Put('cart/:id') cartItem(
    @Req() req: ApiRequest,
    @Param('id') productId: string,
    @Body() input: unknown,
  ) {
    const body = parse(z.object({ quantity: z.number().int().min(0).max(10000) }).strict(), input);
    return this.catalogue.setCart(actor(req, 'Buyer').user_id, id(productId), body.quantity);
  }
  @Post('farmer/images')
  @UseInterceptors(
    FileInterceptor('image', { limits: { fileSize: 3 * 1024 * 1024, files: 1, fields: 0 } }),
  )
  async upload(@Req() req: ApiRequest, @UploadedFile() file: Express.Multer.File) {
    actor(req, 'Farmer');
    if (!file) throw new BadRequestException('Choose an image of up to 3 MB.');
    let data: Buffer;
    try {
      data = await sharp(file.buffer, { limitInputPixels: 16000000, animated: false })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Choose a valid image of up to 16 megapixels.');
    }
    const name = `node-${randomBytes(16).toString('hex')}.webp`;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(resolve(uploadDir, name), data, { flag: 'wx' });
    return { image_url: name };
  }
  @Get('images/:name') async image(@Param('name') name: string, @Res() res: Response) {
    if (!/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|gif|webp)$/i.test(name)) throw new NotFoundException();
    for (const base of [uploadDir, resolve(__dirname, '../../../public/uploads')]) {
      const path = resolve(base, name);
      try {
        await access(path);
      } catch {
        continue;
      }
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.sendFile(path);
      return;
    }
    throw new NotFoundException();
  }
}
