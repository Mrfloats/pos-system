import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './create-app.js';
import { DailyChecksService } from './notifications/daily-checks.js';

/** How often a long-running server checks for date-based emails (each goes once, so often is fine). */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api/v1 — docs at /api/docs`, 'Bootstrap');

  // On Vercel, Vercel Cron calls GET /cron/daily instead; this file doesn't run there.
  const checks = app.get(DailyChecksService);
  const run = () => checks.run().catch((err: Error) => Logger.error(`Daily checks failed: ${err.message}`, 'DailyChecks'));
  setTimeout(run, 60_000).unref();
  setInterval(run, CHECK_EVERY_MS).unref();
}
await bootstrap();
