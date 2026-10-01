ALTER TABLE `downloads` ADD `replaced_by_id` integer REFERENCES downloads(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `downloads` ADD `note` text;