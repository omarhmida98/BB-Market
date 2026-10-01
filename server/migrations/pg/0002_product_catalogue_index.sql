-- `quantity` and `price` are text columns in the pre-0002 schema. PostgreSQL will
-- not cast text to a numeric type implicitly, so the USING clause is required.
-- A non-numeric or empty value aborts the migration rather than silently
-- becoming 0, which is the safer failure for a column holding live prices.
-- The text DEFAULT '0' has to go first: a text default cannot be cast to an
-- integer default implicitly, and it would block the type change below.
ALTER TABLE "products" ALTER COLUMN "quantity" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "quantity" SET DATA TYPE integer USING quantity::integer;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DATA TYPE double precision USING price::double precision;--> statement-breakpoint
-- Re-apply numeric defaults so the declared schema still matches shared/db-schema.ts.
ALTER TABLE "products" ALTER COLUMN "quantity" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "products" ALTER COLUMN "price" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "created_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_products_created_at" ON "products" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "idx_products_category" ON "products" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_products_price" ON "products" USING btree ("price");--> statement-breakpoint
CREATE INDEX "idx_products_quantity" ON "products" USING btree ("quantity");