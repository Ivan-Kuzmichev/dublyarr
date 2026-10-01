CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`hash` text NOT NULL,
	`title_id` integer NOT NULL,
	`release_id` integer,
	`season` integer NOT NULL,
	`kind` text NOT NULL,
	`episodes` text DEFAULT '[]' NOT NULL,
	`state` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`dl_speed` integer DEFAULT 0 NOT NULL,
	`eta` integer,
	`size` integer NOT NULL,
	`name` text NOT NULL,
	`content_path` text,
	`studio_label` text,
	`resolution` integer,
	`added_at` integer NOT NULL,
	`completed_at` integer,
	`imported_at` integer,
	`last_seeded_at` integer,
	`last_error` text,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`release_id`) REFERENCES `releases`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `downloads_hash_unique` ON `downloads` (`hash`);--> statement-breakpoint
CREATE INDEX `downloads_title_state` ON `downloads` (`title_id`,`state`);--> statement-breakpoint
CREATE TABLE `episode_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`download_id` integer,
	`studio_label` text,
	`resolution` integer,
	`method` text NOT NULL,
	`imported_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`download_id`) REFERENCES `downloads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `episode_files_title_season_number` ON `episode_files` (`title_id`,`season`,`number`);--> statement-breakpoint
CREATE TABLE `wanted_state` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`until` text,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wanted_state_title_season_number` ON `wanted_state` (`title_id`,`season`,`number`);