CREATE VIEW `list_members` AS 
  SELECT id AS list_id, user_id FROM categories WHERE deleted_at IS NULL
  UNION
  SELECT cc.category_id, cc.user_id FROM category_collaborators cc
  JOIN categories c ON c.id = cc.category_id AND c.deleted_at IS NULL;--> statement-breakpoint
CREATE VIEW `task_access` AS 
  WITH holder_access AS (SELECT id AS holder_id, user_id, 1 AS can_edit, 1 AS can_delete FROM tasks UNION ALL SELECT task_id, shared_with_user_id, permission = 'edit', 0 FROM task_shares UNION ALL SELECT t.id, m.user_id, 1, 0 FROM tasks t JOIN list_members m ON m.list_id = t.category_id)
  SELECT t.id AS task_id, a.user_id, max(a.can_edit) AS can_edit, max(a.can_delete) AS can_delete
  FROM tasks t JOIN holder_access a ON a.holder_id IN (t.id, t.parent_id)
  GROUP BY t.id, a.user_id;