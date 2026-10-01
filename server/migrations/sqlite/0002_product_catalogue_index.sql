PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`image_url` text NOT NULL,
	`category` text NOT NULL,
	`quantity` integer DEFAULT 0 NOT NULL,
	`price` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL
);--> statement-breakpoint
-- SQLite cannot ALTER a column type, so the table is rebuilt. quantity/price move
-- from text to integer/real: SQLite applies the target column's affinity on insert,
-- so the existing '39' / '20.5' strings become real numbers here.
-- created_at is backfilled with the current time (equivalent to its column default)
-- instead of being copied, because the old table has no such column.
INSERT INTO `__new_products`("id", "name", "description", "image_url", "category", "quantity", "price", "created_at") SELECT "id", "name", "description", "image_url", "category", "quantity", "price", strftime('%s', 'now') FROM `products`;--> statement-breakpoint
DROP TABLE `products`;--> statement-breakpoint
ALTER TABLE `__new_products` RENAME TO `products`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_products_created_at` ON `products` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `idx_products_category` ON `products` (`category`);--> statement-breakpoint
CREATE INDEX `idx_products_price` ON `products` (`price`);--> statement-breakpoint
CREATE INDEX `idx_products_quantity` ON `products` (`quantity`);
