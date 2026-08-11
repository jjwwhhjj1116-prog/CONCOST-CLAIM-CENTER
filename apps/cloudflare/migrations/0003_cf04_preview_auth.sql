-- CF04: Preview authentication. Passwords are seeded out-of-band as PBKDF2 hashes.
CREATE TABLE IF NOT EXISTS preview_users (
  id TEXT PRIMARY KEY NOT NULL,
  login_id TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  roles_json TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (length(login_id) BETWEEN 1 AND 100),
  CHECK (length(password_salt) = 32),
  CHECK (length(password_hash) = 64),
  CHECK (password_iterations BETWEEN 100000 AND 600000),
  CHECK (length(display_name) BETWEEN 1 AND 100),
  CHECK (json_valid(roles_json)),
  CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS preview_sessions (
  id_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES preview_users(id) ON DELETE CASCADE,
  CHECK (length(id_hash) = 64)
);

CREATE INDEX IF NOT EXISTS idx_preview_sessions_user
  ON preview_sessions(user_id, expires_at);
