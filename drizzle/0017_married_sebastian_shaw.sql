ALTER TABLE `downloads` ADD `paused_by_user` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `downloads` ADD `restarts` text DEFAULT '[]' NOT NULL;