CREATE TABLE `notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`notification_id` integer NOT NULL,
	`user_id` integer NOT NULL,
	`chat_id` text NOT NULL,
	`next_at` integer NOT NULL,
	`sent_at` integer,
	`message_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deliveries_once` ON `notification_deliveries` (`notification_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `deliveries_pending` ON `notification_deliveries` (`sent_at`,`next_at`);