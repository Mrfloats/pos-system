import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuthContext, DEVICE_REVOKED, JwtPayload, MANAGERS } from '../common/auth-context.js';
import { AuditService } from '../common/audit.service.js';
import { assertNotLocked, clearFailures, recordFailure } from '../common/lockout.js';
import { effectivePermissions } from '../common/permissions.js';
import { nextStaffCode } from '../common/staff-code.js';
import { EmailsService, render } from '../common/emails.service.js';
import { MailService, webUrl } from '../common/mail.service.js';
import { DbService, Tx } from '../db/db.service.js';
import { devices, memberships, passwordResets, plans, refreshTokens, signupRequests, stores, storeStaff, tenants, users } from '../db/schema.js';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  RefreshDto,
  ResetPasswordDto,
  ResetTokenDto,
  SetPinDto,
  SignupDto,
  SignupRequestDto,
  TillSignInDto,
} from './auth.dto.js';
import { TenantSetupService } from './tenant-setup.service.js';

/** A phone's access token lasts this long; the app swaps its refresh token for a new one before then. */
const MOBILE_ACCESS_SECONDS = Number(process.env.MOBILE_ACCESS_SECONDS ?? 900);
/** A phone sign-in left unused for this many days ends. */
const REFRESH_IDLE_DAYS = Number(process.env.REFRESH_IDLE_DAYS ?? 30);
/**
 * A refresh token may be used again for this long after it was swapped: a phone
 * on a bad connection can miss the answer and ask twice. Later than that, a
 * second use means the token was copied.
 */
const REFRESH_REUSE_GRACE_SECONDS = 60;

/** How long a "forgot password" link works. */
const RESET_MINUTES = 60;
const DEAD_RESET_LINK = 'This link has expired or was already used. Ask for a new one.';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** What a new business needs: its details and its owner's login. */
export interface NewBusiness {
  businessName: string;
  businessType: SignupDto['businessType'];
  country?: string;
  baseCurrency?: string;
  fullName: string;
  email: string;
  phone?: string | null;
  passwordHash: string;
}

@Injectable()
export class AuthService {
  /** Checked against when the email is unknown, so login timing doesn't reveal which emails exist. */
  private readonly dummyHash = hash('not-a-real-password');

  constructor(
    private readonly dbs: DbService,
    private readonly jwt: JwtService,
    private readonly setup: TenantSetupService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
    private readonly emails: EmailsService,
  ) {}

  /**
   * Creates a business, its owner account and default settings, then signs the
   * owner in. Used by the demo seed; real businesses come from approved
   * sign-up requests (see createBusinessIn).
   */
  async signup(dto: SignupDto) {
    await this.assertEmailFree(dto.email);
    const passwordHash = await hash(dto.password);
    const { userId, tenantId } = await this.dbs.db.transaction((tx) => this.createBusinessIn(tx, { ...dto, passwordHash }));
    return this.session(userId, tenantId);
  }

  async assertEmailFree(email: string) {
    const [existing] = await this.dbs.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new ConflictException('An account with this email already exists. Sign in instead.');
  }

  /**
   * Creates the owner's login, the business and its starting settings inside
   * the caller's transaction. Sets app.tenant_id to the new business; app.user_id
   * is the caller's (Floatly staff when approving a request).
   */
  async createBusinessIn(tx: Tx, input: NewBusiness) {
    const tenantId = uuidv7();
    const country = input.country ?? 'ZW';
    const baseCurrency = input.baseCurrency ?? 'USD';
    const [user] = await tx
      .insert(users)
      .values({ email: input.email, passwordHash: input.passwordHash, fullName: input.fullName, phone: input.phone ?? null })
      .returning({ id: users.id });
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    await tx.insert(tenants).values({
      id: tenantId,
      name: input.businessName,
      businessType: input.businessType,
      country,
      baseCurrency,
      phone: input.phone ?? null,
      email: input.email,
    });
    await tx.insert(memberships).values({ tenantId, userId: user.id, role: 'owner', staffCode: await nextStaffCode(tx, 'owner') });
    await this.setup.seedDefaults(tx, tenantId, { businessType: input.businessType, country, baseCurrency });
    return { userId: user.id, tenantId };
  }

