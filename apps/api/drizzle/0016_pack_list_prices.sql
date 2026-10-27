DROP INDEX "price_list_items_uq";--> statement-breakpoint
ALTER TABLE "price_list_items" ADD COLUMN "packaging_id" uuid;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_packaging_id_product_packagings_id_fk" FOREIGN KEY ("packaging_id") REFERENCES "public"."product_packagings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_uq" UNIQUE NULLS NOT DISTINCT("price_list_id","variant_id","packaging_id","min_quantity");