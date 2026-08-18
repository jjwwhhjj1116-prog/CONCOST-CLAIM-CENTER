-- CF28: persistent personal convenience settings and Admin-only workspace policy.

CREATE TABLE IF NOT EXISTS preview_user_preferences (
  user_id TEXT PRIMARY KEY,
  theme TEXT NOT NULL DEFAULT 'LIGHT' CHECK (theme IN ('LIGHT','DARK')),
  font_family TEXT NOT NULL DEFAULT 'PRETENDARD' CHECK (font_family IN ('PRETENDARD','NOTO_SANS_KR','SYSTEM')),
  font_scale INTEGER NOT NULL DEFAULT 100 CHECK (font_scale BETWEEN 90 AND 130),
  density TEXT NOT NULL DEFAULT 'COMFORTABLE' CHECK (density IN ('COMFORTABLE','COMPACT')),
  reduce_motion INTEGER NOT NULL DEFAULT 0 CHECK (reduce_motion IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES preview_users(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_workspace_settings (
  organization_id TEXT PRIMARY KEY CHECK (organization_id = 'concost'),
  organization_name TEXT NOT NULL DEFAULT '클레임센터 스튜디오' CHECK (length(organization_name) BETWEEN 2 AND 80),
  local_ai_mode TEXT NOT NULL DEFAULT 'DISABLED' CHECK (local_ai_mode IN ('DISABLED','PRIVATE_SERVER_BRIDGE')),
  memory_provider TEXT NOT NULL DEFAULT 'NONE' CHECK (memory_provider IN ('NONE','HERMES_AGENT')),
  memory_approval_mode TEXT NOT NULL DEFAULT 'ADMIN_REVIEW' CHECK (memory_approval_mode IN ('ADMIN_REVIEW','DISABLED')),
  short_term_memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK (short_term_memory_enabled IN (0,1)),
  long_term_memory_enabled INTEGER NOT NULL DEFAULT 0 CHECK (long_term_memory_enabled IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_settings_history (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  setting_scope TEXT NOT NULL CHECK (setting_scope IN ('USER_PREFERENCES','WORKSPACE_POLICY')),
  owner_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  version INTEGER NOT NULL CHECK (version >= 1),
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  UNIQUE (setting_scope, owner_id, version),
  FOREIGN KEY (changed_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_user_preferences_insert_guard
BEFORE INSERT ON preview_user_preferences
WHEN NEW.user_id<>NEW.updated_by OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.user_id AND u.is_active=1)
BEGIN SELECT RAISE(ABORT,'user preferences require the active owner'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_preferences_update_guard
BEFORE UPDATE ON preview_user_preferences
WHEN NEW.user_id<>OLD.user_id OR NEW.updated_by<>NEW.user_id OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'user preference identity or optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_user_preferences_delete_guard
BEFORE DELETE ON preview_user_preferences
BEGIN SELECT RAISE(ABORT,'user preferences cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_workspace_settings_insert_guard
BEFORE INSERT ON preview_workspace_settings
WHEN NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0)
BEGIN SELECT RAISE(ABORT,'workspace settings require active Admin'); END;

CREATE TRIGGER IF NOT EXISTS preview_workspace_settings_update_guard
BEFORE UPDATE ON preview_workspace_settings
WHEN NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0)
BEGIN SELECT RAISE(ABORT,'workspace settings require Admin and optimistic version'); END;

CREATE TRIGGER IF NOT EXISTS preview_workspace_settings_delete_guard
BEFORE DELETE ON preview_workspace_settings
BEGIN SELECT RAISE(ABORT,'workspace settings cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_settings_history_update_guard
BEFORE UPDATE ON preview_settings_history
BEGIN SELECT RAISE(ABORT,'settings history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_settings_history_insert_guard
BEFORE INSERT ON preview_settings_history
WHEN (NEW.setting_scope='USER_PREFERENCES' AND (NEW.owner_id<>NEW.changed_by OR NOT EXISTS (
       SELECT 1 FROM preview_users u WHERE u.id=NEW.changed_by AND u.is_active=1
     )))
  OR (NEW.setting_scope='WORKSPACE_POLICY' AND (NEW.owner_id<>'concost' OR NOT EXISTS (
       SELECT 1 FROM preview_users u WHERE u.id=NEW.changed_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
     )))
BEGIN SELECT RAISE(ABORT,'settings history actor or owner is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_settings_history_delete_guard
BEFORE DELETE ON preview_settings_history
BEGIN SELECT RAISE(ABORT,'settings history is append-only'); END;
