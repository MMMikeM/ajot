CREATE TABLE `removed_collaborators` (
	`id` text PRIMARY KEY,
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` text NOT NULL,
	`moved_task_ids` text NOT NULL,
	`unfiled_task_ids` text NOT NULL,
	`removed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_removed_collaborators_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_removed_collaborators_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE UNIQUE INDEX `removed_collaborators_cat_user_idx` ON `removed_collaborators` (`category_id`,`user_id`);