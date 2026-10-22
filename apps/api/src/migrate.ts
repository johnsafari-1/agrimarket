import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { Database, rows, run } from './db';
import { config } from './config';

export async function migrate(db: Database) {
  const sql = await readFile(resolve(__dirname, '../src/node-schema.sql'), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const c = await db.pool.getConnection();
  try {
    const [lock] = await rows(c, "SELECT GET_LOCK('agrimarket_node_migration',10) acquired");
    if (lock.acquired !== 1) throw new Error('Migration already running.');
    const columns = await rows(c, 'SHOW COLUMNS FROM users');
    for (const name of [
      'national_id',
      'location',
      'business_name',
      'reset_token',
      'locked_until',
    ]) {
      if (!columns.some((v) => v.Field === name))
        throw new Error(`Missing legacy users.${name}; upgrade your database COPY first.`);
    }
    await rows(c, 'SELECT estimated_delivery_date,estimated_delivery_window FROM orders LIMIT 0');
    await run(
      c,
      'CREATE TABLE IF NOT EXISTS node_migrations (name VARCHAR(100) PRIMARY KEY, checksum CHAR(64) NOT NULL, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP)',
    );
    const [previous] = await rows(c, 'SELECT checksum FROM node_migrations WHERE name=?', [
      '001_platform',
    ]);
    if (previous) {
      if (previous.checksum !== checksum) throw new Error('Applied migration checksum changed.');
      return;
    }
    for (const statement of sql
      .split(/;[ \t]*(?:\r?\n|$)/)
      .map((v) => v.trim())
      .filter(Boolean))
      await c.query(statement);
    await run(c, 'INSERT INTO node_migrations (name,checksum) VALUES (?,?)', [
      '001_platform',
      checksum,
    ]);
  } finally {
    await c.query("SELECT RELEASE_LOCK('agrimarket_node_migration')");
    c.release();
  }
}
async function main() {
  if (!/(_ts|_test)$/.test(config.DB_NAME) && process.env.ALLOW_MIGRATION !== config.DB_NAME)
    throw new Error(
      'Use a database COPY ending _ts or _test. For an approved cutover, explicitly set ALLOW_MIGRATION to the exact database name.',
    );
  const db = new Database();
  try {
    if (process.argv.includes('--init-empty')) {
      const tables = await db.rows('SHOW TABLES');
      if (tables.length) throw new Error('--init-empty requires a completely empty database.');
      const schema = (await readFile(resolve(__dirname, '../../../database/schema.sql'), 'utf8'))
        .split('-- SEED DATA')[0]
        .split('\n')
        .filter((line) => !line.startsWith('--') && !/^CREATE DATABASE|^USE /.test(line))
        .join('\n');
      for (const statement of schema
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean))
        await db.pool.query(statement);
    }
    await migrate(db);
    console.log(`Migration complete: ${config.DB_NAME}. Existing IDs and data retained.`);
  } finally {
    await db.onModuleDestroy();
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    console.error(
      'Migration failed. Check database prerequisites, permissions and migration checksum. No automatic rollback of MySQL DDL is possible.',
    );
    // Command-line diagnostics remain local; request/credential values are not printed.
    console.error(error instanceof Error ? error.message : 'Unknown migration error.');
    process.exitCode = 1;
  });
