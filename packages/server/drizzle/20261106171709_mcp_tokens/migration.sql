CREATE TABLE `mcp_tokens` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`hint` text NOT NULL,
	`can_write` integer NOT NULL,
	`expires_at` text NOT NULL,
	`last_used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	CONSTRAINT `fk_mcp_tokens_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE,
	CONSTRAINT "mcp_token_name_length" CHECK(length("name") <= 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_hash_idx` ON `mcp_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mcp_tokens_user_idx` ON `mcp_tokens` (`user_id`);