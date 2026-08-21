-- CF38: Admin-approved login account lifecycle.

ALTER TABLE preview_users
  ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

CREATE TABLE preview_user_admin_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('ACCOUNT_CREATED','ACCOUNT_ACTIVATED','ACCOUNT_DEACTIVATED','PASSWORD_RESET')),
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (json_valid(detail_json)),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id),
  FOREIGN KEY (target_user_id) REFERENCES preview_users(id)
);

CREATE TRIGGER preview_user_admin_events_update_guard
BEFORE UPDATE ON preview_user_admin_events
BEGIN
  SELECT RAISE(ABORT, 'user account audit is append-only');
END;

CREATE TRIGGER preview_user_admin_events_delete_guard
BEFORE DELETE ON preview_user_admin_events
BEGIN
  SELECT RAISE(ABORT, 'user account audit is append-only');
END;

CREATE TRIGGER preview_users_delete_guard
BEFORE DELETE ON preview_users
BEGIN
  SELECT RAISE(ABORT, 'login accounts must be deactivated, not deleted');
END;

CREATE TRIGGER preview_users_version_guard
BEFORE UPDATE ON preview_users
WHEN NEW.version <> OLD.version + 1
  OR NEW.id <> OLD.id
  OR NEW.login_id <> OLD.login_id
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'login account update requires optimistic version');
END;

CREATE TRIGGER preview_users_last_admin_guard
BEFORE UPDATE ON preview_users
WHEN OLD.is_active = 1
  AND EXISTS (SELECT 1 FROM json_each(OLD.roles_json) WHERE lower(value) = 'admin')
  AND (NEW.is_active = 0 OR NOT EXISTS (SELECT 1 FROM json_each(NEW.roles_json) WHERE lower(value) = 'admin'))
  AND NOT EXISTS (
    SELECT 1 FROM preview_users other
    WHERE other.id <> OLD.id AND other.is_active = 1
      AND EXISTS (SELECT 1 FROM json_each(other.roles_json) WHERE lower(value) = 'admin')
  )
BEGIN
  SELECT RAISE(ABORT, 'the last active Admin account cannot be deactivated');
END;
