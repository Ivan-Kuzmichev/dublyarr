CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	`buttons` text,
	`ref` text,
	`created_at` integer NOT NULL,
	`next_at` integer NOT NULL,
	`sent_at` integer,
	`message_id` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`answer` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_key` ON `notifications` (`key`);--> statement-breakpoint
CREATE INDEX `notifications_pending` ON `notifications` (`sent_at`,`next_at`);--> statement-breakpoint
ALTER TABLE `sources` ADD `failing_since` integer;--> statement-breakpoint
ALTER TABLE `sources` ADD `down_notified` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `wanted_state` ADD `release_id` integer REFERENCES releases(id) ON DELETE set null;