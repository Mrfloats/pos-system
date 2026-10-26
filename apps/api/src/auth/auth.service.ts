import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hash, verify } from '@node-rs/argon2';
import { createHash } from 'node:crypto';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import { type AuthContext, DEVICE_REVOKED, JwtPayload } from '../common/auth-context.js';
import { DbService, Tx } from '../db/db.service.js';
import { devices, memberships, plans, signupRequests, stores, storeStaff, tenants, users } from '../db/schema.js';
import { ChangePasswordDto, LoginDto, SignupDto, SignupRequestDto, TillSignInDto } from './auth.dto.js';
import { TenantSetupService } from './tenant-setup.service.js';

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
    await tx.insert(memberships).values({ tenantId, userId: user.id, role: 'owner' });
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
    const [plan] = await this.dbs.db.select({ id: plans.id, active: plans.active }).from(plans).where(eq(plans.id, dto.planId)).limit(1);
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
    return { id, status: 'pending' as const, businessName: dto.businessName, email: dto.email };
  }

  async login(dto: LoginDto) {
    const [user] = await this.dbs.db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);

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
    if (!user || !ok) throw new UnauthorizedException('Wrong email or password');

    const choices = await this.businessesFor(user.id);
    if (!choices.length) throw new UnauthorizedException('This account has no active business');

    const chosen = dto.tenantId ? choices.find((c) => c.tenantId === dto.tenantId) : choices[0];
    if (!chosen) throw new UnauthorizedException('You do not have access to that business');

    await this.dbs.db
      .update(users)
      .set({ lastLoginAt: sql`now()` })
      .where(eq(users.id, user.id));
    return this.session(user.id, chosen.tenantId);
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
    return { ok: true };
  }

  /** Active businesses this user belongs to, oldest first. */
  private businessesFor(userId: string) {
    return this.dbs.withUser(userId, (tx) =>
      tx
        .select({
          tenantId: memberships.tenantId,
          membershipId: memberships.id,
          role: memberships.role,
          name: tenants.name,
          businessType: tenants.businessType,
        })
        .from(memberships)
        .innerJoin(tenants, eq(tenants.id, memberships.tenantId))
        .where(and(eq(memberships.userId, userId), eq(memberships.active, true)))
        .orderBy(asc(memberships.createdAt)),
    );
  }

  private async session(userId: string, tenantId: string, till?: Pick<JwtPayload, 'did' | 'dfp'>) {
    const profile = await this.profile(userId, tenantId);
    const payload: JwtPayload = { sub: userId, tid: tenantId, mid: profile.membership.id, ...till };
    return { accessToken: await this.jwt.signAsync(payload), ...profile };
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
      membership: { id: current.membershipId, role: current.role },
      businesses: businesses.map((b) => ({
        tenantId: b.tenantId,
        name: b.name,
        businessType: b.businessType,
        role: b.role,
      })),
    };
  }
}
