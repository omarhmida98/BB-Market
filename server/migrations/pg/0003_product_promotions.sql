ALTER TABLE "products" ADD COLUMN "promo_price" double precision;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "promo_start" timestamp;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "promo_end" timestamp;--> statement-breakpoint
CREATE INDEX "idx_products_promoted" ON "products" USING btree ("id") WHERE "products"."promo_price" is not null;