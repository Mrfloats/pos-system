import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { and, eq, sql } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { memberships, tenants, users } from '../db/schema.js';
import { ALLOW_LAPSED, type AuthContext, DEVICE_REVOKED, GRACE_DAYS, IS_PLATFORM, IS_PUBLIC, JwtPayload, PlatformJwtPayload, Role, ROLES } from './auth-context.js';

/**
 * Global guard: verifies the bearer token, then re-reads the membership so a
 * deactivated staff member or a changed role takes effect immediately.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly dbs: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Sign in required');

    let verified: JwtPayload | PlatformJwtPayload;
    try {
      verified = await this.jwt.verifyAsync<JwtPayload | PlatformJwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired or invalid');
    }

    // Platform console and businesses never share tokens.
    const platformRoute = this.reflector.getAllAndOverride<boolean>(IS_PLATFORM, targets);
    if ('plat' in verified) {
      if (!platformRoute) throw new UnauthorizedException('A platform sign-in only opens the platform console');
      const [user] = await this.dbs.db
        .select({ admin: users.isPlatformAdmin })
        .from(users)
        .where(eq(users.id, verified.sub))
        .limit(1);
      if (!user?.admin) throw new UnauthorizedException('Platform access was removed');
      request.platform = { userId: verified.sub };
      return true;
    }
    if (platformRoute) throw new ForbiddenException('Sign in to the platform console for this');
    const payload = verified;

    const [membership] = await this.dbs.withTenant(
      { tenantId: payload.tid, userId: payload.sub },
      (tx) =>
        tx
          .select({
            id: memberships.id,
            role: memberships.role,
            active: memberships.active,
            status: tenants.subscriptionStatus,
            // Past the paid-up date plus the grace days.
            lapsed: sql<boolean>`coalesce(current_date > ${tenants.currentPeriodEnd} + ${GRACE_DAYS}::int, false)`,
            // A till session lasts only while the till is switched on and keeps the secret it signed in with.
            deviceOk: payload.did
              ? sql<boolean>`EXISTS (SELECT 1 FROM devices d WHERE d.id = ${payload.did} AND d.active AND left(d.token_hash, 16) = ${payload.dfp ?? ''})`
              : sql<boolean>`true`,
          })
          .from(memberships)
          .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
          .where(and(eq(memberships.id, payload.mid), eq(memberships.userId, payload.sub)))
          .limit(1),
    );
    if (!membership?.active) throw new UnauthorizedException('Access to this business was removed');
    if (!membership.deviceOk) {
      throw new UnauthorizedException({
        statusCode: HttpStatus.UNAUTHORIZED,
        code: DEVICE_REVOKED,
        message: 'This till was switched off or set up on another device. An owner or admin can set it up again.',
      });
    }

    // A lapsed or suspended subscription locks the business until Floatly records a payment.
    if ((membership.lapsed || membership.status !== 'active') && !this.reflector.getAllAndOverride<boolean>(ALLOW_LAPSED, targets)) {
      throw new HttpException(
        {
          statusCode: HttpStatus.PAYMENT_REQUIRED,
          code: 'subscription_inactive',
          message:
            membership.status === 'suspended'
              ? 'This business is suspended. Contact Floatly to restore access.'
              : membership.status === 'cancelled'
                ? "This business's Floatly subscription was cancelled."
                : "This business's Floatly subscription has ended. Renew it to keep working.",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const auth: AuthContext = {
      userId: payload.sub,
      tenantId: payload.tid,
      membershipId: membership.id,
      role: membership.role,
      deviceId: payload.did,
    };
    request.auth = auth;

    const allowed = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, targets);
    if (allowed && !allowed.includes(auth.role)) {
      throw new ForbiddenException('Your role cannot do this');
    }
    return true;
  }
}
