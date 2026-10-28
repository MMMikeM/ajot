-- A subscription with no user, from before they had one, got every user's pushes; one whose user
-- is gone would fail the copy below. A device whose row goes uploads it again when it next opens.
DELETE FROM `push_subscriptions` WHERE `user_id` IS NULL OR `user_id` NOT IN (SELECT `id` FROM `users`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_push_subscriptions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL UNIQUE,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`kind` text DEFAULT 'web' NOT NULL,
	`device_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_push_subscriptions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_push_subscriptions`(`id`, `user_id`, `endpoint`, `p256dh`, `auth`, `kind`, `device_id`, `created_at`) SELECT `id`, `user_id`, `endpoint`, `p256dh`, `auth`, `kind`, `device_id`, `created_at` FROM `push_subscriptions`;--> statement-breakpoint
DROP TABLE `push_subscriptions`;--> statement-breakpoint
ALTER TABLE `__new_push_subscriptions` RENAME TO `push_subscriptions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;