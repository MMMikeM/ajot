-- A subtask restored on its own under a deleted parent. It was shown nowhere, so it's hidden
-- again, with its parent's deletedAt, and goes when the parent is purged.
UPDATE `tasks` SET `deleted_at` = (SELECT `parent`.`deleted_at` FROM `tasks` `parent` WHERE `parent`.`id` = `tasks`.`parent_id`)
WHERE `deleted_at` IS NULL
  AND `parent_id` IN (SELECT `id` FROM `tasks` WHERE `deleted_at` IS NOT NULL);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`category_id` text,
	`assignee_id` text,
	`parent_id` text,
	`title` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`due_date` text,
	`sort_order` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`edited_at` text,
	`completed_at` text,
	`deleted_at` text,
	`live` integer GENERATED ALWAYS AS (CASE WHEN deleted_at IS NULL THEN 1 END) VIRTUAL,
	CONSTRAINT `fk_tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_tasks_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `live_subtask_has_live_parent` FOREIGN KEY (`parent_id`,`live`) REFERENCES `tasks`(`id`,`live`),
	CONSTRAINT "subtask_has_no_list" CHECK("parent_id" IS NULL OR "category_id" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(`id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at`) SELECT `id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_live_idx` ON `tasks` (`id`,`live`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);