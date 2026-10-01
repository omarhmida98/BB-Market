CREATE TABLE `homepage_sections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`type` text DEFAULT 'newest' NOT NULL,
	`category` text,
	`max_price` real,
	`max_products` integer DEFAULT 10 NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`tile_image_url` text,
	`tile_title` text,
	`tile_subtitle` text,
	`tile_cta_label` text,
	`tile_href` text,
	`created_at` integer DEFAULT (strftime('%s', 'now')) NOT NULL,
	`updated_at` integer DEFAULT (strftime('%s', 'now'))
);
--> statement-breakpoint
CREATE INDEX `idx_homepage_sections_enabled_order` ON `homepage_sections` (`enabled`,`display_order`,`id`);--> statement-breakpoint
INSERT INTO `homepage_sections` (`title`, `type`, `max_products`, `display_order`, `enabled`) VALUES ('Nouveautés', 'newest', 10, 10, 1);--> statement-breakpoint
INSERT INTO `homepage_sections` (`title`, `type`, `max_products`, `display_order`, `enabled`) VALUES ('Meilleures ventes', 'best_sellers', 10, 20, 1);--> statement-breakpoint
INSERT INTO `homepage_sections` (`title`, `type`, `category`, `max_products`, `display_order`, `enabled`) VALUES ('Cadeaux & Décor', 'category', 'Cadeaux & Décor', 10, 30, 1);--> statement-breakpoint
INSERT INTO `homepage_sections` (`title`, `type`, `max_products`, `display_order`, `enabled`) VALUES ('Dernières pièces', 'low_stock', 10, 40, 1);