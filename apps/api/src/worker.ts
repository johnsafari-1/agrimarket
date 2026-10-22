import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { Mail } from './mail';
import { Payments } from './payments';
import { Database } from './db';
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      stopping = true;
    });
  const mail = app.get(Mail),
    payments = app.get(Payments);
  let lastCleanup = 0;
  while (!stopping) {
    try {
      await mail.deliverOne();
      await payments.processOne();
      if (Date.now() - lastCleanup > 3600000) {
        const db = app.get(Database);
        await db.run(
          'DELETE FROM node_sessions WHERE last_seen<UTC_TIMESTAMP()-INTERVAL 30 MINUTE OR created_at<UTC_TIMESTAMP()-INTERVAL 12 HOUR',
        );
        await db.run(
          'DELETE FROM auth_rate_limits WHERE started_at<UTC_TIMESTAMP()-INTERVAL 1 DAY',
        );
        lastCleanup = Date.now();
      }
    } catch {
      console.error('Worker operation deferred; check database availability.');
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  await app.close();
}
main().catch(() => {
  console.error('Worker failed to start.');
  process.exitCode = 1;
});
