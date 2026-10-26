CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('posted', 'void');--> statement-breakpoint
CREATE TYPE "public"."journal_source" AS ENUM('manual', 'opening', 'invoice', 'invoice_payment', 'bill', 'bill_payment', 'expense', 'transfer', 'stock', 'sale', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('invoice_receipt', 'bill_payment');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"system_key" text,
	"is_bank" boolean DEFAULT false NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bill_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"tax_rate_id" uuid,
	"net" numeric(14, 2) NOT NULL,
	"tax" numeric(14, 2) NOT NULL,
	"net_base" numeric(14, 2) NOT NULL,
	"tax_base" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"bill_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bill_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"total_base" numeric(14, 2) NOT NULL,
	"status" "document_status" DEFAULT 'posted' NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_reference" text
);
--> statement-breakpoint
ALTER TABLE "bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "document_counters" (
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "document_counters_tenant_id_kind_pk" PRIMARY KEY("tenant_id","kind")
);
--> statement-breakpoint
ALTER TABLE "document_counters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"paid_from_account_id" uuid NOT NULL,
	"supplier_id" uuid,
	"payee" text,
	"description" text NOT NULL,
	"reference" text,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"tax_rate_id" uuid,
	"total" numeric(14, 2) NOT NULL,
	"net" numeric(14, 2) NOT NULL,
	"tax" numeric(14, 2) NOT NULL,
	"net_base" numeric(14, 2) NOT NULL,
	"tax_base" numeric(14, 2) NOT NULL,
	"status" "document_status" DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(14, 3) DEFAULT '1' NOT NULL,
	"unit_price" numeric(14, 2) NOT NULL,
	"tax_rate_id" uuid,
	"net" numeric(14, 2) NOT NULL,
	"tax" numeric(14, 2) NOT NULL,
	"net_base" numeric(14, 2) NOT NULL,
	"tax_base" numeric(14, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"invoice_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"due_date" date NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"tax_inclusive" boolean DEFAULT false NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_total" numeric(14, 2) NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"total_base" numeric(14, 2) NOT NULL,
	"status" "document_status" DEFAULT 'posted' NOT NULL,
	"notes" text,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"customer_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"date" date NOT NULL,
	"description" text NOT NULL,
	"source" "journal_source" NOT NULL,
	"source_id" uuid,
	"reference" text,
	"reverses_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency_code" text,
	"foreign_amount" numeric(14, 2),
	"rate" numeric(18, 6),
	"memo" text,
	CONSTRAINT "journal_lines_one_side" CHECK ("journal_lines"."debit" >= 0 AND "journal_lines"."credit" >= 0 AND ("journal_lines"."debit" = 0) <> ("journal_lines"."credit" = 0))
);
--> statement-breakpoint
ALTER TABLE "journal_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"kind" "payment_kind" NOT NULL,
	"invoice_id" uuid,
	"bill_id" uuid,
	"account_id" uuid NOT NULL,
	"date" date NOT NULL,
	"currency_code" text NOT NULL,
	"rate" numeric(18, 6) DEFAULT '1' NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"amount_base" numeric(14, 2) NOT NULL,
	"cleared_base" numeric(14, 2) NOT NULL,
	"reference" text,
	"status" "document_status" DEFAULT 'posted' NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_one_document" CHECK (("payments"."kind" = 'invoice_receipt' AND "payments"."invoice_id" IS NOT NULL AND "payments"."bill_id" IS NULL) OR ("payments"."kind" = 'bill_payment' AND "payments"."bill_id" IS NOT NULL AND "payments"."invoice_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"phone" text,
	"email" text,
	"address" text,
	"tin" text,
	"vat_number" text,
	"payment_terms_days" integer DEFAULT 30 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "books_closed_through" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_lines" ADD CONSTRAINT "bill_lines_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bills" ADD CONSTRAINT "bills_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_counters" ADD CONSTRAINT "document_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_from_account_id_accounts_id_fk" FOREIGN KEY ("paid_from_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_rate_id_tax_rates_id_fk" FOREIGN KEY ("tax_rate_id") REFERENCES "public"."tax_rates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_code_uq" ON "accounts" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_system_key_uq" ON "accounts" USING btree ("tenant_id","system_key") WHERE "accounts"."system_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "bill_lines_bill_idx" ON "bill_lines" USING btree ("bill_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bills_tenant_number_uq" ON "bills" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "bills_tenant_supplier_idx" ON "bills" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_tenant_number_uq" ON "expenses" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "expenses_tenant_date_idx" ON "expenses" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_tenant_number_uq" ON "invoices" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_customer_idx" ON "invoices" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_tenant_number_uq" ON "journal_entries" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_reverses_uq" ON "journal_entries" USING btree ("reverses_id") WHERE "journal_entries"."reverses_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "journal_entries_tenant_date_idx" ON "journal_entries" USING btree ("tenant_id","date");--> statement-breakpoint
CREATE INDEX "journal_entries_source_idx" ON "journal_entries" USING btree ("tenant_id","source_id");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_idx" ON "journal_lines" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_number_uq" ON "payments" USING btree ("tenant_id","number");--> statement-breakpoint
CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_bill_idx" ON "payments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_name_idx" ON "suppliers" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "accounts" AS PERMISSIVE FOR ALL TO "pos_app" USING ("accounts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("accounts"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bill_lines" AS PERMISSIVE FOR ALL TO "pos_app" USING ("bill_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("bill_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bills" AS PERMISSIVE FOR ALL TO "pos_app" USING ("bills"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("bills"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_counters" AS PERMISSIVE FOR ALL TO "pos_app" USING ("document_counters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("document_counters"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "expenses" AS PERMISSIVE FOR ALL TO "pos_app" USING ("expenses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("expenses"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoice_lines" AS PERMISSIVE FOR ALL TO "pos_app" USING ("invoice_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invoice_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "invoices" AS PERMISSIVE FOR ALL TO "pos_app" USING ("invoices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("invoices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_entries" AS PERMISSIVE FOR ALL TO "pos_app" USING ("journal_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("journal_entries"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journal_lines" AS PERMISSIVE FOR ALL TO "pos_app" USING ("journal_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("journal_lines"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payments" AS PERMISSIVE FOR ALL TO "pos_app" USING ("payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("payments"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "suppliers" AS PERMISSIVE FOR ALL TO "pos_app" USING ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("suppliers"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);