-- Added in place with its check: SQLite tests a new column's CHECK against every existing row,
-- so the table needn't be rebuilt as drizzle-kit would
ALTER TABLE `mcp_tokens` ADD `kind` text DEFAULT 'mcp' NOT NULL CONSTRAINT "mcp_token_kind" CHECK("kind" IN ('mcp', 'widget'));
