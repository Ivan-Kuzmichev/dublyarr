CREATE TABLE `laya_answers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`key` text NOT NULL,
	`version` integer NOT NULL,
	`answer` text NOT NULL,
	`p` real NOT NULL,
	`raw` real NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `laya_answers_key` ON `laya_answers` (`task`,`key`,`version`);--> statement-breakpoint
CREATE TABLE `laya_examples` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`task` text NOT NULL,
	`key` text NOT NULL,
	`input` text NOT NULL,
	`label` text NOT NULL,
	`laya` text,
	`source` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `laya_examples_key` ON `laya_examples` (`task`,`key`);--> statement-breakpoint
CREATE TABLE `laya_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` integer NOT NULL,
	`created_at` integer NOT NULL,
	`examples` integer NOT NULL,
	`laya` text NOT NULL,
	`model` text NOT NULL,
	`current` integer DEFAULT false NOT NULL,
	`adapters` text NOT NULL,
	`metrics` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `laya_versions_number_unique` ON `laya_versions` (`number`);