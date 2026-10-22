import { Database } from './db';
import { config } from './config';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
export async function seedDemo(db: Database, password: string) {
  if (config.NODE_ENV === 'production' || !/(_ts|_test)$/.test(config.DB_NAME))
    throw new Error('Demo fixtures require an isolated development/test database.');
  const [count] = await db.rows('SELECT COUNT(*) n FROM users');
  if (Number(count.n) !== 0) throw new Error('Demo fixtures require an empty users table.');
  const hash = await bcrypt.hash(password, 12);
  for (const [name, email, role] of [
    ['Demo Buyer', 'buyer@example.test', 'Buyer'],
    ['Green Valley Farm', 'farmer@example.test', 'Farmer'],
    ['Harvest Hill Farm', 'farmer2@example.test', 'Farmer'],
    ['Demo Admin', 'admin@example.test', 'Admin'],
  ]) {
    await db.run(
      'INSERT INTO users (full_name,email,password_hash,role,location,business_name,is_verified) VALUES (?,?,?,?,?,?,1)',
      [name, email, hash, role, 'Nakuru', role === 'Farmer' ? name : null],
    );
  }
  for (const [farmer, name, description, price, quantity, unit, category] of [
    [
      2,
      'Fresh Maize',
      'Well-dried, freshly harvested maize from Nakuru farms.',
      '55.00',
      500,
      'kg',
      'Cereals',
    ],
    [
      2,
      'Irish Potatoes',
      'Carefully sorted Molo potatoes, ready for your kitchen.',
      '80.00',
      300,
      'kg',
      'Tubers',
    ],
    [
      2,
      'Fresh Cow Milk',
      'Fresh milk from our small family dairy.',
      '65.00',
      100,
      'litre',
      'Dairy',
    ],
    [
      3,
      'Sukuma Wiki',
      'Leafy greens, picked fresh from the farm.',
      '30.00',
      200,
      'bunch',
      'Vegetables',
    ],
    [3, 'Ripe Bananas', 'Sweet, ripe bananas grown with care.', '250.00', 80, 'bunch', 'Fruits'],
    [
      3,
      'Free-Range Eggs',
      'A tray of fresh eggs from our free-range flock.',
      '450.00',
      50,
      'tray',
      'Poultry',
    ],
  ]) {
    await db.run(
      'INSERT INTO products (farmer_id,product_name,description,price,quantity,unit,category) VALUES (?,?,?,?,?,?,?)',
      [farmer, name, description, price, quantity, unit, category],
    );
  }
}
async function main() {
  const db = new Database();
  try {
    const password = randomBytes(15).toString('base64url');
    await seedDemo(db, password);
    console.log(
      'Development-only accounts: buyer@example.test, farmer@example.test, farmer2@example.test, admin@example.test',
    );
    console.log(`Temporary demo password: ${password}`);
  } finally {
    await db.onModuleDestroy();
  }
}
if (require.main === module)
  main().catch(() => {
    console.error('Demo seed refused or failed. Use an empty isolated development database.');
    process.exitCode = 1;
  });
