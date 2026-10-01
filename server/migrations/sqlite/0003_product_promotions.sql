ALTER TABLE `products` ADD `promo_price` real;--> statement-breakpoint
ALTER TABLE `products` ADD `promo_start` integer;--> statement-breakpoint
ALTER TABLE `products` ADD `promo_end` integer;--> statement-breakpoint
CREATE INDEX `idx_products_promoted` ON `products` (`id`) WHERE "products"."promo_price" is not null;