-- Subscriptions: rules the API relies on, enforced by the database itself.

-- 1. A business can't change its own plan, period, status or paid-up date. Only
--    Floatly staff (or the owner role, e.g. migrations) can. A business created
--    by anyone else starts with no plan and no end date.
CREATE FUNCTION tenants_guard_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'pos_app' OR is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.plan_id := NULL;
    NEW.billing_period := NULL;
    NEW.subscription_status := 'active';
    NEW.current_period_end := NULL;
  ELSIF NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.billing_period IS DISTINCT FROM OLD.billing_period
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN
    RAISE EXCEPTION 'Only Floatly can change a subscription' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER tenants_guard_subscription
  BEFORE INSERT OR UPDATE ON tenants
  FOR EACH ROW EXECUTE FUNCTION tenants_guard_subscription();--> statement-breakpoint

-- 2. Payments are a record: never edited or removed by the API.
REVOKE UPDATE, DELETE ON subscription_payments FROM pos_app;--> statement-breakpoint

-- 3. The latest sign-up request for an email, for the public sign-up and sign-in
--    pages (is it already waiting? was it turned down?). Returns no other requests.
CREATE FUNCTION signup_request_for(lookup_email text) RETURNS TABLE (
  id uuid, status signup_status, password_hash text, business_name text, decision_note text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.status, r.password_hash, r.business_name, r.decision_note
  FROM signup_requests r WHERE r.email = lower(lookup_email)
  ORDER BY r.created_at DESC LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION signup_request_for(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION signup_request_for(text) TO pos_app;--> statement-breakpoint

-- 4. Every business's subscription, for the platform console.
CREATE FUNCTION platform_subscriptions() RETURNS json
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM platform_require_admin();
  RETURN (
    SELECT coalesce(json_agg(json_build_object(
      'tenantId', t.id, 'planId', t.plan_id, 'billingPeriod', t.billing_period,
      'status', t.subscription_status, 'currentPeriodEnd', t.current_period_end
    )), '[]') FROM tenants t
  );
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION platform_subscriptions() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION platform_subscriptions() TO pos_app;--> statement-breakpoint

-- 5. Starting plans. Prices are placeholders: change them in the platform console.
INSERT INTO plans (id, code, name, description, monthly_price, yearly_price, currency, max_stores, max_staff, features, sort_order) VALUES
  (gen_random_uuid(), 'starter', 'Starter', 'One shop getting started', 15, 150, 'USD', 1, 3,
   '["1 store", "Up to 3 staff", "Sales, stock and customers", "Basic reports"]', 1),
  (gen_random_uuid(), 'growth', 'Growth', 'Growing shops and restaurants', 35, 350, 'USD', 3, 15,
   '["Up to 3 stores", "Up to 15 staff", "Full accounts and VAT", "Purchases and suppliers", "All reports"]', 2),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 'Chains and wholesalers', 75, 750, 'USD', NULL, NULL,
   '["Unlimited stores", "Unlimited staff", "Everything in Growth", "Priority support"]', 3);
