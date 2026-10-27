-- A note with no task lost it to a delete from before tasks were hidden instead: there's nothing
-- to attach it to, and the notes list already leaves it out. It would fail the copy below.
DELETE FROM `notes` WHERE `task_id` IS NULL OR `task_id` NOT IN (SELECT `id` FROM `tasks`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notes` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`task_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_notes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_notes`(`id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at` FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `notes_user_idx` ON `notes` (`user_id`);