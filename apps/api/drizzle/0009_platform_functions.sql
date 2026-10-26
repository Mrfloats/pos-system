-- The platform console: Floatly's own staff see every business.
--
-- Business data stays behind row-level security. These functions are the only
-- way across it: they run as the table owner (SECURITY DEFINER), return
-- read-only summaries, and first check that the signed-in user (app.user_id,
-- set by the API) is a platform admin.

-- 1. Only the owner role can make someone a platform admin, never the API's role.
CREATE FUNCTION users_guard_platform_admin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.is_platform_admin AND (TG_OP = 'INSERT' OR NOT OLD.is_platform_admin) AND current_user = 'pos_app' THEN
    RAISE EXCEPTION 'Platform access can only be granted with npm run platform:admin' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER users_guard_platform_admin
  BEFORE INSERT OR UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION users_guard_platform_admin();--> statement-breakpoint

-- 2. The gate every platform function passes through.
CREATE FUNCTION platform_require_admin() RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = nullif(current_setting('app.user_id', true), '')::uuid AND is_platform_admin
  ) THEN
    RAISE EXCEPTION 'Platform access only' USING ERRCODE = '42501';
  END IF;
END $$;--> statement-breakpoint

-- 3. Headline numbers across every business.
CREATE FUNCTION platform_overview() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_require_admin();
  RETURN json_build_object(
    'businesses', (SELECT count(*) FROM tenants),
    'users', (SELECT count(*) FROM users),
    'stores', (SELECT count(*) FROM stores WHERE active),
    'products', (SELECT count(*) FROM products WHERE active),
    'newThisMonth', (SELECT count(*) FROM tenants WHERE created_at >= date_trunc('month', now())),
    'activeLast7Days', (
      SELECT count(DISTINCT m.tenant_id) FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.active AND u.last_login_at > now() - interval '7 days'
    ),
    'salesLast30Days', (
      SELECT count(*) FROM sales WHERE type = 'sale' AND status = 'completed' AND sold_at > now() - interval '30 days'
    ),
    'takingsLast30Days', (
      SELECT coalesce(json_agg(x ORDER BY x.currency), '[]') FROM (
        SELECT t.base_currency AS currency,
               round(sum(CASE WHEN s.type = 'return' THEN -s.total_base ELSE s.total_base END), 2) AS amount
        FROM sales s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.status = 'completed' AND s.type IN ('sale', 'return') AND s.sold_at > now() - interval '30 days'
        GROUP BY t.base_currency
      ) x
    ),
    'byType', (
      SELECT coalesce(json_object_agg(business_type, n), '{}') FROM (
        SELECT business_type, count(*) AS n FROM tenants GROUP BY business_type
      ) x
    ),
    'signups', (
      SELECT coalesce(json_agg(x ORDER BY x.month), '[]') FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month, count(*) AS count
        FROM tenants WHERE created_at > date_trunc('month', now()) - interval '11 months'
        GROUP BY 1
      ) x
    )
  );
END $$;--> statement-breakpoint

-- 4. One row per business: who owns it and how much it's used.
CREATE FUNCTION platform_businesses() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_require_admin();
  RETURN (
    SELECT coalesce(json_agg(b ORDER BY b."createdAt" DESC), '[]') FROM (
      SELECT t.id, t.name, t.business_type AS "businessType", t.country, t.base_currency AS "baseCurrency",
             t.vat_number AS "vatNumber", t.created_at AS "createdAt",
             o.full_name AS "ownerName", o.email AS "ownerEmail", o.phone AS "ownerPhone",
             (SELECT count(*) FROM memberships m WHERE m.tenant_id = t.id AND m.active) AS staff,
             (SELECT count(*) FROM stores s WHERE s.tenant_id = t.id AND s.active) AS stores,
             (SELECT count(*) FROM products p WHERE p.tenant_id = t.id AND p.active) AS products,
             (SELECT count(*) FROM sales s WHERE s.tenant_id = t.id AND s.type = 'sale' AND s.status = 'completed'
                AND s.sold_at > now() - interval '30 days') AS "sales30d",
             (SELECT round(coalesce(sum(CASE WHEN s.type = 'return' THEN -s.total_base ELSE s.total_base END), 0), 2)
                FROM sales s WHERE s.tenant_id = t.id AND s.status = 'completed' AND s.type IN ('sale', 'return')
                AND s.sold_at > now() - interval '30 days') AS "takings30d",
             (SELECT max(s.sold_at) FROM sales s WHERE s.tenant_id = t.id AND s.status = 'completed') AS "lastSaleAt",
             (SELECT max(u.last_login_at) FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.tenant_id = t.id) AS "lastLoginAt"
      FROM tenants t
      LEFT JOIN LATERAL (
        SELECT u.full_name, u.email, u.phone FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.tenant_id = t.id AND m.role = 'owner' ORDER BY m.created_at LIMIT 1
      ) o ON true
    ) b
  );
