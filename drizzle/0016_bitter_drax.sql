DROP INDEX `laya_answers_key`;--> statement-breakpoint
ALTER TABLE `laya_answers` ADD `model` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `laya_answers_model_key` ON `laya_answers` (`task`,`key`,`model`);