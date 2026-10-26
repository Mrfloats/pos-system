ALTER TABLE "sale_lines" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "pack_name" text;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "units_per_pack" numeric(14, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "modifiers" jsonb;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE set null ON UPDATE no action;