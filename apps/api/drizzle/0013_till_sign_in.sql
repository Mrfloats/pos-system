-- Till sign-in: a paired till sends its device token and a staff PIN before any
-- business is chosen, so the API has to find the device without a tenant set.
-- This returns only the one device whose token hash matches, nothing else.
CREATE FUNCTION till_device_for_token(lookup_hash text) RETURNS TABLE (
  id uuid, tenant_id uuid, store_id uuid, active boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.id, d.tenant_id, d.store_id, d.active
  FROM devices d WHERE d.token_hash = lookup_hash
  LIMIT 1
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION till_device_for_token(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION till_device_for_token(text) TO pos_app;
