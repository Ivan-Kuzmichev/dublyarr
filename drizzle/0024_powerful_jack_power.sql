ALTER TABLE `subscriptions` ADD `added_by` integer REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `users` ADD `role` text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `permissions` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `telegram_chat_id` text;--> statement-breakpoint
ALTER TABLE `users` ADD `notify_events` text;--> statement-breakpoint
ALTER TABLE `users` ADD `last_login_at` integer;