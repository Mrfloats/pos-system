import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { desc, sql } from 'drizzle-orm';
import { ADMINS, type AuthContext, Ctx, Public, Roles } from './common/auth-context.js';
import { ListQuery } from './common/validation.js';
import { DbService } from './db/db.service.js';
import { auditLogs } from './db/schema.js';

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

  @ApiBearerAuth()
  @Roles(...ADMINS)
  @Get('audit-logs')
  auditLogs(@Ctx() ctx: AuthContext, @Query() q: ListQuery) {
    return this.dbs.withTenant(ctx, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    );
  }
}
