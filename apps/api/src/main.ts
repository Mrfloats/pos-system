import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { createApp } from './create-app.js';

async function bootstrap() {
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  Logger.log(`API ready on http://localhost:${port}/api/v1 — docs at /api/docs`, 'Bootstrap');
}
await bootstrap();
