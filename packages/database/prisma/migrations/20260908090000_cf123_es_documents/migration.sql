-- Additive ES storage; independent documents never create a placeholder case.
CREATE TABLE IF NOT EXISTS es_documents (
 id TEXT PRIMARY KEY, organizationId TEXT NOT NULL, ownerId TEXT NOT NULL,
 caseId TEXT, title TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS es_documents_owner ON es_documents(organizationId,ownerId,updatedAt);
CREATE TABLE IF NOT EXISTS es_revisions (
 id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES es_documents(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL, inputJson TEXT NOT NULL, inputHash TEXT NOT NULL,
 actorId TEXT NOT NULL, createdAt TEXT NOT NULL, UNIQUE(documentId,revision)
);
CREATE TABLE IF NOT EXISTS es_runs (
 id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES es_documents(id) ON DELETE RESTRICT,
 revisionId TEXT NOT NULL REFERENCES es_revisions(id) ON DELETE RESTRICT,
 engineVersion TEXT NOT NULL, resultJson TEXT NOT NULL, actorId TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS es_outputs (
 id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES es_runs(id) ON DELETE RESTRICT,
 selectionJson TEXT NOT NULL, pageRange TEXT NOT NULL, format TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('REQUESTED','RENDERED','FAILED','DIALOG_CLOSED')),
 actorId TEXT NOT NULL, createdAt TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS es_audit_events (
 id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES es_documents(id) ON DELETE RESTRICT,
 actorId TEXT NOT NULL, action TEXT NOT NULL, revision INTEGER NOT NULL, createdAt TEXT NOT NULL
);
-- Immutable evidence records; output job status is intentionally separate.
CREATE TRIGGER IF NOT EXISTS es_revision_no_update BEFORE UPDATE ON es_revisions BEGIN SELECT RAISE(ABORT,'ES_REVISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_revision_no_delete BEFORE DELETE ON es_revisions BEGIN SELECT RAISE(ABORT,'ES_REVISION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_run_no_update BEFORE UPDATE ON es_runs BEGIN SELECT RAISE(ABORT,'ES_RUN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_run_no_delete BEFORE DELETE ON es_runs BEGIN SELECT RAISE(ABORT,'ES_RUN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_audit_no_update BEFORE UPDATE ON es_audit_events BEGIN SELECT RAISE(ABORT,'ES_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_audit_no_delete BEFORE DELETE ON es_audit_events BEGIN SELECT RAISE(ABORT,'ES_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_owner_immutable BEFORE UPDATE OF organizationId,ownerId ON es_documents
WHEN NEW.organizationId != OLD.organizationId OR NEW.ownerId != OLD.ownerId BEGIN SELECT RAISE(ABORT,'ES_OWNER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS es_run_revision_scope BEFORE INSERT ON es_runs
WHEN NOT EXISTS(SELECT 1 FROM es_revisions WHERE id=NEW.revisionId AND documentId=NEW.documentId)
BEGIN SELECT RAISE(ABORT,'ES_REVISION_SCOPE'); END;
