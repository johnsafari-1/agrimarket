import { Injectable, OnModuleDestroy } from '@nestjs/common';
import mysql, { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { config } from './config';
export type Row = RowDataPacket & Record<string, any>;
export type Connection = PoolConnection;
export async function rows(
  db: { execute: Function },
  sql: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const [result] = await db.execute(sql, values);
  return result as Row[];
}
export async function run(
  db: { execute: Function },
  sql: string,
  values: unknown[] = [],
): Promise<ResultSetHeader> {
  const [result] = await db.execute(sql, values);
  return result as ResultSetHeader;
}
@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  constructor() {
    this.pool.on('connection', (c) => {
      c.query("SET time_zone = '+00:00'");
    });
  }
  rows(sql: string, values: unknown[] = []) {
    return rows(this.pool, sql, values);
  }
  run(sql: string, values: unknown[] = []) {
    return run(this.pool, sql, values);
  }
  async transaction<T>(callback: (c: Connection) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const result = await callback(c);
      await c.commit();
      return result;
    } catch (error) {
      await c.rollback();
      throw error;
    } finally {
      c.release();
    }
  }
  async onModuleDestroy() {
    await this.pool.end();
  }
}
