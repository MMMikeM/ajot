ALTER TABLE `removed_contacts` ADD `shares` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
-- Sharing needs a contact, and removing one now unshares the tasks between the two; these are the
-- shares removals left behind before it did
DELETE FROM `task_shares` WHERE NOT EXISTS (
  SELECT 1 FROM `tasks` `t` JOIN `contacts` `c` ON `c`.`user_id` = `t`.`user_id`
  WHERE `t`.`id` = `task_shares`.`task_id`
    AND `c`.`contact_user_id` = `task_shares`.`shared_with_user_id`
);
