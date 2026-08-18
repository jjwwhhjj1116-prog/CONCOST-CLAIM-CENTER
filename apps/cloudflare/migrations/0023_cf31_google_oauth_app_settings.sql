-- CF31: Admin-managed Google OAuth application settings.
-- The client secret is AES-256-GCM ciphertext. Plaintext is never persisted.

CREATE TABLE IF NOT EXISTS preview_google_oauth_app_settings (
  organization_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  encrypted_client_secret TEXT NOT NULL,
  iv TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (length(client_id) BETWEEN 20 AND 256 AND client_id GLOB '*[.]apps[.]googleusercontent[.]com'),
  CHECK (length(encrypted_client_secret) >= 32 AND encrypted_client_secret NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(iv) = 24 AND iv NOT GLOB '*[^0-9a-f]*'),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_google_oauth_app_insert_guard
BEFORE INSERT ON preview_google_oauth_app_settings
BEGIN
  SELECT RAISE(ABORT, 'Google OAuth app settings require an active Admin')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE lower(value)='admin')
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_google_oauth_app_update_guard
BEFORE UPDATE ON preview_google_oauth_app_settings
BEGIN
  SELECT RAISE(ABORT, 'Google OAuth app organization is immutable')
  WHERE NEW.organization_id<>OLD.organization_id;
  SELECT RAISE(ABORT, 'Google OAuth app version must increment exactly once')
  WHERE NEW.version<>OLD.version+1;
  SELECT RAISE(ABORT, 'Google OAuth app settings require an active Admin')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE lower(value)='admin')
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_google_oauth_app_delete_guard
BEFORE DELETE ON preview_google_oauth_app_settings
BEGIN
  SELECT RAISE(ABORT, 'Google OAuth app settings cannot be deleted directly');
END;
