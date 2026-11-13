CREATE TABLE "sent_emails" (
	"key" text PRIMARY KEY NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- The daily email check runs with nobody signed in, so row-level security hides every business.
-- These two functions are its only way across: they run as the table owner and return just
-- which businesses and tills need an email; the details are then read inside each business.

-- Paid-up dates in a window, for "ends soon", "has ended" and "locked" reminders.
CREATE FUNCTION subscriptions_ending_between(p_from date, p_to date)
RETURNS TABLE (tenant_id uuid, current_period_end date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, current_period_end FROM tenants
  WHERE subscription_status = 'active' AND current_period_end BETWEEN p_from AND p_to
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION subscriptions_ending_between(date, date) TO pos_app;--> statement-breakpoint

-- Live ZIMRA tills whose fiscal day has been open for more than a day (as they last reported).
CREATE FUNCTION fiscal_days_overdue()
RETURNS TABLE (tenant_id uuid, device_id uuid, day_no integer, opened_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT d.tenant_id, d.id, (d.fiscal_state->>'dayNo')::integer, (d.fiscal_state->>'dayOpenedAt')::timestamptz
  FROM devices d
  WHERE d.active AND d.fiscal_device_id IS NOT NULL
    AND d.fiscal_state->>'environment' = 'live'
    AND d.fiscal_state->>'dayStatus' IN ('FiscalDayOpened', 'FiscalDayCloseFailed')
    AND (d.fiscal_state->>'dayOpenedAt')::timestamptz < now() - interval '24 hours'
$$;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION fiscal_days_overdue() TO pos_app;
