-- Rows past a new limit are brought within it before the CHECKs refuse them, keeping their text:
-- a task's title too long is cut and kept whole at the head of its description, as the extension
-- does with a selection too long for a title; text past 50,000 characters goes on in notes of the
-- same task by the same person (a task's owner for its description), in order below its others;
-- a note's title, which only repeats its content, is cut, after moving to an empty content. Only
-- names are cut outright, at 200 characters, past any real one. A table with a sort key past
-- 1,000 has every key renumbered as 20261028071147_sort_order_is_a_key does. updatedAt is left
-- alone, so edits queued against these rows aren't turned away as stale.
UPDATE `tasks` SET
  `description` = `title` || CASE WHEN coalesce(`description`, '') = '' THEN ''
    ELSE char(10) || char(10) || `description` END,
  `title` = substr(`title`, 1, 999) || '…'
WHERE length(`title`) > 1000;--> statement-breakpoint
INSERT INTO `notes` (`id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at`)
WITH RECURSIVE `parts` (`task_id`, `user_id`, `created_at`, `n`, `rest`) AS (
  SELECT `id`, `user_id`, `created_at`, 1, substr(`description`, 50001) FROM `tasks`
  WHERE length(`description`) > 50000
  UNION ALL
  SELECT `task_id`, `user_id`, `created_at`, `n` + 1, substr(`rest`, 50001) FROM `parts`
  WHERE length(`rest`) > 50000
)
SELECT lower(hex(randomblob(16))), `user_id`, substr(`rest`, 1, 1000), substr(`rest`, 1, 50000),
  `task_id`, strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, printf('-%.3f seconds', `n` / 1000.0)),
  strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, printf('-%.3f seconds', `n` / 1000.0))
FROM `parts`;--> statement-breakpoint
UPDATE `tasks` SET `description` = substr(`description`, 1, 50000)
WHERE length(`description`) > 50000;--> statement-breakpoint
UPDATE `notes` SET `content` = `title`
WHERE length(`title`) > 1000 AND coalesce(`content`, '') = '';--> statement-breakpoint
INSERT INTO `notes` (`id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at`)
WITH RECURSIVE `parts` (`task_id`, `user_id`, `created_at`, `n`, `rest`) AS (
  SELECT `task_id`, `user_id`, `created_at`, 1, substr(`content`, 50001) FROM `notes`
  WHERE length(`content`) > 50000
  UNION ALL
  SELECT `task_id`, `user_id`, `created_at`, `n` + 1, substr(`rest`, 50001) FROM `parts`
  WHERE length(`rest`) > 50000
)
SELECT lower(hex(randomblob(16))), `user_id`, substr(`rest`, 1, 1000), substr(`rest`, 1, 50000),
  `task_id`, strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, printf('-%.3f seconds', `n` / 1000.0)),
  strftime('%Y-%m-%dT%H:%M:%fZ', `created_at`, printf('-%.3f seconds', `n` / 1000.0))
FROM `parts`;--> statement-breakpoint
UPDATE `notes` SET `content` = substr(`content`, 1, 50000)
WHERE length(`content`) > 50000;--> statement-breakpoint
UPDATE `notes` SET `title` = substr(`title`, 1, 1000) WHERE length(`title`) > 1000;--> statement-breakpoint
UPDATE `categories` SET `name` = substr(`name`, 1, 199) || '…'
WHERE length(`name`) > 200;--> statement-breakpoint
UPDATE `users` SET `name` = substr(`name`, 1, 199) || '…' WHERE length(`name`) > 200;--> statement-breakpoint
UPDATE `categories` SET `sort_order` = `renumbered`.`key`
FROM (
  SELECT `id`, CASE WHEN `n` < 238328
    THEN 'X' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 3844 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` % 62 + 1, 1)
    ELSE '' END AS `key`
  FROM (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `sort_order`, `name`, `id`) - 1 AS `n`
    FROM `categories` WHERE `sort_order` IS NOT NULL
  )
) AS `renumbered`
WHERE `renumbered`.`id` = `categories`.`id`
  AND EXISTS (SELECT 1 FROM `categories` WHERE length(`sort_order`) > 1000);--> statement-breakpoint
UPDATE `tasks` SET `sort_order` = `renumbered`.`key`
FROM (
  SELECT `id`, CASE WHEN `n` < 238328
    THEN 'X' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 3844 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` % 62 + 1, 1)
    ELSE '' END AS `key`
  FROM (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `sort_order`, `created_at`, `id`) - 1 AS `n`
    FROM `tasks` WHERE `sort_order` IS NOT NULL
  )
) AS `renumbered`
WHERE `renumbered`.`id` = `tasks`.`id`
  AND EXISTS (SELECT 1 FROM `tasks` WHERE length(`sort_order`) > 1000);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_categories` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`deletion` text,
	CONSTRAINT `fk_categories_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "sort_order_is_a_key" CHECK("sort_order" IS NULL OR (length("sort_order") <= 1000
      AND "sort_order" GLOB '[A-Za-z]*' AND "sort_order" NOT GLOB '*[^0-9A-Za-z]*'
      AND "sort_order" <> 'A00000000000000000000000000'
      AND (length("sort_order") = CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END
        OR (length("sort_order") > CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END AND "sort_order" NOT GLOB '*0')))),
	CONSTRAINT "category_name_length" CHECK(length("name") <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_categories`(`id`, `user_id`, `name`, `color`, `sort_order`, `created_at`, `updated_at`, `deleted_at`, `deletion`) SELECT `id`, `user_id`, `name`, `color`, `sort_order`, `created_at`, `updated_at`, `deleted_at`, `deletion` FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	CONSTRAINT `fk_notes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "note_title_length" CHECK(length("title") <= 1000),
	CONSTRAINT "note_content_length" CHECK(length("content") <= 50000)
);
--> statement-breakpoint
INSERT INTO `__new_notes`(`id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at`) SELECT `id`, `user_id`, `title`, `content`, `task_id`, `created_at`, `updated_at` FROM `notes`;--> statement-breakpoint
DROP TABLE `notes`;--> statement-breakpoint
ALTER TABLE `__new_notes` RENAME TO `notes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	CONSTRAINT `fk_tasks_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_tasks_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_assignee_id_users_id_fk` FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_sent_by_id_users_id_fk` FOREIGN KEY (`sent_by_id`) REFERENCES `users`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `live_subtask_has_live_parent` FOREIGN KEY (`parent_id`,`live`) REFERENCES `tasks`(`id`,`live`),
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
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_users` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`username` text NOT NULL UNIQUE,
	`password_hash` text NOT NULL,
	`avatar_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT "user_name_length" CHECK(length("name") <= 200)
);
--> statement-breakpoint
INSERT INTO `__new_users`(`id`, `name`, `username`, `password_hash`, `avatar_url`, `created_at`, `updated_at`) SELECT `id`, `name`, `username`, `password_hash`, `avatar_url`, `created_at`, `updated_at` FROM `users`;--> statement-breakpoint
DROP TABLE `users`;--> statement-breakpoint
ALTER TABLE `__new_users` RENAME TO `users`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `categories_user_idx` ON `categories` (`user_id`);--> statement-breakpoint
CREATE INDEX `notes_user_idx` ON `notes` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_live_idx` ON `tasks` (`id`,`live`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);