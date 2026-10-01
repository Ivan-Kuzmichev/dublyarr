ALTER TABLE `downloads` ADD `paused_by_schedule` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD `last_searched_at` integer;