CREATE TYPE "public"."sale_request_kind" AS ENUM('refund', 'void');--> statement-breakpoint
CREATE TYPE "public"."sale_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "sale_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"kind" "sale_request_kind" NOT NULL,
	"status" "sale_request_status" DEFAULT 'pending' NOT NULL,
	"lines" jsonb,
	"method" "payment_method",
	"restock" boolean DEFAULT true NOT NULL,
	"reason" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency_code" text NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid,
	"shift_id" uuid,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"result_sale_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_requests" ADD CONSTRAINT "sale_requests_result_sale_id_sales_id_fk" FOREIGN KEY ("result_sale_id") REFERENCES "public"."sales"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sale_requests_tenant_status_idx" ON "sale_requests" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "sale_requests_requested_by_idx" ON "sale_requests" USING btree ("tenant_id","requested_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sale_requests_pending_uq" ON "sale_requests" USING btree ("sale_id") WHERE "sale_requests"."status" = 'pending';--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_requests" AS PERMISSIVE FOR ALL TO "pos_app" USING ("sale_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sale_requests"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);