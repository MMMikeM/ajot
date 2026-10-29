-- A reminder without a task has nothing to remind of: the cron marks it sent and sends nothing.
-- Nor has an unsent one for a task with no due date, which clearing the date would have dropped.
DELETE FROM `notification_queue` WHERE `type` = 'reminder-due' AND (`task_id` IS NULL OR (
  `sent_at` IS NULL AND `task_id` IN (SELECT `id` FROM `tasks` WHERE `due_date` IS NULL)
));--> statement-breakpoint
-- Two due-date edits at once could each delete the pending reminder and insert their own. The one
-- for the task's due date is kept, else the newest: the later edit's.
DELETE FROM `notification_queue` WHERE `rowid` IN (
  SELECT `rowid` FROM (
    SELECT `q`.`rowid`, ROW_NUMBER() OVER (
      PARTITION BY `q`.`task_id`
      ORDER BY `q`.`scheduled_for` = `t`.`due_date` DESC, `q`.`created_at` DESC, `q`.`rowid` DESC
    ) AS `n`
    FROM `notification_queue` `q` JOIN `tasks` `t` ON `t`.`id` = `q`.`task_id`
    WHERE `q`.`type` = 'reminder-due' AND `q`.`sent_at` IS NULL
  ) WHERE `n` > 1
);--> statement-breakpoint
-- Two cron runs at once could each send a user the day's digest and record it. Each row only
-- records one that was sent, so the first is kept.
DELETE FROM `notification_queue` WHERE `type` = 'overdue-digest' AND `rowid` NOT IN (
  SELECT min(`rowid`) FROM `notification_queue` WHERE `type` = 'overdue-digest'
  GROUP BY `user_id`, substr(`scheduled_for`, 1, 10)
);--> statement-breakpoint
-- A digest's task_id was never read, so it's dropped and the record of the digest kept.
UPDATE `notification_queue` SET `task_id` = NULL WHERE `type` <> 'reminder-due' AND `task_id` IS NOT NULL;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_notification_queue` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`task_id` text,
	`scheduled_for` text NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_notification_queue_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_queue_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT "only_reminders_have_a_task" CHECK(("type" = 'reminder-due') = ("task_id" IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_notification_queue`(`id`, `user_id`, `type`, `task_id`, `scheduled_for`, `sent_at`, `created_at`) SELECT `id`, `user_id`, `type`, `task_id`, `scheduled_for`, `sent_at`, `created_at` FROM `notification_queue`;--> statement-breakpoint
DROP TABLE `notification_queue`;--> statement-breakpoint
ALTER TABLE `__new_notification_queue` RENAME TO `notification_queue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_queue_pending_reminder_idx` ON `notification_queue` (`task_id`) WHERE "notification_queue"."type" = 'reminder-due' AND "notification_queue"."sent_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `notification_queue_digest_day_idx` ON `notification_queue` (`user_id`,substr("scheduled_for", 1, 10)) WHERE "notification_queue"."type" = 'overdue-digest';
