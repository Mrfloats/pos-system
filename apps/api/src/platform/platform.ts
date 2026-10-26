import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, Post, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { hash, verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import { AUTH_LIMIT } from '../auth/auth.controller.js';
import { LoginDto } from '../auth/auth.dto.js';
import { AuditService } from '../common/audit.service.js';
import { type PlatformContext, PlatformCtx, PlatformJwtPayload, PlatformOnly, Public } from '../common/auth-context.js';
import { RateLimit } from '../common/rate-limit.js';
import { DbService } from '../db/db.service.js';
import { users } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';

/**
 * The platform console, for Floatly's own staff: every business on the
 * system, read-only. Business data is read through the platform_* database
 * functions, which check the caller is a platform admin themselves.
 */
@Injectable()
export class PlatformService {
  private readonly dummyHash = hash('not-a-real-password');

  constructor(
    private readonly dbs: DbService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(dto: LoginDto) {
    const [user] = await this.dbs.db
      .select({ id: users.id, passwordHash: users.passwordHash, admin: users.isPlatformAdmin, fullName: users.fullName, email: users.email })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), dto.password).catch(() => false);
    // Same message for a wrong password and a non-admin, so the console doesn't reveal who has access.
    if (!user || !ok || !user.admin) throw new UnauthorizedException('Wrong email or password, or no platform access');
    await this.dbs.db.update(users).set({ lastLoginAt: sql`now()` }).where(eq(users.id, user.id));
    const payload: PlatformJwtPayload = { sub: user.id, plat: true };
    return {
      accessToken: await this.jwt.signAsync(payload, { expiresIn: '8h' }),
      user: { id: user.id, email: user.email, fullName: user.fullName },
    };
  }

  async me(ctx: PlatformContext) {
    const [user] = await this.dbs.db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, ctx.userId));
    return user;
  }

  private call(ctx: PlatformContext, query: ReturnType<typeof sql>) {
    return this.dbs.withUser(ctx.userId, async (tx) => (await tx.execute(sql`SELECT ${query} AS data`)).rows[0]?.data);
  }

  overview(ctx: PlatformContext) {
    return this.call(ctx, sql`platform_overview()`);
  }

  businesses(ctx: PlatformContext) {
    return this.call(ctx, sql`platform_businesses()`);
  }

  /** One business in detail. The visit is written to that business's own audit log. */
  async business(ctx: PlatformContext, id: string) {
    const data = await this.call(ctx, sql`platform_business(${id}::uuid)`);
    if (!data) throw new NotFoundException('Business not found');
    await this.dbs.withTenant({ tenantId: id, userId: ctx.userId }, (tx) =>
      this.audit.log(tx, { tenantId: id, userId: ctx.userId }, 'platform_view', 'Business', id, { by: 'Floatly support' }),
    );
    return data;
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@Controller('platform')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Public()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @PlatformOnly()
  @Get('me')
  me(@PlatformCtx() ctx: PlatformContext) {
    return this.svc.me(ctx);
  }

  @PlatformOnly()
  @Get('overview')
  overview(@PlatformCtx() ctx: PlatformContext) {
    return this.svc.overview(ctx);
  }

  @PlatformOnly()
  @Get('businesses')
  businesses(@PlatformCtx() ctx: PlatformContext) {
    return this.svc.businesses(ctx);
  }

  @PlatformOnly()
  @Get('businesses/:id')
  business(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam) {
    return this.svc.business(ctx, p.id);
  }
}

@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
})
export class PlatformModule {}
