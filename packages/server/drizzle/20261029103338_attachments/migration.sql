CREATE TABLE `attachments` (
	`id` text PRIMARY KEY,
	`task_id` text NOT NULL,
	`uploader_id` text NOT NULL,
	`name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`thumbhash` text,
	`has_thumb` integer DEFAULT false NOT NULL,
	`uploaded_at` text,
	`purged_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`deleted_at` text,
	CONSTRAINT `fk_attachments_task_id_tasks_id_fk` FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_attachments_uploader_id_users_id_fk` FOREIGN KEY (`uploader_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "attachment_size" CHECK("size" BETWEEN 1 AND 104857600),
	CONSTRAINT "attachment_purged_once_uploaded_and_deleted" CHECK("purged_at" IS NULL OR ("uploaded_at" IS NOT NULL AND "deleted_at" IS NOT NULL)),
	CONSTRAINT "attachment_name_length" CHECK(length("name") <= 255),
	CONSTRAINT "attachment_mime_type_length" CHECK(length("mime_type") <= 100),
	CONSTRAINT "attachment_thumbhash_length" CHECK(length("thumbhash") <= 100)
);
--> statement-breakpoint
CREATE INDEX `attachments_task_idx` ON `attachments` (`task_id`);--> statement-breakpoint
CREATE INDEX `attachments_uploader_idx` ON `attachments` (`uploader_id`);