import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';

export interface Limit {
  /** Requests allowed from one address in each window. */
  limit: number;
  /** Window length in milliseconds. */
  ttl: number;
}

const RATE_LIMIT = 'rateLimit';
/** A stricter (or looser) limit for one route than the default. */
export const RateLimit = (limit: Limit) => SetMetadata(RATE_LIMIT, limit);

/**
 * Global guard: counts requests per route and visitor address in fixed windows and answers
 * 429 when a limit is passed. Counts are kept in memory, so each API copy (or warm Vercel
 * instance) counts on its own. The default is RATE_LIMIT requests a minute (300 if unset).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly defaultLimit: Limit = { limit: Number(process.env.RATE_LIMIT ?? 300), ttl: 60_000 };
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweep = 0;

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const { limit, ttl } =
      this.reflector.getAllAndOverride<Limit>(RATE_LIMIT, [context.getHandler(), context.getClass()]) ?? this.defaultLimit;
    const req = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    this.sweep(now);

    const key = `${context.getClass().name}.${context.getHandler().name}:${req.ip}`;
    let w = this.windows.get(key);
    if (!w || w.resetAt <= now) {
      w = { count: 0, resetAt: now + ttl };
      this.windows.set(key, w);
    }
    if (++w.count > limit) {
      context
        .switchToHttp()
        .getResponse<Response>()
        .setHeader('Retry-After', Math.ceil((w.resetAt - now) / 1000));
      throw new HttpException('Too many requests. Wait a minute and try again.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  /** Forget finished windows now and then, so memory doesn't grow with every address seen. */
  private sweep(now: number) {
    if (now < this.nextSweep) return;
    this.nextSweep = now + 60_000;
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
