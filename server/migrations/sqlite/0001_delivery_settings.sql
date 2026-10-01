ALTER TABLE `orders` ADD `fulfillment_method` text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_fee` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `pickup_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `delivery_enabled` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `delivery_fee` text DEFAULT '7' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `free_delivery_threshold` text DEFAULT '100' NOT NULL;--> statement-breakpoint
ALTER TABLE `settings` ADD `delivery_note` text;