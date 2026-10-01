CREATE TABLE `deletions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title_id` integer,
	`label` text NOT NULL,
	`why` text NOT NULL,
	`size` integer NOT NULL,
	`at` integer NOT NULL,
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `keep_all` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `auto_delete` integer DEFAULT false NOT NULL;