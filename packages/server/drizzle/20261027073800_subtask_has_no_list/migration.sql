-- A subtask goes wherever its parent is. One with a list of its own would fail the copy below.
UPDATE `tasks` SET `category_id` = NULL WHERE `parent_id` IS NOT NULL AND `category_id` IS NOT NULL;--> statement-breakpoint
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
	CONSTRAINT `fk_tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_tasks_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "subtask_has_no_list" CHECK("parent_id" IS NULL OR "category_id" IS NULL)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(`id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at`) SELECT `id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;