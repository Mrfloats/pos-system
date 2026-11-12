ALTER TABLE "devices" ADD COLUMN "fiscal_device_id" integer;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "fiscal_serial_no" text;--> statement-breakpoint
ALTER TABLE "devices" ADD COLUMN "fiscal_state" jsonb;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "hs_code" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "fiscal" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "devices_tenant_fiscal_uq" ON "devices" USING btree ("tenant_id","fiscal_device_id") WHERE "devices"."fiscal_device_id" IS NOT NULL;