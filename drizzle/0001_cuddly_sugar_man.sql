CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`air_date` text,
	`runtime` integer,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episodes_title_season_number` ON `episodes` (`title_id`,`season`,`number`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`air_date` text,
	`episode_count` integer DEFAULT 0 NOT NULL,
	`poster_path` text,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `seasons_title_number` ON `seasons` (`title_id`,`number`);--> statement-breakpoint
CREATE TABLE `titles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`kind` text NOT NULL,
	`kind_manual` integer DEFAULT false NOT NULL,
	`name_ru` text NOT NULL,
	`name_original` text NOT NULL,
	`original_language` text NOT NULL,
	`alt_names` text DEFAULT '[]' NOT NULL,
	`year` integer,
	`status` text NOT NULL,
	`overview` text DEFAULT '' NOT NULL,
	`genres` text DEFAULT '[]' NOT NULL,
	`origin_countries` text DEFAULT '[]' NOT NULL,
	`networks` text DEFAULT '[]' NOT NULL,
	`poster_path` text,
	`backdrop_path` text,
	`next_air_date` text,
	`last_air_date` text,
	`refreshed_at` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `titles_tmdb_id_unique` ON `titles` (`tmdb_id`);