END $$;--> statement-breakpoint

-- 5. One business in detail: settings, stores, staff, usage and the last 30 days of takings.
CREATE FUNCTION platform_business(tid uuid) RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_require_admin();
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE id = tid) THEN
    RETURN NULL;
  END IF;
  RETURN json_build_object(
    'business', (
      SELECT row_to_json(x) FROM (
        SELECT t.id, t.name, t.business_type AS "businessType", t.country, t.base_currency AS "baseCurrency",
               t.timezone, t.tin, t.vat_number AS "vatNumber", t.address, t.phone, t.email,
               t.books_closed_through AS "booksClosedThrough", t.created_at AS "createdAt"
        FROM tenants t WHERE t.id = tid
      ) x
    ),
    'stores', (
      SELECT coalesce(json_agg(json_build_object('id', s.id, 'name', s.name, 'code', s.code, 'type', s.type, 'active', s.active) ORDER BY s.name), '[]')
      FROM stores s WHERE s.tenant_id = tid
    ),
    'staff', (
      SELECT coalesce(json_agg(json_build_object(
        'name', u.full_name, 'email', u.email, 'phone', u.phone, 'role', m.role, 'active', m.active, 'lastLoginAt', u.last_login_at
      ) ORDER BY m.created_at), '[]')
      FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = tid
    ),
    'counts', json_build_object(
      'products', (SELECT count(*) FROM products WHERE tenant_id = tid AND active),
      'customers', (SELECT count(*) FROM customers WHERE tenant_id = tid),
      'suppliers', (SELECT count(*) FROM suppliers WHERE tenant_id = tid),
      'tills', (SELECT count(*) FROM devices WHERE tenant_id = tid AND active),
      'sales', (SELECT count(*) FROM sales WHERE tenant_id = tid AND type = 'sale' AND status = 'completed'),
      'invoices', (SELECT count(*) FROM invoices WHERE tenant_id = tid AND status = 'posted'),
      'purchases', (SELECT count(*) FROM bills WHERE tenant_id = tid AND status = 'posted' AND store_id IS NOT NULL),
      'journalEntries', (SELECT count(*) FROM journal_entries WHERE tenant_id = tid)
    ),
    'salesByDay', (
      SELECT coalesce(json_agg(x ORDER BY x.day), '[]') FROM (
        SELECT to_char((s.sold_at AT TIME ZONE t.timezone)::date, 'YYYY-MM-DD') AS day,
               count(*) FILTER (WHERE s.type = 'sale') AS sales,
               round(sum(CASE WHEN s.type = 'return' THEN -s.total_base ELSE s.total_base END), 2) AS takings
        FROM sales s JOIN tenants t ON t.id = s.tenant_id
        WHERE s.tenant_id = tid AND s.status = 'completed' AND s.type IN ('sale', 'return')
          AND s.sold_at > now() - interval '30 days'
        GROUP BY 1
      ) x
    )
  );
END $$;--> statement-breakpoint

REVOKE ALL ON FUNCTION platform_require_admin() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_overview() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_businesses() FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_business(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_require_admin() TO pos_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_overview() TO pos_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_businesses() TO pos_app;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_business(uuid) TO pos_app;
