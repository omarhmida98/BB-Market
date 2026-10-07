-- Relational categories (see the SQLite twin 0009_category_fk for the rationale).
-- Columns are added, backfilled by matching the legacy text name to the
-- categories table, then the ON DELETE RESTRICT foreign keys are added last so
-- the backfill is never blocked and unmatched rows stay NULL.
ALTER TABLE "products" ADD COLUMN "category_id" integer;
--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "category_id" integer;
--> statement-breakpoint
ALTER TABLE "promos" ADD COLUMN "category_id" integer;
--> statement-breakpoint
UPDATE "products" SET "category_id" = c.id FROM "categories" c WHERE c.name = "products"."category" AND "products"."category_id" IS NULL;
--> statement-breakpoint
UPDATE "homepage_sections" SET "category_id" = c.id FROM "categories" c WHERE c.name = "homepage_sections"."category" AND "homepage_sections"."category_id" IS NULL AND "homepage_sections"."category" IS NOT NULL;
--> statement-breakpoint
UPDATE "promos" SET "category_id" = c.id FROM "categories" c WHERE c.name = "promos"."category" AND "promos"."category_id" IS NULL AND "promos"."category" IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD CONSTRAINT "homepage_sections_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "promos" ADD CONSTRAINT "promos_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT;
--> statement-breakpoint
CREATE INDEX "idx_products_category_id" ON "products" ("category_id");
