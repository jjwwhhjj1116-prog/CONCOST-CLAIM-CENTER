CREATE TABLE IF NOT EXISTS collaboration_documents (
  organization_id text NOT NULL,
  document_name text NOT NULL,
  yjs_state bytea NOT NULL,
  state_sha256 char(64) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NULL,
  PRIMARY KEY (organization_id, document_name),
  CHECK (document_name LIKE 'claim-center:' || organization_id || ':%')
);

CREATE TABLE IF NOT EXISTS collaboration_audit (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  document_name text NOT NULL,
  actor_user_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('CONNECT','DISCONNECT','STORE','SNAPSHOT','AUTH_DENIED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS collaboration_audit_document_time_idx
  ON collaboration_audit (organization_id, document_name, occurred_at DESC);

REVOKE ALL ON collaboration_documents, collaboration_audit FROM PUBLIC;
