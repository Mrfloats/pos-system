CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"family_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
-- Staff IDs (ADM-001…): existing staff are numbered per business and role, oldest first.
ALTER TABLE "memberships" ADD COLUMN "staff_code" text;--> statement-breakpoint
UPDATE "memberships" m SET "staff_code" = x.code FROM (
  SELECT id, CASE role::text
      WHEN 'owner' THEN 'OWN' WHEN 'admin' THEN 'ADM' WHEN 'manager' THEN 'MGR' WHEN 'cashier' THEN 'CSH'
      WHEN 'waiter' THEN 'WTR' WHEN 'stock_clerk' THEN 'STK' ELSE 'ACC' END
    || '-' || lpad((row_number() OVER (PARTITION BY tenant_id, role ORDER BY created_at, id))::text, 3, '0') AS code
  FROM "memberships"
) x WHERE x.id = m.id;--> statement-breakpoint
ALTER TABLE "memberships" ALTER COLUMN "staff_code" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_logins" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_code_uq" ON "memberships" USING btree ("tenant_id","staff_code");