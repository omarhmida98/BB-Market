ALTER TABLE "homepage_sections" RENAME COLUMN "title" TO "title_fr";--> statement-breakpoint
ALTER TABLE "homepage_sections" RENAME COLUMN "tile_title" TO "tile_title_fr";--> statement-breakpoint
ALTER TABLE "homepage_sections" RENAME COLUMN "tile_subtitle" TO "tile_subtitle_fr";--> statement-breakpoint
ALTER TABLE "homepage_sections" RENAME COLUMN "tile_cta_label" TO "tile_cta_label_fr";--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "title_en" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "title_ar" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_title_en" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_title_ar" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_subtitle_en" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_subtitle_ar" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_cta_label_en" text;--> statement-breakpoint
ALTER TABLE "homepage_sections" ADD COLUMN "tile_cta_label_ar" text;--> statement-breakpoint
UPDATE "homepage_sections" SET "title_en" = 'New arrivals', "title_ar" = 'وصل حديثاً' WHERE "type" = 'newest' AND "title_fr" = 'Nouveautés';--> statement-breakpoint
UPDATE "homepage_sections" SET "title_en" = 'Best sellers', "title_ar" = 'الأكثر مبيعاً' WHERE "type" = 'best_sellers' AND "title_fr" = 'Meilleures ventes';--> statement-breakpoint
UPDATE "homepage_sections" SET "title_en" = 'Gifts & Décor', "title_ar" = 'هدايا وديكور' WHERE "type" = 'category' AND "title_fr" = 'Cadeaux & Décor';--> statement-breakpoint
UPDATE "homepage_sections" SET "title_en" = 'Last pieces', "title_ar" = 'آخر القطع' WHERE "type" = 'low_stock' AND "title_fr" = 'Dernières pièces';