  /** Plans a new business can choose, cheapest first. Public: the sign-up page shows them. */
  plans() {
    return this.dbs.db
      .select({
        id: plans.id,
        code: plans.code,
        name: plans.name,
        description: plans.description,
        monthlyPrice: plans.monthlyPrice,
        yearlyPrice: plans.yearlyPrice,
        currency: plans.currency,
        maxStores: plans.maxStores,
        maxStaff: plans.maxStaff,
        features: plans.features,
      })
      .from(plans)
      .where(eq(plans.active, true))
      .orderBy(asc(plans.sortOrder), asc(plans.monthlyPrice));
  }

  /** The latest sign-up request for an email (through a narrow database function). */
  private async requestFor(email: string) {
    const res = await this.dbs.db.execute(sql`SELECT * FROM signup_request_for(${email})`);
    return res.rows[0] as { id: string; status: 'pending' | 'approved' | 'rejected'; password_hash: string; business_name: string; decision_note: string | null } | undefined;
  }

  /** A new business asks to join Floatly. Floatly staff approve or turn it down in the platform console. */
  async requestSignup(dto: SignupRequestDto) {
    await this.assertEmailFree(dto.email);
    const existing = await this.requestFor(dto.email);
    if (existing?.status === 'pending') {
      throw new ConflictException(`There's already a request for ${existing.business_name} waiting for approval with this email.`);
    }
    const [plan] = await this.dbs.db.select({ id: plans.id, name: plans.name, active: plans.active }).from(plans).where(eq(plans.id, dto.planId)).limit(1);
    if (!plan?.active) throw new BadRequestException('Choose one of the plans on offer');
    const id = uuidv7();
    // No RETURNING: applicants may add a request but not read requests back.
    await this.dbs.db.insert(signupRequests).values({
      id,
      businessName: dto.businessName,
      businessType: dto.businessType,
      country: dto.country ?? 'ZW',
      baseCurrency: dto.baseCurrency ?? 'USD',
      fullName: dto.fullName,
      email: dto.email,
      phone: dto.phone ?? null,
      passwordHash: await hash(dto.password),
      planId: dto.planId,
      billingPeriod: dto.billingPeriod,
      message: dto.message ?? null,
    });
    await this.emails.signupReceived(dto);
    await this.emails.signupWaiting({ ...dto, planName: plan.name });
    return { id, status: 'pending' as const, businessName: dto.businessName, email: dto.email };
  }

  async login(dto: LoginDto) {
    const [user] = await this.dbs.db
      .select({ id: users.id, passwordHash: users.passwordHash, lockedUntil: users.lockedUntil, failedLogins: users.failedLogins })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    // Locked after too many wrong passwords: even the right one waits.
    assertNotLocked(user?.lockedUntil);

    const ok = await verify(user?.passwordHash ?? (await this.dummyHash), dto.password).catch(() => false);
    if (!user) {
      // No login yet: if they asked to join (and this is the password they chose), say where it stands.
      const request = await this.requestFor(dto.email);
      if (request && request.status !== 'approved' && (await verify(request.password_hash, dto.password).catch(() => false))) {
        throw new ForbiddenException(
          request.status === 'pending'
            ? `Your request to open ${request.business_name} is waiting for approval. You can sign in as soon as it's approved.`
            : `Your request to open ${request.business_name} wasn't approved${request.decision_note ? `: ${request.decision_note}` : '.'}`,
        );
      }
    }
    if (user && !ok) await recordFailure(this.dbs.db, user.id, (id) => this.emails.accountLocked(id));
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');

    const choices = await this.businessesFor(user.id);
    if (!choices.length) throw new UnauthorizedException('This account has no active business');

    const chosen = dto.tenantId ? choices.find((c) => c.tenantId === dto.tenantId) : choices[0];
    if (!chosen) throw new UnauthorizedException('You do not have access to that business');

    await this.dbs.db
      .update(users)
      .set({ lastLoginAt: sql`now()`, failedLogins: 0, lockedUntil: null })
      .where(eq(users.id, user.id));
    return dto.session === 'mobile' ? this.mobileSession(user.id, chosen.tenantId) : this.session(user.id, chosen.tenantId);
  }

