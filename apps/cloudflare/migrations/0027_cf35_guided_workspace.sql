-- CF35: per-user first-run tutorial completion and immutable completion history.

CREATE TABLE IF NOT EXISTS preview_user_tutorial_state (
  user_id TEXT PRIMARY KEY,
  completed_tutorial_version TEXT NOT NULL CHECK (completed_tutorial_version GLOB 'CF[0-9][0-9]_V[0-9]*'),
  completed_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_user_tutorial_history (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  user_id TEXT NOT NULL,
  tutorial_version TEXT NOT NULL CHECK (tutorial_version GLOB 'CF[0-9][0-9]_V[0-9]*'),
  state_version INTEGER NOT NULL CHECK (state_version >= 1),
  completed_by TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  UNIQUE (user_id, state_version),
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (completed_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_state_insert_guard
BEFORE INSERT ON preview_user_tutorial_state
WHEN NEW.user_id<>NEW.updated_by OR NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.user_id AND u.is_active=1
)
BEGIN SELECT RAISE(ABORT,'tutorial state requires the active owner'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_state_update_guard
BEFORE UPDATE ON preview_user_tutorial_state
WHEN NEW.user_id<>OLD.user_id OR NEW.updated_by<>NEW.user_id OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at OR NEW.completed_at<OLD.completed_at
BEGIN SELECT RAISE(ABORT,'tutorial state identity or optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_state_delete_guard
BEFORE DELETE ON preview_user_tutorial_state
BEGIN SELECT RAISE(ABORT,'tutorial state cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_history_insert_guard
BEFORE INSERT ON preview_user_tutorial_history
WHEN NEW.user_id<>NEW.completed_by OR NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.completed_by AND u.is_active=1
) OR NOT EXISTS (
  SELECT 1 FROM preview_user_tutorial_state s
  WHERE s.user_id=NEW.user_id AND s.completed_tutorial_version=NEW.tutorial_version
    AND s.version=NEW.state_version AND s.completed_at=NEW.completed_at
)
BEGIN SELECT RAISE(ABORT,'tutorial history must match the active owner state'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_history_update_guard
BEFORE UPDATE ON preview_user_tutorial_history
BEGIN SELECT RAISE(ABORT,'tutorial history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_tutorial_history_delete_guard
BEFORE DELETE ON preview_user_tutorial_history
BEGIN SELECT RAISE(ABORT,'tutorial history is append-only'); END;
