ALTER TABLE `tasks` ADD `sent_by_id` text REFERENCES users(id) ON DELETE SET NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `task_shares_task_idx`;--> statement-breakpoint
-- The new unique index refuses a second share of a task with the same person; keep the first
DELETE FROM `task_shares` WHERE rowid NOT IN (SELECT min(rowid) FROM `task_shares` GROUP BY `task_id`, `shared_with_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_shares_task_user_idx` ON `task_shares` (`task_id`,`shared_with_user_id`);