  /**
   * Swaps a phone's refresh token for a new access token and a new refresh token
   * (optionally in another of the person's businesses). A token that was already
   * swapped a while ago has been copied: every token from that sign-in is ended.
   */
  async refresh(dto: RefreshDto) {
    const tokenHash = sha256(dto.refreshToken);
    const row = await this.dbs.db.transaction(async (tx) => {
      const [t] = await tx
        .select({
          id: refreshTokens.id,
          familyId: refreshTokens.familyId,
          userId: refreshTokens.userId,
          tenantId: refreshTokens.tenantId,
          used: isNotNull(refreshTokens.usedAt),
          dead: sql<boolean>`${refreshTokens.revokedAt} IS NOT NULL OR ${refreshTokens.expiresAt} <= now()`,
          reused: sql<boolean>`coalesce(${refreshTokens.usedAt} < now() - make_interval(secs => ${REFRESH_REUSE_GRACE_SECONDS}), false)`,
        })
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, tokenHash))
        .for('update');
      if (!t || t.dead) return undefined;
      if (t.reused) {
        await tx.update(refreshTokens).set({ revokedAt: sql`now()` }).where(and(eq(refreshTokens.familyId, t.familyId), isNull(refreshTokens.revokedAt)));
        return undefined;
      }
      if (!t.used) await tx.update(refreshTokens).set({ usedAt: sql`now()` }).where(eq(refreshTokens.id, t.id));
      // Tidy up this person's long-dead tokens while we're here.
      await tx.delete(refreshTokens).where(and(eq(refreshTokens.userId, t.userId), lt(refreshTokens.expiresAt, sql`now()`)));
      return t;
    });
    if (!row) throw new UnauthorizedException('Your session has ended. Sign in again.');
    // session() refuses if the person no longer belongs to the business.
    return this.mobileSession(row.userId, dto.tenantId ?? row.tenantId, row.familyId);
  }

  /** Ends a phone sign-in. Always answers ok, so it can't be used to test tokens. */
  async logout(dto: LogoutDto) {
    const [t] = await this.dbs.db.select({ familyId: refreshTokens.familyId }).from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(dto.refreshToken)));
    if (t) {
      await this.dbs.db.update(refreshTokens).set({ revokedAt: sql`now()` }).where(and(eq(refreshTokens.familyId, t.familyId), isNull(refreshTokens.revokedAt)));
    }
    return { ok: true };
  }

  /** Sets the signed-in person's own PIN, after checking their password. PINs are unique in a business. */
  async setPin(auth: AuthContext, dto: SetPinDto) {
    const [user] = await this.dbs.db.select({ passwordHash: users.passwordHash, lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, auth.userId));
    assertNotLocked(user.lockedUntil);
    if (!(await verify(user.passwordHash, dto.password).catch(() => false))) {
      await recordFailure(this.dbs.db, auth.userId, (id) => this.emails.accountLocked(id));
      throw new BadRequestException('Wrong password');
    }
    await clearFailures(this.dbs.db, auth.userId);
    await this.dbs.withTenant(auth, async (tx) => {
      const others = await tx
        .select({ pinHash: memberships.pinHash })
        .from(memberships)
        .where(and(isNotNull(memberships.pinHash), ne(memberships.id, auth.membershipId)));
      for (const o of others) {
        if (await verify(o.pinHash!, dto.pin).catch(() => false)) throw new ConflictException('Choose a different PIN');
      }
      await tx.update(memberships).set({ pinHash: await hash(dto.pin) }).where(eq(memberships.id, auth.membershipId));
      await this.audit.log(tx, auth, 'set_pin', 'Staff', auth.membershipId);
    });
    return { ok: true };
  }

  /**
   * Signs a staff member in on a paired till. The device token picks the business
   * and store (through a narrow database function, since no business is chosen
   * yet); the PIN picks the person, who must be allowed to work in that store.
   */
  async tillSignIn(dto: TillSignInDto) {
    const tokenHash = createHash('sha256').update(dto.deviceToken).digest('hex');
    const res = await this.dbs.db.execute(sql`SELECT * FROM till_device_for_token(${tokenHash})`);
    const device = res.rows[0] as { id: string; tenant_id: string; store_id: string; active: boolean } | undefined;
    if (!device?.active) {
      throw new UnauthorizedException({ statusCode: 401, code: DEVICE_REVOKED, message: 'This till was switched off or set up on another device. An owner or admin can set it up again.' });
    }

    const tenantId = device.tenant_id;
    const userId = await this.dbs.withTenant({ tenantId }, async (tx) => {
      const [store] = await tx.select({ active: stores.active }).from(stores).where(eq(stores.id, device.store_id));
      if (!store?.active) throw new ForbiddenException("This till's store is closed in the backoffice");

      const staff = await tx
        .select({ id: memberships.id, userId: memberships.userId, pinHash: memberships.pinHash })
        .from(memberships)
        .where(and(eq(memberships.active, true), isNotNull(memberships.pinHash)));
      let match: (typeof staff)[number] | undefined;
      for (const s of staff) {
        if (await verify(s.pinHash!, dto.pin).catch(() => false)) {
          match = s;
          break;
        }
      }
      if (!match) throw new UnauthorizedException('Wrong PIN');

      // No store rows means every store (owners, admins).
      const access = await tx.select({ storeId: storeStaff.storeId }).from(storeStaff).where(eq(storeStaff.membershipId, match.id));
      if (access.length && !access.some((a) => a.storeId === device.store_id)) {
        throw new ForbiddenException("You aren't set up to work in this store");
      }
      await tx.update(devices).set({ lastSeenAt: sql`now()` }).where(eq(devices.id, device.id));
      return match.userId;
    });
    const session = await this.session(userId, tenantId, { did: device.id, dfp: tokenHash.slice(0, 16) });
    return { ...session, device: { id: device.id, storeId: device.store_id } };
  }

  async switchTenant(userId: string, tenantId: string) {
    const choices = await this.businessesFor(userId);
    if (!choices.some((c) => c.tenantId === tenantId)) {
      throw new UnauthorizedException('You do not have access to that business');
    }
    return this.session(userId, tenantId);
  }

  async me(auth: AuthContext) {
    return this.profile(auth.userId, auth.tenantId);
  }

  async changePassword(auth: AuthContext, dto: ChangePasswordDto) {
    const [user] = await this.dbs.db
      .select({ passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, auth.userId));
    const ok = await verify(user.passwordHash, dto.currentPassword).catch(() => false);
    if (!ok) throw new BadRequestException('Current password is wrong');
    await this.dbs.db
      .update(users)
      .set({ passwordHash: await hash(dto.newPassword) })
      .where(eq(users.id, auth.userId));
    await this.emails.passwordChanged(auth.userId, 'changed');
    return { ok: true };
  }

  /**
   * "Forgot password": emails a link to choose a new one. The answer is the same whether
   * or not the email has a login, so the form can't be used to find out who does.
   */
  async forgotPassword(dto: ForgotPasswordDto) {
    if (!this.mail.ready) {
      throw new ServiceUnavailableException("Resetting a password by email isn't set up on this Floatly server yet. Ask the business owner or Floatly for help.");
    }
    const [user] = await this.dbs.db.select({ id: users.id, email: users.email, fullName: users.fullName }).from(users).where(eq(users.email, dto.email)).limit(1);
    if (!user) return { ok: true };
    // At most one email a minute, so the form can't be used to flood someone's inbox.
    const [recent] = await this.dbs.db
      .select({ id: passwordResets.id })
      .from(passwordResets)
      .where(and(eq(passwordResets.userId, user.id), sql`${passwordResets.createdAt} > now() - interval '1 minute'`))
      .limit(1);
    if (recent) return { ok: true };

    const token = `pr_${randomBytes(32).toString('base64url')}`;
    await this.dbs.db.insert(passwordResets).values({
      id: uuidv7(),
      userId: user.id,
      tokenHash: sha256(token),
      expiresAt: sql`now() + make_interval(mins => ${RESET_MINUTES})`,
    });
    // After #, so the token never reaches a server log or another site as a referrer.
    // Unlike the other emails, a failure here is the answer: they're waiting for this one.
    await this.mail.send(
      render(user, {
        subject: 'Reset your Floatly password',
        lines: [`Someone asked to reset the password for your Floatly login (${user.email}). To choose a new password, use the link within ${RESET_MINUTES} minutes.`],
        button: { label: 'Choose a new password', url: `${webUrl()}/reset-password#${token}` },
        after: ["If it wasn't you, ignore this email. Your password stays as it is."],
      }),
    );
    return { ok: true };
  }

  /** Whose password a reset link is for, before they choose one. */
  async checkReset(dto: ResetTokenDto) {
    const [reset] = await this.dbs.db
      .select({ email: users.email })
      .from(passwordResets)
      .innerJoin(users, eq(users.id, passwordResets.userId))
      .where(and(eq(passwordResets.tokenHash, sha256(dto.token)), isNull(passwordResets.usedAt), sql`${passwordResets.expiresAt} > now()`))
      .limit(1);
    if (!reset) throw new BadRequestException(DEAD_RESET_LINK);
    return { email: reset.email };
  }

  /**
   * Sets the new password from a reset link. The link and any others for the same login stop
   * working, a lockout ends, and every sign-in on a phone or in a browser ends (tills keep theirs).
   */
  async resetPassword(dto: ResetPasswordDto) {
    const passwordHash = await hash(dto.password);
    const done = await this.dbs.db.transaction(async (tx) => {
      const [reset] = await tx
        .select({ userId: passwordResets.userId })
        .from(passwordResets)
        .where(and(eq(passwordResets.tokenHash, sha256(dto.token)), isNull(passwordResets.usedAt), sql`${passwordResets.expiresAt} > now()`))
        .for('update')
        .limit(1);
      if (!reset) throw new BadRequestException(DEAD_RESET_LINK);
      const [user] = await tx
        .update(users)
        .set({ passwordHash, failedLogins: 0, lockedUntil: null, signedOutAt: sql`now()` })
        .where(eq(users.id, reset.userId))
        .returning({ email: users.email });
      await tx.update(passwordResets).set({ usedAt: sql`now()` }).where(and(eq(passwordResets.userId, reset.userId), isNull(passwordResets.usedAt)));
      await tx.update(refreshTokens).set({ revokedAt: sql`now()` }).where(and(eq(refreshTokens.userId, reset.userId), isNull(refreshTokens.revokedAt)));
      return { userId: reset.userId, email: user.email };
    });
    await this.emails.passwordChanged(done.userId, 'reset');
    return { ok: true, email: done.email };
  }

  /** Active businesses this user belongs to, oldest first. */
  private businessesFor(userId: string) {
    return this.dbs.withUser(userId, (tx) =>
      tx
        .select({
          tenantId: memberships.tenantId,
          membershipId: memberships.id,
          role: memberships.role,
          staffCode: memberships.staffCode,
          hasPin: isNotNull(memberships.pinHash),
          denied: memberships.deniedPermissions,
          name: tenants.name,
          businessType: tenants.businessType,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
        .orderBy(asc(memberships.createdAt)),
    );
  }

  private async session(userId: string, tenantId: string, extra?: Pick<JwtPayload, 'did' | 'dfp' | 'plt'>) {
    const profile = await this.profile(userId, tenantId);
    const payload: JwtPayload = { sub: userId, tid: tenantId, mid: profile.membership.id, ...extra };
    const accessToken = extra?.plt ? await this.jwt.signAsync(payload, { expiresIn: MOBILE_ACCESS_SECONDS }) : await this.jwt.signAsync(payload);
    return { accessToken, ...profile };
  }

  /** A phone session: a short-lived access token plus a refresh token (a new one each time, in the same family). */
  private async mobileSession(userId: string, tenantId: string, familyId: string = uuidv7()) {
    const session = await this.session(userId, tenantId, { plt: 'mobile' });
    // The phone app is the backoffice in your pocket: not for cashiers, waiters and other till staff.
    if (!MANAGERS.includes(session.membership.role)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'not_for_role',
        message: 'Managing the business on a phone is for owners, admins and managers. Sign in on a till with your PIN instead.',
      });
    }
    const refreshToken = `rt_${randomBytes(32).toString('base64url')}`;
    await this.dbs.db.insert(refreshTokens).values({
      familyId,
      userId,
      tenantId,
      tokenHash: sha256(refreshToken),
      expiresAt: sql`now() + make_interval(days => ${REFRESH_IDLE_DAYS})`,
    });
    return { ...session, refreshToken, expiresIn: MOBILE_ACCESS_SECONDS };
  }

  private async profile(userId: string, tenantId: string) {
    const [user] = await this.dbs.db
      .select({ id: users.id, email: users.email, fullName: users.fullName, phone: users.phone })
      .from(users)
      .where(eq(users.id, userId));
    const businesses = await this.businessesFor(userId);
    const current = businesses.find((b) => b.tenantId === tenantId);
    if (!current) throw new UnauthorizedException('You do not have access to that business');

    const [tenant] = await this.dbs.withTenant({ tenantId, userId }, (tx) =>
      tx.select().from(tenants).where(eq(tenants.id, tenantId)),
    );
    return {
      user,
      tenant,
      // What the apps show; the API checks each request itself.
      membership: { id: current.membershipId, role: current.role, staffCode: current.staffCode, hasPin: current.hasPin, permissions: effectivePermissions(current.role, current.denied) },
      businesses: businesses.map((b) => ({
        tenantId: b.tenantId,
        name: b.name,
        businessType: b.businessType,
        role: b.role,
      })),
    };
  }
}
