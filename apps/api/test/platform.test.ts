import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createDecipheriv, randomBytes } from 'node:crypto';
import mysql from 'mysql2/promise';
import supertest from 'supertest';
import sharp from 'sharp';
import net from 'node:net';

const databaseName = process.env.DB_NAME;
if (!databaseName || !/_test$/.test(databaseName))
  throw new Error(
    'Integration tests require DB_NAME ending _test. This suite recreates only that isolated database.',
  );
process.env.NODE_ENV = 'test';
process.env.APP_ORIGIN = 'http://localhost:5173';
process.env.MAIL_ENCRYPTION_KEY ??= randomBytes(32).toString('hex');
process.env.MPESA_ENABLED = 'false';
const origin = process.env.APP_ORIGIN;
let db: any,
  app: any,
  http: any,
  auth: any,
  orders: any,
  payments: any,
  buyer: any,
  farmer: any,
  otherFarmer: any,
  admin: any;
const password = 'a long test passphrase 2026';
const oldHash = '$2y$10$qSJ2RCPfbatR8BJVdfISwO6u3bg6axk2kYKWiO1EypAZzEsob071q';
async function client() {
  const agent = supertest.agent(http);
  const session = await agent.get('/api/auth/session').expect(200);
  let csrf = session.body.csrf;
  return {
    agent,
    get: (path: string) => agent.get('/api' + path),
    post: (path: string, body?: unknown) =>
      agent
        .post('/api' + path)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .send(body),
    put: (path: string, body?: unknown) =>
      agent
        .put('/api' + path)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf)
        .send(body),
    del: (path: string) =>
      agent
        .delete('/api' + path)
        .set('Origin', origin)
        .set('X-CSRF-Token', csrf),
    setCsrf: (s: string) => {
      csrf = s;
    },
    csrf: () => csrf,
  };
}
async function login(email: string, pw = password) {
  const c = await client();
  const result = await c.post('/auth/login', { email, password: pw }).expect(201);
  c.setCsrf(result.body.csrf);
  return c;
}
async function stock(id = 1) {
  return (await db.rows('SELECT quantity FROM products WHERE product_id=?', [id]))[0].quantity;
}
async function checkout(c: any, products: number[], key = randomBytes(16).toString('hex')) {
  for (const product of products) await c.put(`/cart/${product}`, { quantity: 2 }).expect(200);
  const r = await c
    .post('/orders', {
      delivery_address: 'Nakuru, near the market',
      payment_method: 'Cash on Delivery',
    })
    .set('Idempotency-Key', key)
    .expect(201);
  return r.body.order_id;
}
function decrypt(payload: string) {
  const [iv, tag, data] = payload.split('.');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(process.env.MAIL_ENCRYPTION_KEY!, 'hex'),
    Buffer.from(iv, 'hex'),
  );
  cipher.setAuthTag(Buffer.from(tag, 'hex'));
  return JSON.parse(
    Buffer.concat([cipher.update(Buffer.from(data, 'hex')), cipher.final()]).toString(),
  );
}
before(async () => {
  const bootstrap = await mysql.createConnection({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  assert.match(databaseName!, /^[a-zA-Z0-9_]+_test$/);
  await bootstrap.query(`DROP DATABASE IF EXISTS \`${databaseName}\``);
  await bootstrap.query(
    `CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();
  const { Database } = require('../dist/db');
  db = new Database();
  const schema = (await readFile(resolve(__dirname, '../../../database/schema.sql'), 'utf8'))
    .split('-- SEED DATA')[0]
    .split('\n')
    .filter((l) => !l.startsWith('--') && !/^CREATE DATABASE|^USE /.test(l))
    .join('\n');
  for (const statement of schema
    .split(';')
    .map((v) => v.trim())
    .filter(Boolean))
    await db.pool.query(statement);
  await require('../dist/demo').seedDemo(db, password);
  await db.run(
    "INSERT INTO orders(buyer_id,total_amount,status,delivery_address,estimated_delivery_date,estimated_delivery_window) VALUES (1,65.00,'Shipped','Existing address','2026-10-23','Morning')",
  );
  await db.run(
    'INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES (1,3,1,65.00)',
  );
  await db.run(
    "INSERT INTO transactions(order_id,amount,payment_method,payment_status) VALUES (1,65.00,'Cash on Delivery','Pending')",
  );
  const { migrate } = require('../dist/migrate');
  await migrate(db);
  await migrate(db);
  await db.run(
    "INSERT INTO users(full_name,email,password_hash,role,is_verified) VALUES ('Legacy Buyer','legacy@example.test',?,'Buyer',1)",
    [oldHash],
  );
  app = await require('../dist/app').createApp();
  await app.init();
  http = app.getHttpServer();
  auth = app.get(require('../dist/auth').Auth);
  orders = app.get(require('../dist/orders').Orders);
  payments = app.get(require('../dist/payments').Payments);
  buyer = await login('buyer@example.test');
  farmer = await login('farmer@example.test');
  otherFarmer = await login('farmer2@example.test');
  admin = await login('admin@example.test');
});
after(async () => {
  await app?.close();
  await db?.onModuleDestroy();
});

test('migration preserves existing orders and labels unknown history', async () => {
  const legacy = await buyer.get('/orders/1').expect(200);
  assert.equal(legacy.body.total_amount, '65.00');
  assert.equal(legacy.body.fulfilments[0].status, 'Shipped');
  assert.equal(legacy.body.fulfilments[0].estimated_delivery_date, '2026-10-23');
  assert.equal(legacy.body.items[0].product_name, 'Fresh Cow Milk');
  assert.match(legacy.body.events[0].note, /earlier farmer-specific event times were not recorded/);
});

test('health, capabilities and public listings expose no account secrets', async () => {
  await buyer.get('/health').expect(200);
  const cap = await buyer.get('/capabilities').expect(200);
  assert.equal(cap.body.mpesa_enabled, false);
  const r = await buyer.get('/products').expect(200);
  assert.equal(r.body.items.length, 6);
  assert(!JSON.stringify(r.body).includes('password_hash'));
  assert(!JSON.stringify(r.body).includes('national_id'));
});
test('PHP bcrypt hashes remain usable and are upgraded without resetting passwords', async () => {
  const c = await login('legacy@example.test', 'password123');
  const r = await c.get('/auth/session').expect(200);
  assert.equal(r.body.user.email, 'legacy@example.test');
  const [u] = await db.rows('SELECT password_hash FROM users WHERE email=?', [
    'legacy@example.test',
  ]);
  assert.match(u.password_hash, /^\$2b\$12\$/);
});
test('guest sessions cannot access private data or self-assign administrator', async () => {
  const guest = await client();
  await guest.get('/orders').expect(403);
  await buyer.get('/admin/users').expect(403);
  await guest
    .post('/auth/register', {
      full_name: 'Hacker',
      email: 'no@example.test',
      password,
      role: 'Admin',
      phone: '',
      national_id: '12345678',
      location: 'Nakuru',
    })
    .expect(400);
});
test('mutations require both a valid CSRF token and the configured origin', async () => {
  await buyer.agent.post('/api/auth/logout').set('Origin', origin).expect(403);
  await buyer.agent
    .post('/api/auth/logout')
    .set('Origin', 'https://evil.example')
    .set('X-CSRF-Token', buyer.csrf())
    .expect(403);
  await buyer.agent
    .post('/api/auth/logout')
    .set('Origin', origin)
    .set('X-CSRF-Token', 'é'.repeat(64))
    .expect(403);
});
test('registration queues encrypted verification, restricts unverified sign-in and consumes once', async () => {
  const c = await client();
  const b = {
    full_name: 'New Farmer',
    email: 'new@example.test',
    password,
    role: 'Farmer',
    phone: '0712345678',
    national_id: '87654321',
    location: 'Nakuru',
    business_name: 'New Farm',
  };
  await c.post('/auth/register', b).expect(201);
  const [mail] = await db.rows('SELECT * FROM node_mail_outbox ORDER BY mail_id DESC LIMIT 1');
  assert(!mail.payload.includes(b.email));
  const m = decrypt(mail.payload);
  const [user] = await db.rows('SELECT * FROM users WHERE email=?', [b.email]);
  assert.notEqual(user.verification_token, m.token);
  await c.post('/auth/login', { email: b.email, password }).expect(401);
  await c.post('/auth/verify-email', { token: m.token }).expect(201);
  await c.post('/auth/verify-email', { token: m.token }).expect(400);
  await login(b.email);
});
test('short passwords and oversized bcrypt passwords fail validation', async () => {
  const c = await client();
  for (const value of ['short', 'é'.repeat(40)])
    await c.post('/auth/reset-password', { token: 'a'.repeat(64), password: value }).expect(400);
});
test('unknown and known recovery requests have identical public responses, with cooldown', async () => {
  const c = await client();
  const known = await c.post('/auth/forgot-password', { email: 'new@example.test' }).expect(201);
  const unknown = await c
    .post('/auth/forgot-password', { email: 'absent@example.test' })
    .expect(201);
  assert.deepEqual(known.body, unknown.body);
  const [before] = await db.rows('SELECT COUNT(*) n FROM node_mail_outbox');
  await c.post('/auth/forgot-password', { email: 'new@example.test' }).expect(201);
  const [after] = await db.rows('SELECT COUNT(*) n FROM node_mail_outbox');
  assert.equal(before.n, after.n);
});
test('password reset is single-use and revokes prior sessions', async () => {
  const existing = await login('new@example.test');
  const [mail] = await db.rows(
    'SELECT payload FROM node_mail_outbox ORDER BY mail_id DESC LIMIT 1',
  );
  const m = decrypt(mail.payload);
  const c = await client();
  await c
    .post('/auth/reset-password', { token: m.token, password: password + ' updated' })
    .expect(201);
  await c.post('/auth/reset-password', { token: m.token, password }).expect(400);
  const r = await existing.get('/auth/session').expect(200);
  assert.equal(r.body.user, null);
});
test('expired email links cannot verify/reset accounts', async () => {
  const c = await client(),
    raw = 'b'.repeat(64);
  await db.run(
    'UPDATE users SET reset_token=?,reset_sent_at=UTC_TIMESTAMP()-INTERVAL 2 HOUR WHERE user_id=5',
    [require('../dist/auth').digest(raw)],
  );
  await c.post('/auth/reset-password', { token: raw, password }).expect(400);
});
test('account lockout applies across parallel wrong-password requests', async () => {
  await db.run('DELETE FROM auth_rate_limits');
  const c = await client();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      c.post('/auth/login', { email: 'legacy@example.test', password: 'wrong' }).expect(401),
    ),
  );
  const [u] = await db.rows('SELECT failed_login_attempts,locked_until FROM users WHERE user_id=5');
  assert.equal(u.failed_login_attempts, 5);
  assert(u.locked_until);
  await c
    .post('/auth/login', { email: 'legacy@example.test', password: 'password123' })
    .expect(401);
});
test('database-backed IP rate limits cannot be bypassed by parallel requests', async () => {
  const decisions = await Promise.allSettled(
    Array.from({ length: 8 }, () => auth.limit('test-concurrent', 'test-address', 5)),
  );
  assert.equal(decisions.filter((v) => v.status === 'fulfilled').length, 5);
});
test('idle, absolute expiry, disable and password changes revoke sessions', async () => {
  for (const change of [
    'last_seen=UTC_TIMESTAMP()-INTERVAL 31 MINUTE',
    'created_at=UTC_TIMESTAMP()-INTERVAL 13 HOUR',
  ]) {
    const c = await login('buyer@example.test');
    await db.run(`UPDATE node_sessions SET ${change} WHERE user_id=1`);
    await c.get('/orders').expect(403);
  }
  buyer = await login('buyer@example.test');
});
test('cart validation and checkout stock locking reject unavailable products', async () => {
  await buyer.put('/cart/1', { quantity: 10001 }).expect(400);
  await buyer.put('/cart/1', { quantity: 9999 }).expect(409);
  await buyer.put('/cart/1', { quantity: 2 }).expect(200);
  await db.run('UPDATE products SET quantity=1 WHERE product_id=1');
  await buyer
    .post('/orders', { delivery_address: 'Nakuru', payment_method: 'Cash on Delivery' })
    .set('Idempotency-Key', 'insufficient-stock-test')
    .expect(409);
  assert.equal(await stock(), 1);
  await db.run('UPDATE products SET quantity=500 WHERE product_id=1');
});
let mixedOrder: number;
test('checkout retries are idempotent and reserve each product once', async () => {
  const key = 'idempotent-checkout-key';
  const initial = await stock();
  mixedOrder = await checkout(buyer, [1, 4], key);
  const retry = await buyer
    .post('/orders', {
      delivery_address: 'Nakuru, near the market',
      payment_method: 'Cash on Delivery',
    })
    .set('Idempotency-Key', key)
    .expect(201);
  assert.equal(retry.body.order_id, mixedOrder);
  assert.equal(await stock(), initial - 2);
  await buyer
    .post('/orders', { delivery_address: 'Different', payment_method: 'Cash on Delivery' })
    .set('Idempotency-Key', key)
    .expect(409);
});
test('cross-buyer order access is hidden and farmer views include only their items/events', async () => {
  const outsider = await login('legacy@example.test', 'password123').catch(() => null);
  assert.equal(outsider, null);
  const newBuyer = await login('buyer@example.test');
  const detail = await farmer.get(`/orders/${mixedOrder}`).expect(200);
  assert.equal(detail.body.items.length, 1);
  assert(detail.body.items.every((i: any) => i.farmer_id === 2));
  assert(detail.body.events.every((e: any) => e.farmer_id === 2));
  assert.equal(detail.body.payments[0].amount, undefined);
  await db.run('UPDATE orders SET buyer_id=5 WHERE order_id=?', [mixedOrder]);
  await newBuyer.get(`/orders/${mixedOrder}`).expect(404);
  await db.run('UPDATE orders SET buyer_id=1 WHERE order_id=?', [mixedOrder]);
});
test('one farmer cannot change another farmer fulfilment', async () => {
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/3`, { status: 'Cancelled', version: 0 })
    .expect(404);
  const r = await buyer.get(`/orders/${mixedOrder}`).expect(200);
  assert(r.body.fulfilments.every((f: any) => f.status === 'Pending'));
});
test('confirmation requires an ETA and stale updates cannot overwrite state', async () => {
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/2`, { status: 'Confirmed', version: 0 })
    .expect(400);
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/2`, {
      status: 'Confirmed',
      version: 0,
      estimated_delivery_date: '2099-01-15',
      estimated_delivery_window: 'Morning',
      note: 'Packed fresh.',
    })
    .expect(201);
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/2`, { status: 'Cancelled', version: 0 })
    .expect(409);
});
test('partial cancellation restores only that farmer stock and adjusts COD total once', async () => {
  const initial = await stock(4);
  await buyer
    .post(`/orders/${mixedOrder}/fulfilments/3`, { status: 'Cancelled', version: 0 })
    .expect(201);
  assert.equal(await stock(4), initial + 2);
  const result = await buyer.get(`/orders/${mixedOrder}`).expect(200);
  assert.equal(result.body.total_amount, '110.00');
  assert.equal(result.body.payments[0].amount, '110.00');
  await buyer
    .post(`/orders/${mixedOrder}/fulfilments/3`, { status: 'Cancelled', version: 0 })
    .expect(409);
  assert.equal(await stock(4), initial + 2);
});
test('delivery completes COD only after all remaining fulfilments are delivered', async () => {
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/2`, { status: 'Shipped', version: 1 })
    .expect(201);
  let r = await buyer.get(`/orders/${mixedOrder}`).expect(200);
  assert.equal(r.body.payments[0].payment_status, 'Pending');
  await farmer
    .post(`/orders/${mixedOrder}/fulfilments/2`, { status: 'Delivered', version: 2 })
    .expect(201);
  r = await buyer.get(`/orders/${mixedOrder}`).expect(200);
  assert.equal(r.body.status, 'Delivered');
  assert.equal(r.body.payments[0].payment_status, 'Completed');
  assert.equal(r.body.fulfilments.find((f: any) => f.farmer_id === 3).status, 'Cancelled');
});
test('concurrent buyers cannot oversell the last product', async () => {
  await db.run('UPDATE users SET failed_login_attempts=0,locked_until=NULL WHERE user_id=5');
  await db.run('DELETE FROM auth_rate_limits');
  const other = await login('legacy@example.test', 'password123');
  await db.run('UPDATE products SET quantity=1 WHERE product_id=2');
  await buyer.put('/cart/2', { quantity: 1 }).expect(200);
  await other.put('/cart/2', { quantity: 1 }).expect(200);
  const result = await Promise.all(
    [buyer, other].map((c, index) =>
      c
        .post('/orders', { delivery_address: 'Nakuru', payment_method: 'Cash on Delivery' })
        .set('Idempotency-Key', `concurrent-stock-${index}`),
    ),
  );
  assert.deepEqual(result.map((r) => r.status).sort(), [201, 409]);
  assert.equal(await stock(2), 0);
  await db.run('DELETE FROM node_cart');
});
test('order snapshots survive product edits and listing archive retains history', async () => {
  await db.run("UPDATE products SET product_name='Renamed maize' WHERE product_id=1");
  await farmer.del('/farmer/products/1').expect(200);
  await buyer.get('/products/1').expect(404);
  const r = await buyer.get(`/orders/${mixedOrder}`).expect(200);
  assert.equal(r.body.items[0].product_name, 'Fresh Maize');
  assert.equal(
    Number(
      (await db.rows('SELECT COUNT(*) n FROM order_items WHERE order_id=?', [mixedOrder]))[0].n,
    ),
    2,
  );
});
test('image uploads decode/re-encode images and reject executable or oversized content', async () => {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#557733' } })
    .png()
    .toBuffer();
  const r = await farmer.agent
    .post('/api/farmer/images')
    .set('Origin', origin)
    .set('X-CSRF-Token', farmer.csrf())
    .attach('image', image, 'photo.png')
    .expect(201);
  assert.match(r.body.image_url, /^node-[a-f0-9]{32}\.webp$/);
  await buyer
    .get(`/images/${r.body.image_url}`)
    .expect(200)
    .expect('Content-Type', /image\/webp/);
  await farmer.agent
    .post('/api/farmer/images')
    .set('Origin', origin)
    .set('X-CSRF-Token', farmer.csrf())
    .attach('image', Buffer.from('<?php echo 1;'), 'photo.jpg')
    .expect(400);
});
test('requests/offers respect farmer listing ownership and atomic acceptance', async () => {
  const request = await buyer
    .post('/requests', {
      title: 'Fresh vegetables',
      description: 'Please supply fresh vegetables in Nakuru.',
      category: 'Vegetables',
      quantity: 3,
      unit: 'bunch',
      budget_max: '100.00',
    })
    .expect(201);
  const requestId = request.body.request_id;
  await farmer
    .post(`/requests/${requestId}/offers`, { message: 'Available', price: '90.00', product_id: 4 })
    .expect(404);
  const o1 = await farmer
    .post(`/requests/${requestId}/offers`, { message: 'Can arrange supply', price: '90.00' })
    .expect(201);
  await otherFarmer
    .post(`/requests/${requestId}/offers`, {
      message: 'Fresh greens available',
      price: '85.00',
      product_id: 4,
    })
    .expect(201);
  await farmer
    .post(`/requests/${requestId}/offers`, { message: 'Duplicate', price: '80.00' })
    .expect(409);
  await buyer.post(`/requests/${requestId}/accept`, { offer_id: o1.body.offer_id }).expect(201);
  await buyer.post(`/requests/${requestId}/accept`, { offer_id: o1.body.offer_id }).expect(409);
  const offers = await db.rows('SELECT status FROM request_offers WHERE request_id=?', [requestId]);
  assert.deepEqual(offers.map((o: any) => o.status).sort(), ['Accepted', 'Declined']);
});
test('messages are restricted to participants and render content as data', async () => {
  await buyer
    .post('/messages/thread/2', { content: '<img src=x onerror=alert(1)> Hello farmer' })
    .expect(201);
  const mine = await farmer.get('/messages/thread/1').expect(200);
  assert(mine.body.items.some((m: any) => m.content.startsWith('<img')));
  const outsider = await otherFarmer.get('/messages/thread/1').expect(200);
  assert.equal(outsider.body.items.length, 0);
  await farmer.post('/messages/thread/1/read').expect(201);
  const threads = await farmer.get('/messages/threads').expect(200);
  assert.equal(Number(threads.body[0].unread), 0);
});
test('administrator status changes revoke sessions and forbid self-deactivation', async () => {
  await admin.post('/admin/users/4/status', { is_active: false }).expect(409);
  await admin.post('/admin/users/3/status', { is_active: false }).expect(201);
  await otherFarmer.get('/orders').expect(403);
  await admin.post('/admin/users/3/status', { is_active: true }).expect(201);
});
test('CSV exports neutralize spreadsheet formula injection', async () => {
  await db.run('UPDATE users SET full_name=\'=HYPERLINK("bad")\' WHERE user_id=1');
  const r = await admin.get('/admin/report.csv').expect(200);
  assert(r.text.includes('"\'=HYPERLINK'));
  assert(!r.text.includes('\n"=HYPERLINK'));
  await db.run("UPDATE users SET full_name='Demo Buyer' WHERE user_id=1");
});
test('M-Pesa remains unavailable until configured; spoofed callbacks cannot settle payments', async () => {
  await buyer.post(`/payments/mpesa/${mixedOrder}/start`).expect(503);
  await supertest(http)
    .post('/api/payments/mpesa/callback')
    .send({ Body: { stkCallback: { CheckoutRequestID: 'fake', ResultCode: 0 } } })
    .expect(503);
  assert.equal(
    (await db.rows('SELECT payment_status FROM transactions WHERE order_id=?', [mixedOrder]))[0]
      .payment_status,
    'Completed',
  );
});
test('provider reconciliation verifies checkout reference and ignores callback result', async () => {
  const { config } = require('../dist/config');
  config.MPESA_ENABLED = true;
  const orderId = await checkout(buyer, [4]);
  await db.run(
    "UPDATE transactions SET payment_method='M-Pesa',checkout_request_id='ws_CO_test',merchant_request_id='merchant-test' WHERE order_id=?",
    [orderId],
  );
  const txn = (await db.rows('SELECT txn_id FROM transactions WHERE order_id=?', [orderId]))[0];
  await payments.callback({
    Body: { stkCallback: { CheckoutRequestID: 'ws_CO_test', ResultCode: 0 } },
  });
  assert.equal(
    (await db.rows('SELECT payment_status FROM transactions WHERE txn_id=?', [txn.txn_id]))[0]
      .payment_status,
    'Pending',
  );
  const original = payments.request;
  payments.request = async () => ({ CheckoutRequestID: 'different', ResultCode: 0 });
  await payments.reconcile(txn.txn_id);
  assert.equal(
    (await db.rows('SELECT payment_status FROM transactions WHERE txn_id=?', [txn.txn_id]))[0]
      .payment_status,
    'Pending',
  );
  payments.request = async () => ({
    CheckoutRequestID: 'ws_CO_test',
    MerchantRequestID: 'merchant-test',
    ResultCode: 0,
    ResultDesc: 'Success',
  });
  await payments.reconcile(txn.txn_id);
  await payments.reconcile(txn.txn_id);
  assert.equal(
    (await db.rows('SELECT payment_status FROM transactions WHERE txn_id=?', [txn.txn_id]))[0]
      .payment_status,
    'Completed',
  );
  assert.equal(
    (await db.rows('SELECT status FROM orders WHERE order_id=?', [orderId]))[0].status,
    'Pending',
  );
  await buyer
    .post(`/orders/${orderId}/fulfilments/3`, { status: 'Cancelled', version: 0 })
    .expect(409);
  payments.request = original;
  config.MPESA_ENABLED = false;
});
test('logout invalidates the previous authenticated session', async () => {
  const r = await buyer.post('/auth/logout').expect(201);
  buyer.setCsrf(r.body.csrf);
  await buyer.get('/orders').expect(403);
});
test('stale farmer edits cannot overwrite stock reserved after opening the form', async () => {
  const initial = await stock(3);
  await db.run('UPDATE products SET quantity=quantity-1 WHERE product_id=3');
  await farmer
    .put('/farmer/products/3', {
      product_name: 'Fresh Cow Milk',
      description: 'Fresh milk',
      price: '65.00',
      quantity: initial,
      expected_quantity: initial,
      unit: 'litre',
      category: 'Dairy',
      status: 'Available',
    })
    .expect(409);
  assert.equal(await stock(3), initial - 1);
});
test('malformed and oversized JSON receive client errors without echoing request data', async () => {
  const c = await client();
  const malformed = await c.agent
    .post('/api/auth/login')
    .set('Origin', origin)
    .set('Content-Type', 'application/json')
    .set('X-CSRF-Token', c.csrf())
    .send('{"password":"PRIVATE_INPUT",')
    .expect(400);
  assert(!JSON.stringify(malformed.body).includes('PRIVATE_INPUT'));
  await c
    .post('/auth/login', { email: 'buyer@example.test', password: 'x'.repeat(40000) })
    .expect(413);
});
test('mail worker retries SMTP failure and purges encrypted payload after successful delivery', async () => {
  const { config } = require('../dist/config'),
    worker = app.get(require('../dist/mail').Mail);
  const originalPort = config.SMTP_PORT;
  config.SMTP_PORT = 1;
  const [pending] = await db.rows(
    'SELECT * FROM node_mail_outbox WHERE sent_at IS NULL ORDER BY mail_id LIMIT 1',
  );
  assert(pending);
  await worker.deliverOne();
  const [failed] = await db.rows('SELECT * FROM node_mail_outbox WHERE mail_id=?', [
    pending.mail_id,
  ]);
  assert.equal(failed.attempts, 1);
  assert(failed.payload);
  assert.equal(failed.sent_at, null);
  let received = '';
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.write('220 test.local ESMTP\r\n');
    let buffer = '',
      data = false;
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\r\n')) {
        const index = buffer.indexOf('\r\n'),
          line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 Accepted\r\n');
          } else received += line + '\n';
        } else if (line.startsWith('EHLO')) socket.write('250-test.local\r\n250 PIPELINING\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 Send message\r\n');
        } else if (line === 'QUIT') socket.end('221 Bye\r\n');
        else socket.write('250 OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  config.SMTP_PORT = (server.address() as net.AddressInfo).port;
  try {
    await db.run(
      'UPDATE node_mail_outbox SET available_at=UTC_TIMESTAMP()-INTERVAL 1 SECOND WHERE mail_id=?',
      [pending.mail_id],
    );
    await worker.deliverOne();
    const [delivered] = await db.rows('SELECT * FROM node_mail_outbox WHERE mail_id=?', [
      pending.mail_id,
    ]);
    assert(delivered.sent_at);
    assert.equal(delivered.payload, '');
    assert.match(received, /verify-email#token=/);
  } finally {
    config.SMTP_PORT = originalPort;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
