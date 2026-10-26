/**
 * The API as a Vercel function (see api/index.js and vercel.json). Vercel sends every request
 * here; the app is built on the first request and reused while the function stays warm.
 */
import 'reflect-metadata';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './create-app.js';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let handler: Promise<Handler> | undefined;

async function build(): Promise<Handler> {
  const app = await createApp();
  await app.init();
  return app.getHttpAdapter().getInstance();
}

export default async function vercelHandler(req: IncomingMessage, res: ServerResponse) {
  handler ??= build().catch((err) => {
    handler = undefined; // try again on the next request (e.g. the database was waking up)
    throw err;
  });
  (await handler)(req, res);
}
