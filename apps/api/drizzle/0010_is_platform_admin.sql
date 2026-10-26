-- True when the signed-in user (app.user_id, set by the API) is Floatly staff.
-- Used by the row-level security policies on plans, sign-up requests and
-- subscription payments, and by the guard on tenants' subscription columns.
CREATE FUNCTION is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM users
    WHERE id = nullif(current_setting('app.user_id', true), '')::uuid AND is_platform_admin
  )
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION is_platform_admin() TO pos_app;
