-- CF09: immutable approved report finalization and deterministic output ledger.
CREATE TABLE IF NOT EXISTS preview_report_finalizations (
  id TEXT PRIMARY KEY NOT NULL, organization_id TEXT NOT NULL DEFAULT 'concost', case_id TEXT NOT NULL,
  review_id TEXT NOT NULL, report_revision_id TEXT NOT NULL, report_version INTEGER NOT NULL,
  finalized_by TEXT NOT NULL, finalized_at TEXT NOT NULL, request_key TEXT NOT NULL, request_fingerprint TEXT NOT NULL,
  CHECK (length(id)=36), CHECK (organization_id='concost'), CHECK (report_version>=1),
  CHECK (length(request_key) BETWEEN 8 AND 128), CHECK (length(request_fingerprint)=64),
  UNIQUE (organization_id, request_key), UNIQUE (review_id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id), FOREIGN KEY (review_id) REFERENCES preview_report_reviews(id),
  FOREIGN KEY (report_revision_id) REFERENCES preview_report_revisions(id), FOREIGN KEY (finalized_by) REFERENCES preview_users(id)
);
CREATE TABLE IF NOT EXISTS preview_report_outputs (
  id TEXT PRIMARY KEY NOT NULL, finalization_id TEXT NOT NULL, format TEXT NOT NULL,
  file_name TEXT NOT NULL, content_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
  CHECK (length(id)=36), CHECK (format IN ('DOCX','PDF')), CHECK (length(file_name) BETWEEN 1 AND 240),
  CHECK (length(content_sha256)=64), CHECK (byte_size>0), UNIQUE (finalization_id, format),
  FOREIGN KEY (finalization_id) REFERENCES preview_report_finalizations(id), FOREIGN KEY (created_by) REFERENCES preview_users(id)
);
CREATE TABLE IF NOT EXISTS preview_report_output_events (
  id TEXT PRIMARY KEY NOT NULL, finalization_id TEXT NOT NULL, output_id TEXT, event_type TEXT NOT NULL,
  actor_id TEXT NOT NULL, created_at TEXT NOT NULL, CHECK (length(id)=36),
  CHECK (event_type IN ('REPORT_FINALIZED','OUTPUT_GENERATED','OUTPUT_DOWNLOADED')),
  FOREIGN KEY (finalization_id) REFERENCES preview_report_finalizations(id), FOREIGN KEY (output_id) REFERENCES preview_report_outputs(id), FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);
CREATE INDEX IF NOT EXISTS idx_preview_report_finalizations_case ON preview_report_finalizations(case_id, finalized_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_report_output_events_finalization ON preview_report_output_events(finalization_id, created_at DESC);
CREATE TRIGGER IF NOT EXISTS preview_report_finalization_insert_guard BEFORE INSERT ON preview_report_finalizations
WHEN NOT EXISTS (SELECT 1 FROM preview_report_reviews v JOIN preview_report_drafts d ON d.case_id=v.case_id JOIN preview_users u ON u.id=NEW.finalized_by
  WHERE v.id=NEW.review_id AND v.status='APPROVED' AND v.case_id=NEW.case_id AND v.report_revision_id=NEW.report_revision_id
    AND v.report_version=NEW.report_version AND d.version=v.report_version AND u.is_active=1
    AND (instr(u.roles_json,'"admin"')>0 OR instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0 OR instr(u.roles_json,'"pm"')>0)
    AND (instr(u.roles_json,'"admin"')>0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=NEW.finalized_by)))
BEGIN SELECT RAISE(ABORT,'report finalization source or actor is invalid'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_finalization_update_guard BEFORE UPDATE ON preview_report_finalizations BEGIN SELECT RAISE(ABORT,'report finalizations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_finalization_delete_guard BEFORE DELETE ON preview_report_finalizations BEGIN SELECT RAISE(ABORT,'report finalizations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_output_insert_guard BEFORE INSERT ON preview_report_outputs
WHEN NOT EXISTS (SELECT 1 FROM preview_report_finalizations f WHERE f.id=NEW.finalization_id AND f.finalized_by=NEW.created_by)
BEGIN SELECT RAISE(ABORT,'report output scope is invalid'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_output_update_guard BEFORE UPDATE ON preview_report_outputs BEGIN SELECT RAISE(ABORT,'report outputs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_output_delete_guard BEFORE DELETE ON preview_report_outputs BEGIN SELECT RAISE(ABORT,'report outputs are immutable'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_output_event_update_guard BEFORE UPDATE ON preview_report_output_events BEGIN SELECT RAISE(ABORT,'report output events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS preview_report_output_event_delete_guard BEFORE DELETE ON preview_report_output_events BEGIN SELECT RAISE(ABORT,'report output events are append-only'); END;
