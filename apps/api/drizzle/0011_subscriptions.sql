CREATE TYPE "public"."billing_period" AS ENUM('monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."signup_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"monthly_price" numeric(14, 2) NOT NULL,
	"yearly_price" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"max_stores" integer,
	"max_staff" integer,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "signup_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"business_type" "business_type" NOT NULL,
	"country" text DEFAULT 'ZW' NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"plan_id" uuid NOT NULL,
	"billing_period" "billing_period" NOT NULL,
	"message" text,
	"status" "signup_status" DEFAULT 'pending' NOT NULL,
	"decision_note" text,
	"tenant_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "signup_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "subscription_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid,
	"billing_period" "billing_period" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"method" text NOT NULL,
	"reference" text,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "plan_id" uuid;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "billing_period" "billing_period";--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "subscription_status" "subscription_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "current_period_end" date;--> statement-breakpoint
ALTER TABLE "signup_requests" ADD CONSTRAINT "signup_requests_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_requests" ADD CONSTRAINT "signup_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signup_requests" ADD CONSTRAINT "signup_requests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_payments" ADD CONSTRAINT "subscription_payments_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "signup_requests_status_idx" ON "signup_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "signup_requests_pending_email_uq" ON "signup_requests" USING btree ("email") WHERE "signup_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "subscription_payments_tenant_idx" ON "subscription_payments" USING btree ("tenant_id","period_end");--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "plans_read" ON "plans" AS PERMISSIVE FOR SELECT TO "pos_app" USING (true);--> statement-breakpoint
CREATE POLICY "plans_admin" ON "plans" AS PERMISSIVE FOR ALL TO "pos_app" USING (is_platform_admin()) WITH CHECK (is_platform_admin());--> statement-breakpoint
CREATE POLICY "signup_requests_submit" ON "signup_requests" AS PERMISSIVE FOR INSERT TO "pos_app" WITH CHECK ("signup_requests"."status" = 'pending');--> statement-breakpoint
CREATE POLICY "signup_requests_admin" ON "signup_requests" AS PERMISSIVE FOR ALL TO "pos_app" USING (is_platform_admin()) WITH CHECK (is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_payments_read" ON "subscription_payments" AS PERMISSIVE FOR SELECT TO "pos_app" USING ("subscription_payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid OR is_platform_admin());--> statement-breakpoint
CREATE POLICY "subscription_payments_record" ON "subscription_payments" AS PERMISSIVE FOR INSERT TO "pos_app" WITH CHECK (is_platform_admin());