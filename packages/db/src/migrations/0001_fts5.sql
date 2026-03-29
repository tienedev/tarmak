CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  entity_type, entity_id, board_id, task_id, content,
  tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS tasks_ai AFTER INSERT ON tasks BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_au AFTER UPDATE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('task', NEW.id, NEW.board_id, NEW.id, NEW.title || ' ' || COALESCE(NEW.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS tasks_ad AFTER DELETE ON tasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'task' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS comments_ai AFTER INSERT ON comments BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS comments_au AFTER UPDATE ON comments BEGIN
  DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('comment', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.content);
END;

CREATE TRIGGER IF NOT EXISTS comments_ad AFTER DELETE ON comments BEGIN
  DELETE FROM search_index WHERE entity_type = 'comment' AND entity_id = OLD.id;
END;

CREATE TRIGGER IF NOT EXISTS subtasks_ai AFTER INSERT ON subtasks BEGIN
  INSERT INTO search_index(entity_type, entity_id, board_id, task_id, content)
  VALUES ('subtask', NEW.id, (SELECT board_id FROM tasks WHERE id = NEW.task_id), NEW.task_id, NEW.title);
END;

CREATE TRIGGER IF NOT EXISTS subtasks_ad AFTER DELETE ON subtasks BEGIN
  DELETE FROM search_index WHERE entity_type = 'subtask' AND entity_id = OLD.id;
END;
