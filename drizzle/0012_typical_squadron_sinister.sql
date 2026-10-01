CREATE TABLE `retired_episodes` (
	`title_id` integer NOT NULL,
	`season` integer NOT NULL,
	`number` integer NOT NULL,
	`at` integer NOT NULL,
	PRIMARY KEY(`title_id`, `season`, `number`),
	FOREIGN KEY (`title_id`) REFERENCES `titles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `old_copies` ADD `due` integer DEFAULT false NOT NULL;