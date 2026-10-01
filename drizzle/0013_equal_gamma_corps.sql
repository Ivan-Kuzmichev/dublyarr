DROP INDEX `titles_tmdb_id_unique`;--> statement-breakpoint
ALTER TABLE `titles` ADD `tmdb_type` text DEFAULT 'tv' NOT NULL;--> statement-breakpoint
ALTER TABLE `titles` ADD `runtime` integer;--> statement-breakpoint
ALTER TABLE `titles` ADD `release_dates` text;--> statement-breakpoint
ALTER TABLE `titles` ADD `digital_seen_at` text;--> statement-breakpoint
CREATE UNIQUE INDEX `titles_tmdb` ON `titles` (`tmdb_type`,`tmdb_id`);