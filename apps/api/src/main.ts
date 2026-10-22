import { createApp } from './app';
import { config } from './config';
import { Database } from './db';
async function main() {
  const app = await createApp();
  try {
    const [migration] = await app
      .get(Database)
      .rows("SELECT name FROM node_migrations WHERE name='001_platform'");
    if (!migration) throw new Error('Apply the Node schema migration first.');
    await app.listen(config.PORT, '127.0.0.1');
    console.log(`AgriMarket API: http://127.0.0.1:${config.PORT}/api`);
  } catch (error) {
    await app.close();
    throw error;
  }
}
main().catch(() => {
  console.error('API failed to start. Check environment and database settings.');
  process.exitCode = 1;
});
