ALTER TABLE "audit_logs" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "platform" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "store_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "device_id" uuid;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "old_value" jsonb;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "new_value" jsonb;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "denied_permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE set null ON UPDATE no action;