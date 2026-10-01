ALTER TABLE `downloads` ADD `processing` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `episode_files` ADD `processed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `episode_files` ADD `hdr` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `episode_files` ADD `duration` integer;--> statement-breakpoint
ALTER TABLE `episode_files` ADD `tracks` text;