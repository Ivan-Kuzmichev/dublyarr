CREATE TABLE `notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `old_copies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`size` integer NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `studio_sightings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`studio_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`seen_at` integer NOT NULL,
	`basis` text NOT NULL,
	`from_pack` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`studio_id`) REFERENCES `studios`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `studio_sightings_key` ON `studio_sightings` (`title_id`,`studio_id`,`season`,`number`);--> statement-breakpoint
ALTER TABLE `downloads` ADD `dub_position` integer;--> statement-breakpoint
ALTER TABLE `episode_files` ADD `dub_position` integer;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `max_season` integer;--> statement-breakpoint
UPDATE `subscriptions` SET `max_season` = (SELECT MAX(`number`) FROM `seasons` WHERE `seasons`.`title_id` = `subscriptions`.`title_id`);
