CREATE TABLE `release_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`tracker_name` text,
	`pattern` text NOT NULL,
	`verdict` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `release_rules_unique` ON `release_rules` (`title_id`,`tracker_name`,`pattern`);--> statement-breakpoint
CREATE TABLE `releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`tracker_id` integer,
	`tracker_name` text NOT NULL,
	`title` text NOT NULL,
	`attrs` text DEFAULT '{}' NOT NULL,
	`size` integer NOT NULL,
	`seeders` integer,
	`peers` integer,
	`infohash` text,
	`download_enc` text,
	`magnet` text,
	`details_url` text,
	`published_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`parsed` text NOT NULL,
	`match` text NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tracker_id`) REFERENCES `trackers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `releases_title_infohash` ON `releases` (`title_id`,`infohash`);--> statement-breakpoint
CREATE UNIQUE INDEX `releases_title_tracker_name_size` ON `releases` (`title_id`,`tracker_name`,`title`,`size`);--> statement-breakpoint
CREATE TABLE `trackers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`indexer_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'unknown' NOT NULL,
	`role` text NOT NULL,
	`last_ok_at` integer,
	`last_error` text,
	`last_error_at` integer,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `trackers_source_indexer` ON `trackers` (`source_id`,`indexer_id`);