CREATE TYPE "public"."fiscal_status" AS ENUM('not_required', 'pending', 'submitted', 'failed');--> statement-breakpoint
CREATE TYPE "public"."kitchen_status" AS ENUM('pending', 'preparing', 'ready', 'served');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'card', 'mobile', 'bank');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('open', 'completed', 'converted', 'cancelled', 'void');--> statement-breakpoint
CREATE TYPE "public"."sale_type" AS ENUM('sale', 'return', 'quotation');--> statement-breakpoint
ALTER TYPE "public"."journal_source" ADD VALUE 'sale_return' BEFORE 'reversal';--> statement-breakpoint
ALTER TYPE "public"."journal_source" ADD VALUE 'cash_transfer' BEFORE 'reversal';--> statement-breakpoint
CREATE TABLE "cash_transfers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"store_id" uuid NOT NULL,
	"shift_id" uuid,
	"to_account_id" uuid,
	"to_store_id" uuid,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"amount_base" numeric(14, 2) NOT NULL,
	"reference" text,
	"note" text,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cash_transfers_one_destination" CHECK (("cash_transfers"."to_account_id" IS NULL) <> ("cash_transfers"."to_store_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "cash_transfers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "customer_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"price_list_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "customer_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"original_line_id" uuid,
	"product_name" text NOT NULL,
	"variant_name" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"discount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_rate_id" uuid,
	"tax_rate_name" text,
	"net" numeric(14, 2) NOT NULL,
	"tax" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"net_base" numeric(14, 2) NOT NULL,
	"tax_base" numeric(14, 2) NOT NULL,
	"cost_base" numeric(14, 2) DEFAULT '0' NOT NULL,
	"kitchen_station" text,
	"kitchen_status" "kitchen_status",
	"note" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"change" numeric(14, 2) DEFAULT '0' NOT NULL,
	"amount_base" numeric(14, 2) NOT NULL,
	"reference" text
);
--> statement-breakpoint
ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" "sale_type" DEFAULT 'sale' NOT NULL,
	"status" "sale_status" DEFAULT 'completed' NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid,
	"shift_id" uuid,
	"app_version" text,
	"customer_id" uuid,
	"customer_name" text DEFAULT 'Cash Customer' NOT NULL,
	"salesperson_id" uuid,
	"original_sale_id" uuid,
	"sold_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"discount_total" numeric(14, 2) DEFAULT '0' NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"total_base" numeric(14, 2) NOT NULL,
	"cost_base" numeric(14, 2) DEFAULT '0' NOT NULL,
	"item_count" numeric(14, 3) DEFAULT '0' NOT NULL,
	"fiscal_status" "fiscal_status" DEFAULT 'not_required' NOT NULL,
	"fiscal_reference" text,
	"note" text,
	"valid_until" date,
	"journal_entry_id" uuid,
	"client_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"store_id" uuid NOT NULL,
	"device_id" uuid,
	"cashier_id" uuid,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"opening_float" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"counted_cash" jsonb,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "shifts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_to_store_id_stores_id_fk" FOREIGN KEY ("to_store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_transfers" ADD CONSTRAINT "cash_transfers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_groups" ADD CONSTRAINT "customer_groups_price_list_id_price_lists_id_fk" FOREIGN KEY ("price_list_id") REFERENCES "public"."price_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_payments" ADD CONSTRAINT "sale_payments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shift_id_shifts_id_fk" FOREIGN KEY ("shift_id") REFERENCES "public"."shifts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_salesperson_id_users_id_fk" FOREIGN KEY ("salesperson_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_cashier_id_users_id_fk" FOREIGN KEY ("cashier_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cash_transfers_tenant_number_uq" ON "cash_transfers" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_groups_tenant_name_uq" ON "customer_groups" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE INDEX "sale_lines_sale_idx" ON "sale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "sale_lines_kitchen_idx" ON "sale_lines" USING btree ("tenant_id","kitchen_status") WHERE "sale_lines"."kitchen_status" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sale_payments_sale_idx" ON "sale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_number_uq" ON "sales" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_tenant_client_uq" ON "sales" USING btree ("tenant_id","client_id") WHERE "sales"."client_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sales_tenant_sold_idx" ON "sales" USING btree ("tenant_id","sold_at");--> statement-breakpoint
CREATE INDEX "sales_original_idx" ON "sales" USING btree ("original_sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shifts_tenant_number_uq" ON "shifts" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "shifts_store_idx" ON "shifts" USING btree ("tenant_id","store_id","opened_at");--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_group_id_customer_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."customer_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "cash_transfers" AS PERMISSIVE FOR ALL TO "pos_app" USING ("cash_transfers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("cash_transfers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "customer_groups" AS PERMISSIVE FOR ALL TO "pos_app" USING ("customer_groups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("customer_groups"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_lines" AS PERMISSIVE FOR ALL TO "pos_app" USING ("sale_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sale_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sale_payments" AS PERMISSIVE FOR ALL TO "pos_app" USING ("sale_payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sale_payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sales" AS PERMISSIVE FOR ALL TO "pos_app" USING ("sales"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("sales"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shifts" AS PERMISSIVE FOR ALL TO "pos_app" USING ("shifts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("shifts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);