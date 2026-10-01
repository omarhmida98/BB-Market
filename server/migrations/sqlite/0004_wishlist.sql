CREATE TABLE `wishlist` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` integer DEFAULT (strftime('%s', 'now')),
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_wishlist_user_created` ON `wishlist` (`user_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_wishlist_user_product` ON `wishlist` (`user_id`,`product_id`);