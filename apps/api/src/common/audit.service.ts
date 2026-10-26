import { Injectable } from '@nestjs/common';
import { Tx } from '../db/db.service.js';
import { auditLogs } from '../db/schema.js';
import { type AuthContext } from './auth-context.js';

/** Records who changed what. Call inside the same transaction as the change. */
@Injectable()
export class AuditService {
  async log(
    tx: Tx,
    ctx: Pick<AuthContext, 'tenantId' | 'userId'>,
    action: 'create' | 'update' | 'delete' | string,
    entity: string,
    entityId: string | null,
    data?: unknown,
  ) {
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action,
      entity,
      entityId,
      data: data === undefined ? null : (JSON.parse(JSON.stringify(data)) as object),
    });
  }
}
