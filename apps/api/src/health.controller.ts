import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { and, desc, eq, getTableColumns, sql, SQL } from 'drizzle-orm';
import { ADMINS, type AuthContext, Ctx, PLATFORMS, Public, Roles } from './common/auth-context.js';
import { Can } from './common/permissions.js';
import { ListQuery, Trim } from './common/validation.js';
import { DbService } from './db/db.service.js';
import { auditLogs, stores, tenants, users } from './db/schema.js';

const IsDay = () => Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dates must look like 2026-10-31' });

export class AuditQuery extends ListQuery {
  @IsOptional() @Trim() @IsString() @MaxLength(60) entity?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(60) action?: string;
  @IsOptional() @IsUUID() userId?: string;
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsIn(PLATFORMS) platform?: (typeof PLATFORMS)[number];
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

@ApiTags('system')
@Controller()
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  @Public()
  @Get('health')
  async health() {
    await this.dbs.db.execute(sql`select 1`);
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Who did what, newest first: with their role, the app they used, the store, and the value before and after. */
  @ApiBearerAuth()
  @Roles(...ADMINS)
  @Can('audit.view')
  @Get('audit-logs')
  auditLogs(@Ctx() ctx: AuthContext, @Query() q: AuditQuery) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [t] = await tx.select({ tz: tenants.timezone }).from(tenants).limit(1);
      const tz = t?.tz ?? 'UTC';
      const where: SQL[] = [];
      if (q.entity) where.push(eq(auditLogs.entity, q.entity));
      if (q.action) where.push(eq(auditLogs.action, q.action));
      if (q.userId) where.push(eq(auditLogs.userId, q.userId));
      if (q.storeId) where.push(eq(auditLogs.storeId, q.storeId));
      if (q.platform) where.push(eq(auditLogs.platform, q.platform));
      if (q.from) where.push(sql`(${auditLogs.createdAt} AT TIME ZONE ${tz})::date >= ${q.from}::date`);
      if (q.to) where.push(sql`(${auditLogs.createdAt} AT TIME ZONE ${tz})::date <= ${q.to}::date`);
      return tx
        .select({ ...getTableColumns(auditLogs), userName: users.fullName, storeName: stores.name })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.userId))
        .leftJoin(stores, eq(stores.id, auditLogs.storeId))
        .where(where.length ? and(...where) : undefined)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
    });
  }
}
