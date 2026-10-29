-- A contact with yourself is one no invite makes, and it reaches no one new. An Undo record of
-- removing one would put it back, which the CHECK refuses, and holds nothing else of use: only
-- the rows between the two people, here one, and the lists each shared with the other.
DELETE FROM `contacts` WHERE `user_id` = `contact_user_id`;--> statement-breakpoint
DELETE FROM `removed_contacts` WHERE EXISTS (
  SELECT 1 FROM json_each(`removed_contacts`.`contacts`)
  WHERE json_extract(`value`, '$.userId') = json_extract(`value`, '$.contactUserId')
);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_contacts` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`contact_user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_contacts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_contacts_contact_user_id_users_id_fk` FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "contact_is_someone_else" CHECK("user_id" <> "contact_user_id")
);
--> statement-breakpoint
INSERT INTO `__new_contacts`(`id`, `user_id`, `contact_user_id`, `created_at`) SELECT `id`, `user_id`, `contact_user_id`, `created_at` FROM `contacts`;--> statement-breakpoint
DROP TABLE `contacts`;--> statement-breakpoint
ALTER TABLE `__new_contacts` RENAME TO `contacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_contact_idx` ON `contacts` (`user_id`,`contact_user_id`);