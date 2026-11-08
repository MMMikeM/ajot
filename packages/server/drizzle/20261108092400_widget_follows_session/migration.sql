-- The widget's tokens so far were handed over without a session, which its sign-in now follows
DELETE FROM `mcp_tokens` WHERE `kind` = 'widget';--> statement-breakpoint
-- In place, as in widget_tokens: SQLite tests the new column's CHECK against every existing row
ALTER TABLE `mcp_tokens` ADD `session_id` text REFERENCES `sessions`(`id`) ON UPDATE CASCADE ON DELETE CASCADE CONSTRAINT "widget_token_has_session" CHECK(`kind` <> 'widget' OR `session_id` IS NOT NULL);--> statement-breakpoint
CREATE INDEX `mcp_tokens_session_idx` ON `mcp_tokens` (`session_id`);
