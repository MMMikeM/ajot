-- A stamp ahead of the server's clock is the last-write-wins clock every later edit must beat, so
-- the row couldn't be changed until then. The server now stores no stamp later than its own time;
-- these were stored before it did.
UPDATE `tasks` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
UPDATE `tasks` SET `edited_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `edited_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
UPDATE `notes` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');--> statement-breakpoint
UPDATE `categories` SET `updated_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE `updated_at` > strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
