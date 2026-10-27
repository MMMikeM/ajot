CREATE INDEX `categories_user_idx` ON `categories` (`user_id`);--> statement-breakpoint
CREATE INDEX `category_collaborators_user_idx` ON `category_collaborators` (`user_id`);--> statement-breakpoint
CREATE INDEX `task_shares_task_idx` ON `task_shares` (`task_id`);--> statement-breakpoint
CREATE INDEX `task_shares_user_idx` ON `task_shares` (`shared_with_user_id`);--> statement-breakpoint
CREATE INDEX `tasks_user_idx` ON `tasks` (`user_id`);--> statement-breakpoint
CREATE INDEX `tasks_category_idx` ON `tasks` (`category_id`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_id`);--> statement-breakpoint
CREATE VIEW `list_members` AS 
  SELECT id AS list_id, user_id FROM categories WHERE deleted_at IS NULL
  UNION ALL
  SELECT cc.category_id AS list_id, cc.user_id FROM category_collaborators cc
  JOIN categories c ON c.id = cc.category_id AND c.deleted_at IS NULL;--> statement-breakpoint
CREATE VIEW `task_access` AS SELECT h.holder_id AS task_id, h.user_id, h.can_edit, h.can_delete FROM (SELECT id AS holder_id, user_id, 1 AS can_edit, 1 AS can_delete FROM tasks) h UNION ALL SELECT h.holder_id AS task_id, h.user_id, h.can_edit, h.can_delete FROM (SELECT task_id AS holder_id, shared_with_user_id AS user_id,
    permission = 'edit' AS can_edit, 0 AS can_delete FROM task_shares) h UNION ALL SELECT h.holder_id AS task_id, h.user_id, h.can_edit, h.can_delete FROM (SELECT t.id AS holder_id, m.user_id, 1 AS can_edit, 0 AS can_delete
    FROM tasks t JOIN list_members m ON m.list_id = t.category_id) h UNION ALL SELECT c.id AS task_id, h.user_id, h.can_edit, h.can_delete
    FROM tasks c JOIN (SELECT id AS holder_id, user_id, 1 AS can_edit, 1 AS can_delete FROM tasks) h ON h.holder_id = c.parent_id UNION ALL SELECT c.id AS task_id, h.user_id, h.can_edit, h.can_delete
    FROM tasks c JOIN (SELECT task_id AS holder_id, shared_with_user_id AS user_id,
    permission = 'edit' AS can_edit, 0 AS can_delete FROM task_shares) h ON h.holder_id = c.parent_id UNION ALL SELECT c.id AS task_id, h.user_id, h.can_edit, h.can_delete
    FROM tasks c JOIN (SELECT t.id AS holder_id, m.user_id, 1 AS can_edit, 0 AS can_delete
    FROM tasks t JOIN list_members m ON m.list_id = t.category_id) h ON h.holder_id = c.parent_id;