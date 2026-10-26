import { NestFactory } from '@nestjs/core';
import { ExpressAdapter, type NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

/** The API as it runs in production, not yet listening. Used by main.ts and by Vercel (vercel.ts). */
export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, new ExpressAdapter());
  setupApp(app);
  // The visitor's address, used for rate limits and logs. Behind Caddy (and possibly a Cloudflare
  // Tunnel) it is the last X-Forwarded-For entry that isn't a private address. On Vercel the edge
  // replaces X-Forwarded-For with the visitor's address, so the header can be trusted as it is.
  app.set('trust proxy', process.env.TRUST_PROXY ?? (process.env.VERCEL ? true : 'loopback, linklocal, uniquelocal'));
  app.use(helmet());
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim()),
    credentials: true,
    // When the website and API are on different addresses (Vercel), browsers ask before each call; remember the answer for an hour.
    maxAge: 3600,
  });

  const docs = new DocumentBuilder()
    .setTitle('Floatly API')
    .setDescription('Backoffice and till API for retail, wholesale and restaurant businesses')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  // Interactive API docs. Switch off on a public server with API_DOCS=false.
  if (process.env.API_DOCS !== 'false') SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, docs));
  return app;
}
