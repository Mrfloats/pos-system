import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from './permissions.js';

export type Role =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'cashier'
  | 'waiter'
  | 'stock_clerk'
  | 'accountant';

/** Which app a request came from (the X-Floatly-Client header), kept in the audit trail. */
export const PLATFORMS = ['web', 'till', 'mobile'] as const;
export type Platform = (typeof PLATFORMS)[number] | 'unknown';
export const CLIENT_HEADER = 'x-floatly-client';

/** "mobile", "mobile/1.0.0" → mobile. Anything else → unknown. */
export function platformOf(header: unknown): Platform {
  const name = typeof header === 'string' ? header.trim().toLowerCase().split('/')[0] : '';
  return (PLATFORMS as readonly string[]).includes(name) ? (name as Platform) : 'unknown';
}

/** The signed-in staff member, attached to the request by the auth guard. */
export interface AuthContext {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: Role;
  /** What they may do: the role's permissions, less any an owner took away. */
  permissions: ReadonlySet<Permission>;
  /** The app the request came from. */
  platform: Platform;
  /** Set when signed in on a till with a PIN. */
  deviceId?: string;
  /** Signed in on a phone (a refreshable session): sensitive actions need the PIN again. */
  mobileSession: boolean;
  hasPin: boolean;
  /** This request carried the person's PIN (X-Floatly-Pin) and it was right. */
  pinConfirmed: boolean;
}

/** Sent with a sensitive request to confirm it with the person's PIN. */
export const PIN_HEADER = 'x-floatly-pin';

/** Contents of the access token. */
export interface JwtPayload {
  sub: string; // user id
  tid: string; // tenant id
  mid: string; // membership id
  /** Signed in on a till: its device id, and the start of its secret's hash, so switching the till off or pairing it again ends the session. */
  did?: string;
  dfp?: string;
  /** Signed in on a phone, with a refresh token. */
  plt?: 'mobile';
}

/** Sent with 401s when the till itself was switched off or set up again elsewhere, so the app can stop. */
export const DEVICE_REVOKED = 'device_revoked';

/** Role groups used by @Roles() on endpoints. */
export const ADMINS: Role[] = ['owner', 'admin'];
export const MANAGERS: Role[] = [...ADMINS, 'manager'];
/** Start of each role's staff ID: ADM-001, CSH-014… */
export const STAFF_CODE_PREFIX: Record<Role, string> = {
  owner: 'OWN',
  admin: 'ADM',
  manager: 'MGR',
  cashier: 'CSH',
  waiter: 'WTR',
  stock_clerk: 'STK',
  accountant: 'ACC',
};
export const STOCK_WRITERS: Role[] = [...MANAGERS, 'stock_clerk'];
export const FRONT_OF_HOUSE: Role[] = [...MANAGERS, 'cashier', 'waiter'];
/** Enter bills, invoices, payments and expenses, and read the reports. */
export const BOOKKEEPERS: Role[] = [...MANAGERS, 'accountant'];
/** Change the chart of accounts, post manual journals and close periods. */
export const ACCOUNTANTS: Role[] = [...ADMINS, 'accountant'];
export const ALL_ROLES: Role[] = [...MANAGERS, 'cashier', 'waiter', 'stock_clerk', 'accountant'];

/** Token for the platform console (Floatly staff): no business, platform pages only. */
export interface PlatformJwtPayload {
  sub: string; // user id
  plat: true;
}

/** The signed-in platform admin, attached to the request on platform pages. */
export interface PlatformContext {
  userId: string;
}

export const IS_PUBLIC = 'isPublic';
export const IS_PLATFORM = 'isPlatform';
export const ALLOW_LAPSED = 'allowLapsed';

/** Days after the paid-up date before a business is locked out. */
export const GRACE_DAYS = 7;

/** Still reachable when the subscription has lapsed (signing in, seeing what to pay). */
export const AllowLapsed = () => SetMetadata(ALLOW_LAPSED, true);

/** Platform console endpoint: needs a platform token; business tokens are refused. */
export const PlatformOnly = () => SetMetadata(IS_PLATFORM, true);

/** Injects the PlatformContext of the signed-in platform admin. */
export const PlatformCtx = createParamDecorator((_: unknown, context: ExecutionContext): PlatformContext => {
  return context.switchToHttp().getRequest().platform;
});
export const ROLES = 'roles';

/** Endpoint needs no sign-in. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Only these roles may call the endpoint. Without it, any signed-in staff member may. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles.flat());

/** Injects the AuthContext of the signed-in staff member. */
export const Ctx = createParamDecorator((_: unknown, context: ExecutionContext): AuthContext => {
  return context.switchToHttp().getRequest().auth;
});
