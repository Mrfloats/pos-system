import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { DbErrorFilter } from './common/db-error.filter.js';

/** Shared by main.ts and the e2e tests so both run the app the same way. */
export function setupApp(app: INestApplication) {
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // drop fields that aren't in the DTO
      forbidNonWhitelisted: true, // …and tell the caller
      transform: true,
    }),
  );
  app.useGlobalFilters(new DbErrorFilter(app.get(HttpAdapterHost).httpAdapter));
  app.enableShutdownHooks();
  return app;
}
