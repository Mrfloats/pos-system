import { Injectable } from '@nestjs/common';
import { Tx } from '../db/db.service.js';
import { auditLogs } from '../db/schema.js';
import { type AuthContext } from './auth-context.js';

const json = (v: unknown) => (v === undefined || v === null ? null : (JSON.parse(JSON.stringify(v)) as object));

/** Where it happened and, for a changed value, what it was before and after. */
export interface AuditDetail {
  storeId?: string | null;
  old?: unknown;
  new?: unknown;
}

/**
 * Records who changed what, in which role and from which app (web, till or
 * mobile). Call inside the same transaction as the change.
 */
@Injectable()
export class AuditService {
  async log(
    tx: Tx,
    ctx: Pick<AuthContext, 'tenantId' | 'userId'> & Partial<Pick<AuthContext, 'role' | 'platform' | 'deviceId'>>,
    action: 'create' | 'update' | 'delete' | string,
    entity: string,
    entityId: string | null,
    data?: unknown,
    detail?: AuditDetail,
  ) {
    await tx.insert(auditLogs).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action,
      entity,
      entityId,
      data: json(data),
      role: ctx.role ?? null,
      platform: ctx.platform ?? null,
      deviceId: ctx.deviceId ?? null,
      storeId: detail?.storeId ?? null,
      oldValue: json(detail?.old),
      newValue: json(detail?.new),
    });
  }
}
