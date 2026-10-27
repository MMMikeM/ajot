-- Leaving a list now takes the leaver's tasks to their Inbox and unfiles their shares filed there.
-- This does the same for those who left before. A deleted list is left alone: its restore puts its
-- tasks and shares back. The views are dropped while migrations run, so membership is spelled out.
UPDATE `tasks` SET `category_id` = NULL, `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `parent_id` IS NULL
  AND `category_id` IN (SELECT `id` FROM `categories` WHERE `deleted_at` IS NULL)
  AND NOT EXISTS (SELECT 1 FROM `categories` c WHERE c.`id` = `tasks`.`category_id` AND c.`user_id` = `tasks`.`user_id`)
  AND NOT EXISTS (SELECT 1 FROM `category_collaborators` cc WHERE cc.`category_id` = `tasks`.`category_id` AND cc.`user_id` = `tasks`.`user_id`);--> statement-breakpoint
UPDATE `task_shares` SET `category_id` = NULL
WHERE `category_id` IN (SELECT `id` FROM `categories` WHERE `deleted_at` IS NULL)
  AND NOT EXISTS (SELECT 1 FROM `categories` c WHERE c.`id` = `task_shares`.`category_id` AND c.`user_id` = `task_shares`.`shared_with_user_id`)
  AND NOT EXISTS (SELECT 1 FROM `category_collaborators` cc WHERE cc.`category_id` = `task_shares`.`category_id` AND cc.`user_id` = `task_shares`.`shared_with_user_id`);
