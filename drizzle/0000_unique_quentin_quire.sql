CREATE TABLE `activities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`topic` text NOT NULL,
	`level` text NOT NULL,
	`identity_mode` text NOT NULL,
	`student_count` integer NOT NULL,
	`roster_json` text DEFAULT '[]' NOT NULL,
	`questions_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
