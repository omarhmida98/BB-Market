-- Relational categories: products, homepage sections and promos reference a
-- category by id instead of by name. SQLite enforces these FKs only while
-- `PRAGMA foreign_keys = ON` (server/db.ts sets it); the app also blocks a
-- referenced category from deletion with a friendly message.
--
-- Additive and non-destructive: the legacy text `category` columns are kept for
-- backfill/compat and are no longer the source of truth. Unmatched legacy rows
-- (a name with no matching category) are left with category_id = NULL and
-- surfaced by `npm run db:category-report`; nothing is guessed or auto-created.
ALTER TABLE `products` ADD COLUMN `category_id` integer REFERENCES categories(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `homepage_sections` ADD COLUMN `category_id` integer REFERENCES categories(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE `promos` ADD COLUMN `category_id` integer REFERENCES categories(id) ON DELETE RESTRICT;
--> statement-breakpoint
UPDATE products SET category_id = (SELECT id FROM categories WHERE categories.name = products.category) WHERE category_id IS NULL;
--> statement-breakpoint
UPDATE homepage_sections SET category_id = (SELECT id FROM categories WHERE categories.name = homepage_sections.category) WHERE category_id IS NULL AND category IS NOT NULL;
--> statement-breakpoint
UPDATE promos SET category_id = (SELECT id FROM categories WHERE categories.name = promos.category) WHERE category_id IS NULL AND category IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `idx_products_category_id` ON `products` (`category_id`);
