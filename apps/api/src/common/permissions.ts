import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { ADMINS, ALL_ROLES, BOOKKEEPERS, FRONT_OF_HOUSE, MANAGERS, type Role, STOCK_WRITERS } from './auth-context.js';

/**
 * What a staff member may do, finer than their role. Each permission is given
 * to some roles to start with; an owner can then take individual permissions
 * away from one staff member (memberships.denied_permissions). Owners always
 * have every permission.
 *
 * Endpoints name the permission they need with @Can(). It is checked as well
 * as @Roles(), never instead of it.
 */
export const PERMISSIONS = {
  'dashboard.view': { group: 'Dashboard', label: "See the day's sales and alerts", roles: MANAGERS },
  'sales.view': { group: 'Sales', label: 'See sales and receipts', roles: [...FRONT_OF_HOUSE, 'accountant'] },
  'sales.void': { group: 'Sales', label: 'Void sales', roles: MANAGERS },
  'returns.create': { group: 'Sales', label: 'Refund sales', roles: MANAGERS },
  'returns.request': { group: 'Sales', label: 'Ask a manager for a refund or void', roles: FRONT_OF_HOUSE },
  'returns.approve': { group: 'Sales', label: 'Approve refund and void requests', roles: MANAGERS },
  'inventory.view': { group: 'Stock', label: 'See stock levels and movements', roles: ALL_ROLES },
  'inventory.adjust': { group: 'Stock', label: 'Receive, adjust, count and transfer stock', roles: STOCK_WRITERS },
  'damaged.record': { group: 'Stock', label: 'Write off damaged or expired stock', roles: STOCK_WRITERS },
  'products.edit': { group: 'Stock', label: 'Add and edit products', roles: MANAGERS },
  'products.price': { group: 'Stock', label: 'Change selling prices', roles: MANAGERS },
  'customers.view': { group: 'People', label: 'See customers', roles: ALL_ROLES },
  'customers.edit': { group: 'People', label: 'Add and edit customers', roles: FRONT_OF_HOUSE },
  'suppliers.view': { group: 'People', label: 'See suppliers', roles: ALL_ROLES },
  'suppliers.edit': { group: 'People', label: 'Add and edit suppliers', roles: BOOKKEEPERS },
  'reports.view': { group: 'Reports', label: 'See sales and profit reports', roles: BOOKKEEPERS },
  'reports.stock': { group: 'Reports', label: 'See stock reports and valuation', roles: [...STOCK_WRITERS, 'accountant'] },
  'audit.view': { group: 'Reports', label: 'See the audit trail', roles: ADMINS },
} as const satisfies Record<string, { group: string; label: string; roles: readonly Role[] }>;

export type Permission = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as Permission[];

/** What a role may do before anything is taken away. */
export function rolePermissions(role: Role): Permission[] {
  return PERMISSION_KEYS.filter((p) => (PERMISSIONS[p].roles as readonly Role[]).includes(role));
}

/** What this staff member may do: their role's permissions, less the ones an owner took away. */
export function effectivePermissions(role: Role, denied: readonly string[] | null | undefined): Permission[] {
  const all = rolePermissions(role);
  if (role === 'owner' || !denied?.length) return all;
  return all.filter((p) => !denied.includes(p));
}

/** The list the backoffice shows when an owner sets someone's permissions. */
export function permissionCatalog() {
  return PERMISSION_KEYS.map((key) => ({ key, group: PERMISSIONS[key].group, label: PERMISSIONS[key].label, roles: [...PERMISSIONS[key].roles] as Role[] }));
}

export const PERMISSIONS_META = 'permissions';
/** The endpoint needs every one of these permissions (as well as any @Roles). */
export const Can = (...permissions: Permission[]) => SetMetadata(PERMISSIONS_META, permissions);

export const NOT_PERMITTED = "You haven't been given permission to do this";

export function can(ctx: { permissions: ReadonlySet<Permission> }, permission: Permission) {
  return ctx.permissions.has(permission);
}

/** For checks that depend on what is being changed (a price inside a product edit, waste inside a stock movement). */
export function assertCan(ctx: { permissions: ReadonlySet<Permission> }, permission: Permission) {
  if (!can(ctx, permission)) throw new ForbiddenException(NOT_PERMITTED);
}
