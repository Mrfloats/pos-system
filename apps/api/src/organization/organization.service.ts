import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext } from '../common/auth-context.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { found } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { devices, memberships, stores, storeStaff, tenants, users } from '../db/schema.js';
import { CreateStaffDto, UpdateStaffDto, UpdateTenantDto } from './organization.dto.js';
import { assertPlanAllows } from '../subscriptions/subscriptions.js';

@Injectable()
export class StoresService extends TenantCrud<typeof stores> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, stores, {
      entity: 'Store',
      searchColumns: [stores.name, stores.code],
      orderBy: [stores.name],
    });
  }

  /** New stores count against the plan's store limit. */
  override async create(ctx: AuthContext, data: Partial<typeof stores.$inferInsert>) {
    await this.dbs.withTenant(ctx, (tx) => assertPlanAllows(tx, 'stores'));
    return super.create(ctx, data);
  }
}

@Injectable()
export class DevicesService extends TenantCrud<typeof devices> {
  constructor(dbs: DbService, audit: AuditService) {
    super(dbs, audit, devices, {
      entity: 'Device',
      searchColumns: [devices.name, devices.code],
      orderBy: [devices.code],
    });
  }

  /**
   * Issues a new secret for a till to sign in with. Only its hash is stored;
   * the token is shown once and replaces any previous one.
   */
  issueToken(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const token = `dev_${randomBytes(32).toString('base64url')}`;
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const rows = await tx
        .update(devices)
        .set({ tokenHash })
        .where(eq(devices.id, id))
        .returning({ id: devices.id });
      found(rows[0], 'Device');
      await this.audit.log(tx, ctx, 'issue_token', 'Device', id);
      return { deviceId: id, token };
    });
  }
}

@Injectable()
export class TenantService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  get(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [row] = await tx.select().from(tenants).where(eq(tenants.id, ctx.tenantId));
      return row;
    });
  }

  update(ctx: AuthContext, dto: UpdateTenantDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [row] = await tx
        .update(tenants)
        .set(dto)
        .where(eq(tenants.id, ctx.tenantId))
        .returning();
      await this.audit.log(tx, ctx, 'update', 'Tenant', ctx.tenantId, dto);
      return row;
    });
  }
}

@Injectable()
export class StaffService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
  ) {}

  list(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const rows = await tx
        .select({
          id: memberships.id,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          phone: users.phone,
          role: memberships.role,
          active: memberships.active,
          hasPin: isNotNull(memberships.pinHash),
          lastLoginAt: users.lastLoginAt,
          createdAt: memberships.createdAt,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .orderBy(asc(users.fullName));
      const access = await tx.select().from(storeStaff);
      return rows.map((r) => ({
        ...r,
        storeIds: access.filter((a) => a.membershipId === r.id).map((a) => a.storeId),
      }));
    });
  }

  async create(ctx: AuthContext, dto: CreateStaffDto) {
    if (dto.role === 'owner' && ctx.role !== 'owner') {
      throw new ForbiddenException('Only an owner can add another owner');
    }
    await this.dbs.withTenant(ctx, (tx) => assertPlanAllows(tx, 'staff'));
    // Users are global (one login can work for several businesses).
    let [user] = await this.dbs.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, dto.email))
      .limit(1);
    if (!user) {
      if (!dto.password) {
        throw new BadRequestException('A password is required for a new staff account');
      }
      [user] = await this.dbs.db
        .insert(users)
        .values({ email: dto.email, fullName: dto.fullName, passwordHash: await hash(dto.password) })
        .returning({ id: users.id });
    }

    const membershipId = await this.dbs.withTenant(ctx, async (tx) => {
      const pinHash = dto.pin ? await this.checkedPinHash(tx, dto.pin) : null;
      const [m] = await tx
        .insert(memberships)
        .values({ tenantId: ctx.tenantId, userId: user.id, role: dto.role, pinHash })
        .onConflictDoNothing()
        .returning({ id: memberships.id });
      if (!m) throw new ConflictException('This person is already on your staff list');
      await this.setStores(tx, ctx, m.id, dto.storeIds);
      await this.audit.log(tx, ctx, 'create', 'Staff', m.id, {
        email: dto.email,
        role: dto.role,
        storeIds: dto.storeIds,
      });
      return m.id;
    });
    return this.get(ctx, membershipId);
  }

  async update(ctx: AuthContext, id: string, dto: UpdateStaffDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      const [current] = await tx.select().from(memberships).where(eq(memberships.id, id));
      found(current, 'Staff member');

      const touchesOwner = current.role === 'owner' || dto.role === 'owner';
      if (touchesOwner && ctx.role !== 'owner') {
        throw new ForbiddenException('Only an owner can change an owner');
      }
      const demotingOrDisabling =
        (dto.role !== undefined && dto.role !== 'owner') || dto.active === false;
      if (current.role === 'owner' && demotingOrDisabling) {
        const [other] = await tx
          .select({ id: memberships.id })
          .from(memberships)
          .where(
            and(eq(memberships.role, 'owner'), eq(memberships.active, true), ne(memberships.id, id)),
          )
          .limit(1);
        if (!other) throw new BadRequestException('A business must keep at least one active owner');
      }
      if (id === ctx.membershipId && dto.active === false) {
        throw new BadRequestException('You cannot deactivate yourself');
      }

      const changes: Partial<typeof memberships.$inferInsert> = {};
      if (dto.role) changes.role = dto.role;
      if (dto.active !== undefined) changes.active = dto.active;
      if (dto.pin) changes.pinHash = await this.checkedPinHash(tx, dto.pin, id);
      if (Object.keys(changes).length) {
        await tx.update(memberships).set(changes).where(eq(memberships.id, id));
      }
      if (dto.storeIds) await this.setStores(tx, ctx, id, dto.storeIds);
      await this.audit.log(tx, ctx, 'update', 'Staff', id, { ...dto, pin: dto.pin ? '***' : undefined });
    });
    return this.get(ctx, id);
  }

  async get(ctx: AuthContext, id: string) {
    const all = await this.list(ctx);
    return found(
      all.find((s) => s.id === id),
      'Staff member',
    );
  }

  /** Till PINs must be unique within a business, because the PIN alone identifies the cashier. */
  private async checkedPinHash(tx: Tx, pin: string, exceptMembershipId?: string) {
    const others = await tx
      .select({ id: memberships.id, pinHash: memberships.pinHash })
      .from(memberships)
      .where(isNotNull(memberships.pinHash));
    for (const o of others) {
      if (o.id === exceptMembershipId || !o.pinHash) continue;
      if (await verify(o.pinHash, pin).catch(() => false)) {
        throw new ConflictException('Another staff member already uses this PIN');
      }
    }
    return hash(pin);
  }

  private async setStores(tx: Tx, ctx: AuthContext, membershipId: string, storeIds?: string[]) {
    if (!storeIds) return;
    if (storeIds.length) {
      const existing = await tx
        .select({ id: stores.id })
        .from(stores)
        .where(inArray(stores.id, storeIds));
      if (existing.length !== storeIds.length) throw new BadRequestException('Unknown store');
    }
    await tx.delete(storeStaff).where(eq(storeStaff.membershipId, membershipId));
    if (storeIds.length) {
      await tx
        .insert(storeStaff)
        .values(storeIds.map((storeId) => ({ tenantId: ctx.tenantId, storeId, membershipId })));
    }
  }
}
