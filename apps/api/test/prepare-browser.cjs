const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const mysql = require('mysql2/promise');
async function main() {
  const name = process.env.DB_NAME;
  if (!name || !/^[a-zA-Z0-9_]+_test$/.test(name)) {
    throw new Error('Browser fixtures require an isolated DB_NAME ending _test.');
  }
  const bootstrap = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await bootstrap.query(`DROP DATABASE IF EXISTS \`${name}\``);
  await bootstrap.query(
    `CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );
  await bootstrap.end();
  const { Database } = require('../dist/db');
  const db = new Database();
  try {
    const schema = readFileSync(resolve(__dirname, '../../../database/schema.sql'), 'utf8')
      .split('-- SEED DATA')[0]
      .split('\n')
      .filter((l) => !l.startsWith('--') && !/^CREATE DATABASE|^USE /.test(l))
      .join('\n');
    for (const sql of schema
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean))
      await db.pool.query(sql);
    await require('../dist/migrate').migrate(db);
    await require('../dist/demo').seedDemo(db, 'a long test passphrase 2026');
  } finally {
    await db.onModuleDestroy();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
