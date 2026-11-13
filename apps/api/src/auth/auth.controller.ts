import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AllowLapsed, type AuthContext, Ctx, Public } from '../common/auth-context.js';
import { PIN_NOT_SET } from '../common/lockout.js';
import { type Limit, RateLimit } from '../common/rate-limit.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  ResetTokenDto,
  SetPinDto,
  SignupRequestDto,
  SwitchTenantDto,
  TillSignInDto,
} from './auth.dto.js';
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

  /** Phone app: swap the refresh token for a new access token and a new refresh token. The old one stops working. */
  @Public()
  @RateLimit(TILL_LIMIT)
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto);
  }

  /** Phone app: end the sign-in, so its refresh token can't be used again. */
  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Body() dto: LogoutDto) {
    return this.auth.logout(dto);
  }

  /** "Forgot password": emails a link to choose a new one. The same answer whether or not the email has a login. */
  @Public()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.forgotPassword(dto);
  }

  /** Whose login a reset link is for, so the page can say so before they choose a password. */
  @Public()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('reset-password/check')
  checkReset(@Body() dto: ResetTokenDto) {
    return this.auth.checkReset(dto);
  }

  /** Choose a new password with the link's token. Ends every sign-in except on tills. */
  @Public()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('reset-password')
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.resetPassword(dto);
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

  /**
   * Checks the PIN sent in X-Floatly-Pin (the auth guard has already compared it;
   * wrong PINs never get here). The phone app uses it to unlock after a pause.
   */
  @ApiBearerAuth()
  @HttpCode(200)
  @AllowLapsed()
  @Post('verify-pin')
  verifyPin(@Ctx() ctx: AuthContext) {
    if (!ctx.hasPin) throw new ForbiddenException({ statusCode: 403, code: PIN_NOT_SET, message: 'Set a PIN for yourself first' });
    if (!ctx.pinConfirmed) throw new BadRequestException('Send your PIN to check it');
    return { ok: true };
  }

  /** Choose (or change) your own PIN, proven with your password. */
  @ApiBearerAuth()
  @RateLimit(AUTH_LIMIT)
  @HttpCode(200)
  @Post('pin')
  setPin(@Ctx() ctx: AuthContext, @Body() dto: SetPinDto) {
    if (ctx.deviceId) throw new ForbiddenException('Change your PIN in the backoffice or the phone app, not on a till');
    return this.auth.setPin(ctx, dto);
  }

  /** Get a new token for another business the user belongs to. */
  @ApiBearerAuth()
  @HttpCode(200)
  @AllowLapsed()
  @Post('switch-tenant')
  switchTenant(@Ctx() ctx: AuthContext, @Body() dto: SwitchTenantDto) {
    // A till session is tied to its till; swapping it for an ordinary one would outlive switching the till off.
    if (ctx.deviceId) throw new ForbiddenException('Switch business in the backoffice, not on a till');
    // A phone session switches with its refresh token (POST /auth/refresh), so the new session can be refreshed too.
    if (ctx.mobileSession) throw new ForbiddenException('Switch business with your refresh token');
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
