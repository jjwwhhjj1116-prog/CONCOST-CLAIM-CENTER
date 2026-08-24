-- CF52: encrypted Hermes private-bridge configuration and operational catalog separation.

CREATE TABLE IF NOT EXISTS preview_hermes_bridge_settings (
  organization_id TEXT PRIMARY KEY CHECK (organization_id = 'concost'),
  base_url TEXT NOT NULL CHECK (length(base_url) BETWEEN 12 AND 500),
  key_id TEXT NOT NULL CHECK (length(key_id) BETWEEN 3 AND 80),
  encrypted_hmac_key TEXT NOT NULL CHECK (length(encrypted_hmac_key) >= 64),
  iv TEXT NOT NULL CHECK (length(iv) = 24),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_hermes_bridge_settings_insert_guard
BEFORE INSERT ON preview_hermes_bridge_settings
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u
  WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
)
BEGIN SELECT RAISE(ABORT,'Hermes bridge settings require active Admin'); END;

CREATE TRIGGER IF NOT EXISTS preview_hermes_bridge_settings_update_guard
BEFORE UPDATE ON preview_hermes_bridge_settings
WHEN NEW.organization_id<>OLD.organization_id OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
  )
BEGIN SELECT RAISE(ABORT,'Hermes bridge settings require Admin and optimistic version'); END;

CREATE TRIGGER IF NOT EXISTS preview_hermes_bridge_settings_delete_guard
BEFORE DELETE ON preview_hermes_bridge_settings
BEGIN SELECT RAISE(ABORT,'Hermes bridge settings cannot be physically deleted'); END;

CREATE TABLE IF NOT EXISTS preview_catalog_records (
  record_kind TEXT NOT NULL CHECK (record_kind IN ('INTAKE','PROPOSAL')),
  record_id TEXT NOT NULL CHECK (length(record_id) = 36),
  organization_id TEXT NOT NULL DEFAULT 'concost' CHECK (organization_id = 'concost'),
  list_hidden INTEGER NOT NULL DEFAULT 0 CHECK (list_hidden IN (0,1)),
  db_deleted INTEGER NOT NULL DEFAULT 0 CHECK (db_deleted IN (0,1)),
  drive_archive_file_id TEXT,
  drive_archive_url TEXT,
  drive_archived_at TEXT,
  drive_archived_by TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (record_kind, record_id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id),
  FOREIGN KEY (drive_archived_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_catalog_records_visibility
ON preview_catalog_records(record_kind,db_deleted,list_hidden,updated_at DESC);

CREATE TABLE IF NOT EXISTS preview_catalog_actions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  record_kind TEXT NOT NULL CHECK (record_kind IN ('INTAKE','PROPOSAL')),
  record_id TEXT NOT NULL CHECK (length(record_id) = 36),
  action_code TEXT NOT NULL CHECK (action_code IN ('HIDE_FROM_LIST','RESTORE_TO_LIST','ARCHIVE_TO_DRIVE','ADMIN_DELETE')),
  detail_json TEXT NOT NULL CHECK (json_valid(detail_json)),
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_catalog_actions_record
ON preview_catalog_actions(record_kind,record_id,created_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_catalog_records_update_guard
BEFORE UPDATE ON preview_catalog_records
WHEN NEW.record_kind<>OLD.record_kind OR NEW.record_id<>OLD.record_id OR NEW.organization_id<>OLD.organization_id
  OR NEW.created_at<>OLD.created_at OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN SELECT RAISE(ABORT,'catalog record identity or optimistic version is invalid'); END;

CREATE TRIGGER IF NOT EXISTS preview_catalog_records_delete_guard
BEFORE DELETE ON preview_catalog_records
BEGIN SELECT RAISE(ABORT,'catalog records cannot be physically deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_catalog_actions_update_guard
BEFORE UPDATE ON preview_catalog_actions
BEGIN SELECT RAISE(ABORT,'catalog actions are append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_catalog_actions_delete_guard
BEFORE DELETE ON preview_catalog_actions
BEGIN SELECT RAISE(ABORT,'catalog actions are append-only'); END;
