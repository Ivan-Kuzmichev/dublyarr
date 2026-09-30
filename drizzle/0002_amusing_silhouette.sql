CREATE TABLE `studios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`kind` text NOT NULL,
	`trackers` text DEFAULT '[]' NOT NULL,
	`source` text NOT NULL,
	`confirmed` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer NOT NULL,
	`profile` text NOT NULL,
	`subscribed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `subscriptions_title_id_unique` ON `subscriptions` (`title_id`);