-- A sign-in that approved two codes at once could hold two widget tokens: keep its newest
DELETE FROM `mcp_tokens` WHERE `session_id` IS NOT NULL AND `id` NOT IN (
  SELECT `id` FROM (
    SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `session_id` ORDER BY `created_at` DESC, `id` DESC) AS `rank`
    FROM `mcp_tokens` WHERE `session_id` IS NOT NULL
  ) WHERE `rank` = 1
);--> statement-breakpoint
DROP INDEX IF EXISTS `mcp_tokens_session_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_tokens_one_per_session` ON `mcp_tokens` (`session_id`);
