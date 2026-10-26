import { Body, Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowLapsed, type AuthContext, Ctx, Public } from '../common/auth-context.js';
import { type Limit, RateLimit } from '../common/rate-limit.js';
import { ChangePasswordDto, LoginDto, SignupRequestDto, SwitchTenantDto, TillSignInDto } from './auth.dto.js';
import { AuthService } from './auth.service.js';

/** Sign-up and sign-in attempts per minute from one address (raised only by the test suite). */
export const AUTH_LIMIT: Limit = { limit: Number(process.env.AUTH_RATE_LIMIT ?? 10), ttl: 60_000 };
/** PIN sign-ins per minute from one address. Higher: a shop's tills share one address and cashiers swap often. */
export const TILL_LIMIT: Limit = { limit: Number(process.env.TILL_RATE_LIMIT ?? 30), ttl: 60_000 };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Plans on offer, with prices. Shown on the sign-up page. */
  @Public()
  @Get('plans')
  plans() {
    return this.auth.plans();
  }

  /** Ask to open a new business. Floatly staff approve it before the owner can sign in. */
  @Public()
  @RateLimit(AUTH_LIMIT)
  @Post('signup-requests')
  requestSignup(@Body() dto: SignupRequestDto) {
    return this.auth.requestSignup(dto);
  }

  @Public()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  /** Sign in on a paired till with a staff member's PIN. */
  @Public()
  @RateLimit(TILL_LIMIT)
  @HttpCode(200)
  @Post('till')
  tillSignIn(@Body() dto: TillSignInDto) {
    return this.auth.tillSignIn(dto);
  }

  @ApiBearerAuth()
  @AllowLapsed()
  @Get('me')
  me(@Ctx() ctx: AuthContext) {
    return this.auth.me(ctx);
  }

  /** Get a new token for another business the user belongs to. */
  @ApiBearerAuth()
  @HttpCode(200)
  @AllowLapsed()
  @Post('switch-tenant')
  switchTenant(@Ctx() ctx: AuthContext, @Body() dto: SwitchTenantDto) {
    // A till session is tied to its till; swapping it for an ordinary one would outlive switching the till off.
    if (ctx.deviceId) throw new ForbiddenException('Switch business in the backoffice, not on a till');
    return this.auth.switchTenant(ctx.userId, dto.tenantId);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @AllowLapsed()
  @Post('change-password')
  changePassword(@Ctx() ctx: AuthContext, @Body() dto: ChangePasswordDto) {
    return this.auth.changePassword(ctx, dto);
  }
}
