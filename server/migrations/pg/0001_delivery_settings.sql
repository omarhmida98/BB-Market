ALTER TABLE "orders" ADD COLUMN "fulfillment_method" text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_fee" text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "pickup_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delivery_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delivery_fee" text DEFAULT '7' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "free_delivery_threshold" text DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "delivery_note" text;