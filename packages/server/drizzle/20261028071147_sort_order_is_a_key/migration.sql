-- A table holding a key the new CHECK refuses has every key renumbered, in the order the server
-- reads them (ties as the server breaks them), so each list keeps its order however its rows
-- are drawn from the table: c000, c001 and on, fixed width so they sort as they count. Past the
-- 238,328th the key is '', which the CHECK refuses, failing the migration rather than the order.
-- A table with none refused keeps its keys. Null stays null. updatedAt is left alone, so edits
-- queued against these rows aren't turned away as stale.
UPDATE `categories` SET `sort_order` = `renumbered`.`key`
FROM (
  SELECT `id`, CASE WHEN `n` < 238328
    THEN 'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 3844 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` % 62 + 1, 1)
    ELSE '' END AS `key`
  FROM (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `sort_order`, `name`, `id`) - 1 AS `n`
    FROM `categories` WHERE `sort_order` IS NOT NULL
  )
) AS `renumbered`
WHERE `renumbered`.`id` = `categories`.`id`
  AND EXISTS (SELECT 1 FROM `categories` WHERE `sort_order` IS NOT NULL AND NOT (
      `sort_order` GLOB '[A-Za-z]*' AND `sort_order` NOT GLOB '*[^0-9A-Za-z]*'
      AND `sort_order` <> 'A00000000000000000000000000'
      AND (length(`sort_order`) = CASE WHEN `sort_order` GLOB '[a-z]*' THEN unicode(`sort_order`) - 95 ELSE 92 - unicode(`sort_order`) END
        OR (length(`sort_order`) > CASE WHEN `sort_order` GLOB '[a-z]*' THEN unicode(`sort_order`) - 95 ELSE 92 - unicode(`sort_order`) END AND `sort_order` NOT GLOB '*0'))));--> statement-breakpoint
UPDATE `tasks` SET `sort_order` = `renumbered`.`key`
FROM (
  SELECT `id`, CASE WHEN `n` < 238328
    THEN 'c' || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 3844 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` / 62 % 62 + 1, 1)
      || substr('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', `n` % 62 + 1, 1)
    ELSE '' END AS `key`
  FROM (
    SELECT `id`, ROW_NUMBER() OVER (ORDER BY `sort_order`, `created_at`, `id`) - 1 AS `n`
    FROM `tasks` WHERE `sort_order` IS NOT NULL
  )
) AS `renumbered`
WHERE `renumbered`.`id` = `tasks`.`id`
  AND EXISTS (SELECT 1 FROM `tasks` WHERE `sort_order` IS NOT NULL AND NOT (
      `sort_order` GLOB '[A-Za-z]*' AND `sort_order` NOT GLOB '*[^0-9A-Za-z]*'
      AND `sort_order` <> 'A00000000000000000000000000'
      AND (length(`sort_order`) = CASE WHEN `sort_order` GLOB '[a-z]*' THEN unicode(`sort_order`) - 95 ELSE 92 - unicode(`sort_order`) END
        OR (length(`sort_order`) > CASE WHEN `sort_order` GLOB '[a-z]*' THEN unicode(`sort_order`) - 95 ELSE 92 - unicode(`sort_order`) END AND `sort_order` NOT GLOB '*0'))));--> statement-breakpoint
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
	CONSTRAINT "sort_order_is_a_key" CHECK("sort_order" IS NULL OR ("sort_order" GLOB '[A-Za-z]*' AND "sort_order" NOT GLOB '*[^0-9A-Za-z]*'
      AND "sort_order" <> 'A00000000000000000000000000'
      AND (length("sort_order") = CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END
        OR (length("sort_order") > CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END AND "sort_order" NOT GLOB '*0'))))
);
--> statement-breakpoint
INSERT INTO `__new_categories`(`id`, `user_id`, `name`, `color`, `sort_order`, `created_at`, `updated_at`, `deleted_at`, `deletion`) SELECT `id`, `user_id`, `name`, `color`, `sort_order`, `created_at`, `updated_at`, `deleted_at`, `deletion` FROM `categories`;--> statement-breakpoint
DROP TABLE `categories`;--> statement-breakpoint
ALTER TABLE `__new_categories` RENAME TO `categories`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
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
	CONSTRAINT "subtask_has_no_list" CHECK("parent_id" IS NULL OR "category_id" IS NULL),
	CONSTRAINT "sort_order_is_a_key" CHECK("sort_order" IS NULL OR ("sort_order" GLOB '[A-Za-z]*' AND "sort_order" NOT GLOB '*[^0-9A-Za-z]*'
      AND "sort_order" <> 'A00000000000000000000000000'
      AND (length("sort_order") = CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END
        OR (length("sort_order") > CASE WHEN "sort_order" GLOB '[a-z]*' THEN unicode("sort_order") - 95 ELSE 92 - unicode("sort_order") END AND "sort_order" NOT GLOB '*0'))))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`(`id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at`) SELECT `id`, `user_id`, `category_id`, `assignee_id`, `parent_id`, `title`, `description`, `status`, `due_date`, `sort_order`, `created_at`, `updated_at`, `edited_at`, `completed_at`, `deleted_at` FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `categories_user_idx` ON `categories` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_id_live_idx` ON `tasks` (`id`,`live`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);