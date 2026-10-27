CREATE TABLE `categories` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`sort_order` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	`deletion` text,
	CONSTRAINT `fk_categories_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `category_collaborators` (
	`id` text PRIMARY KEY,
	`category_id` text NOT NULL,
	`user_id` text NOT NULL,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_category_collaborators_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_category_collaborators_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `contacts` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`contact_user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_contacts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_contacts_contact_user_id_users_id_fk` FOREIGN KEY (`contact_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `invite_tokens` (
	`id` text PRIMARY KEY,
	`created_by_user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`used_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_invite_tokens_created_by_user_id_users_id_fk` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_invite_tokens_used_by_user_id_users_id_fk` FOREIGN KEY (`used_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `metric_counts` (
	`name` text NOT NULL,
	`day` text NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	CONSTRAINT `metric_counts_pk` PRIMARY KEY(`name`, `day`)
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text,
	`task_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_notes_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notes_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `notification_queue` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`task_id` text,
	`scheduled_for` text NOT NULL,
	`sent_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_notification_queue_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_notification_queue_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `push_preferences` (
	`user_id` text NOT NULL,
	`device_id` text NOT NULL,
	`muted` text NOT NULL,
	`urgent` integer DEFAULT true NOT NULL,
	CONSTRAINT `push_preferences_pk` PRIMARY KEY(`user_id`, `device_id`),
	CONSTRAINT `fk_push_preferences_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY,
	`user_id` text,
	`endpoint` text NOT NULL UNIQUE,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`kind` text DEFAULT 'web' NOT NULL,
	`device_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_push_subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `removed_contacts` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`contacts` text NOT NULL,
	`collaborators` text NOT NULL,
	`removed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_removed_contacts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `task_shares` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`shared_with_user_id` text NOT NULL,
	`category_id` text,
	`permission` text DEFAULT 'edit' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_task_shares_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_shares_shared_with_user_id_users_id_fk` FOREIGN KEY (`shared_with_user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_task_shares_category_id_categories_id_fk` FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE `tasks` (
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
	CONSTRAINT `fk_tasks_parent_id_tasks_id_fk` FOREIGN KEY (`parent_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY,
	`name` text NOT NULL,
	`username` text NOT NULL UNIQUE,
	`password_hash` text NOT NULL,
	`avatar_url` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_collaborators_cat_user_idx` ON `category_collaborators` (`category_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `contacts_user_contact_idx` ON `contacts` (`user_id`,`contact_user_id`);