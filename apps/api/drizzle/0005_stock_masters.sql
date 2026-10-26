CREATE TABLE "attribute_values" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attribute_id" uuid NOT NULL,
	"value" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attribute_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "attributes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attributes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "store_prices" (
	"tenant_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"price" numeric(14, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "store_prices_store_id_variant_id_pk" PRIMARY KEY("store_id","variant_id")
);
--> statement-breakpoint
ALTER TABLE "store_prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attribute_values" ADD CONSTRAINT "attribute_values_attribute_id_attributes_id_fk" FOREIGN KEY ("attribute_id") REFERENCES "public"."attributes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attributes" ADD CONSTRAINT "attributes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prices" ADD CONSTRAINT "store_prices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prices" ADD CONSTRAINT "store_prices_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_prices" ADD CONSTRAINT "store_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attribute_values_uq" ON "attribute_values" USING btree ("attribute_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "attributes_tenant_name_uq" ON "attributes" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attribute_values" AS PERMISSIVE FOR ALL TO "pos_app" USING ("attribute_values"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attribute_values"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attributes" AS PERMISSIVE FOR ALL TO "pos_app" USING ("attributes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("attributes"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "store_prices" AS PERMISSIVE FOR ALL TO "pos_app" USING ("store_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("store_prices"."tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);