-- CF26: encrypted organization and per-user AI credentials.
-- Plaintext provider keys never enter D1. The Worker encrypts with AES-256-GCM
-- and a Cloudflare Secret before executing these statements.

CREATE TABLE IF NOT EXISTS preview_ai_credentials (
  organization_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  ciphertext_hex TEXT NOT NULL,
  iv_hex TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, owner_scope, owner_id, provider_kind),
  CHECK (organization_id = 'concost'),
  CHECK (owner_scope IN ('ORGANIZATION','USER')),
  CHECK ((owner_scope = 'ORGANIZATION' AND owner_id = organization_id) OR owner_scope = 'USER'),
  CHECK (provider_kind IN ('OPENAI','ANTHROPIC','GEMINI')),
  CHECK (length(ciphertext_hex) BETWEEN 32 AND 1024 AND ciphertext_hex NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(iv_hex) = 24 AND iv_hex NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(key_fingerprint) = 64 AND key_fingerprint NOT GLOB '*[^0-9a-f]*'),
  CHECK (status IN ('ACTIVE','DISABLED')),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_ai_credential_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  provider_kind TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (owner_scope IN ('ORGANIZATION','USER')),
  CHECK (provider_kind IN ('OPENAI','ANTHROPIC','GEMINI')),
  CHECK (length(key_fingerprint) = 64),
  CHECK (status IN ('ACTIVE','DISABLED')),
  UNIQUE (organization_id, owner_scope, owner_id, provider_kind, version),
  FOREIGN KEY (changed_by) REFERENCES preview_users(id)
);

CREATE TRIGGER IF NOT EXISTS preview_ai_credentials_insert_guard
BEFORE INSERT ON preview_ai_credentials
WHEN NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1)
  OR (NEW.owner_scope='USER' AND NEW.owner_id<>NEW.updated_by)
  OR (NEW.owner_scope='ORGANIZATION' AND NOT EXISTS (
    SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json, '"admin"')>0
  ))
BEGIN
  SELECT RAISE(ABORT, 'AI credentials require self-service user scope or active Admin organization scope');
END;

CREATE TRIGGER IF NOT EXISTS preview_ai_credentials_update_guard
BEFORE UPDATE ON preview_ai_credentials
WHEN NEW.organization_id<>OLD.organization_id OR NEW.owner_scope<>OLD.owner_scope
  OR NEW.owner_id<>OLD.owner_id OR NEW.provider_kind<>OLD.provider_kind
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1)
  OR (NEW.owner_scope='USER' AND NEW.owner_id<>NEW.updated_by)
  OR (NEW.owner_scope='ORGANIZATION' AND NOT EXISTS (
    SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json, '"admin"')>0
  ))
BEGIN
  SELECT RAISE(ABORT, 'AI credential identity, actor, or optimistic version is invalid');
END;

CREATE TRIGGER IF NOT EXISTS preview_ai_credentials_delete_guard
BEFORE DELETE ON preview_ai_credentials
BEGIN
  SELECT RAISE(ABORT, 'AI credentials must be disabled and cryptographically overwritten');
END;

CREATE TRIGGER IF NOT EXISTS preview_ai_credential_history_update_guard
BEFORE UPDATE ON preview_ai_credential_history
BEGIN
  SELECT RAISE(ABORT, 'AI credential history is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_ai_credential_history_delete_guard
BEFORE DELETE ON preview_ai_credential_history
BEGIN
  SELECT RAISE(ABORT, 'AI credential history is append-only');
END;

ALTER TABLE preview_report_ai_generations ADD COLUMN credential_source TEXT NOT NULL DEFAULT 'ENVIRONMENT';

