-- A subtask under a subtask moves up to the top-level task above it, staying a subtask in the
-- tree it was made in, with its notes and reminders; it's then reached as that task's subtasks
-- are. A task in a loop, or under one, has no top-level task above it, so it becomes one. Each
-- task's new parent is found before any moves, so the outcome doesn't hang on the order the rows
-- are updated in. updatedAt is left alone, so edits queued against these rows aren't turned away
-- as stale. So is sort_order: a moved subtask keeps the key it had among its old siblings, so it
-- may sort in among its new ones; a key after theirs would need fractional-indexing's arithmetic.
-- The rebuild adds top_level and has_parent.
CREATE TABLE `__task_tops` (`id` text PRIMARY KEY, `top_id` text);--> statement-breakpoint
WITH RECURSIVE `under` (`id`, `top_id`) AS (
  SELECT `id`, `id` FROM `tasks` WHERE `parent_id` IS NULL
  UNION ALL
  SELECT `tasks`.`id`, `under`.`top_id` FROM `tasks` JOIN `under` ON `tasks`.`parent_id` = `under`.`id`
)
INSERT INTO `__task_tops` (`id`, `top_id`)
SELECT `tasks`.`id`, `under`.`top_id` FROM `tasks` LEFT JOIN `under` ON `under`.`id` = `tasks`.`id`
WHERE `tasks`.`parent_id` IS NOT `under`.`top_id` AND `tasks`.`parent_id` IS NOT NULL;--> statement-breakpoint
UPDATE `tasks` SET `parent_id` = (SELECT `top_id` FROM `__task_tops` WHERE `__task_tops`.`id` = `tasks`.`id`)
WHERE `id` IN (SELECT `id` FROM `__task_tops`);--> statement-breakpoint
DROP TABLE `__task_tops`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`category_id` text,
	`assignee_id` text,
	`sent_by_id` text,
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
	`top_level` integer GENERATED ALWAYS AS (CASE WHEN parent_id IS NULL THEN 1 END) VIRTUAL,
	`has_parent` integer GENERATED ALWAYS AS (CASE WHEN parent_id IS NOT NULL THEN 1 END) VIRTUAL,
	CONSTRAINT `fk_tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_tasks_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_sent_by_id_users_id_fk` FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `live_subtask_has_live_parent` FOREIGN KEY (`parent_id`,`live`) REFERENCES `tasks`(`id`,`live`),
	CONSTRAINT `subtask_has_top_level_parent` FOREIGN KEY (`parent_id`,`has_parent`) REFERENCES `tasks`(`id`,`top_level`),
	CONSTRAINT "subtask_has_no_list" CHECK("parent_id" IS NULL OR "category_id" IS NULL),
	CONSTRAINT "sort_order_is_a_key" CHECK("sort_order" IS NULL OR (length("sort_order") <= 1000
      AND "sort_order" GLOB '[A-Za-z]*' AND "sort_order" NOT GLOB '*[^0-9A-Za-z]*'
      AND "sort_order" <> 'A00000000000000000000000000'
      AND (length("sort_order") = CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END
        OR (length("sort_order") > CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END AND "sort_order" NOT GLOB '*0')))),
	CONSTRAINT "task_title_length" CHECK(length("title") <= 1000),
	CONSTRAINT "task_description_length" CHECK(length("description") <= 50000)
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(`id`, `user_id`, `category_id`, `assignee_id`, `sent_by_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at`) SELECT `id`, `user_id`, `category_id`, `assignee_id`, `sent_by_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_live_idx` ON `tasks` (`id`,`live`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_top_level_idx` ON `tasks` (`id`,`top_level`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);