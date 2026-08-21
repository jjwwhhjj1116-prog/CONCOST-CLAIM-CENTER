-- CF44: keep every historical export immutable while adding approved PDF output.
-- The previously applied CF42 migrations remain byte-identical; this is additive.

DROP TRIGGER IF EXISTS preview_proposal_export_update_guard;
DROP TRIGGER IF EXISTS preview_proposal_export_delete_guard;
DROP TRIGGER IF EXISTS preview_proposal_export_scope_guard;

CREATE TABLE preview_proposal_exports_cf44 (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  export_format TEXT NOT NULL CHECK (export_format IN ('DOCX','MARKDOWN','PDF')),
  file_name TEXT NOT NULL,
  content_sha256 TEXT NOT NULL CHECK (length(content_sha256)=64),
  sanitization_count INTEGER NOT NULL DEFAULT 0 CHECK (sanitization_count >= 0),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (proposal_id) REFERENCES preview_proposals(id),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (version_id) REFERENCES preview_proposal_versions(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

INSERT INTO preview_proposal_exports_cf44
SELECT id,organization_id,proposal_id,case_id,version_id,export_format,file_name,content_sha256,sanitization_count,created_by,created_at
FROM preview_proposal_exports;

DROP TABLE preview_proposal_exports;
ALTER TABLE preview_proposal_exports_cf44 RENAME TO preview_proposal_exports;

CREATE INDEX idx_preview_proposal_exports_proposal
ON preview_proposal_exports(proposal_id, created_at DESC);

CREATE TRIGGER preview_proposal_export_update_guard
BEFORE UPDATE ON preview_proposal_exports
BEGIN SELECT RAISE(ABORT,'proposal export history is append-only'); END;

CREATE TRIGGER preview_proposal_export_delete_guard
BEFORE DELETE ON preview_proposal_exports
BEGIN SELECT RAISE(ABORT,'proposal export history is append-only'); END;

CREATE TRIGGER preview_proposal_export_scope_guard
BEFORE INSERT ON preview_proposal_exports
WHEN NOT EXISTS (
  SELECT 1
  FROM preview_proposals p
  JOIN preview_proposal_versions v ON v.id=NEW.version_id AND v.proposal_id=p.id AND v.case_id=p.case_id
  JOIN preview_cases c ON c.id=p.case_id AND c.organization_id=p.organization_id
  JOIN preview_users u ON u.id=NEW.created_by AND u.is_active=1
  WHERE p.id=NEW.proposal_id AND p.case_id=NEW.case_id AND p.organization_id=NEW.organization_id
)
BEGIN SELECT RAISE(ABORT,'proposal export scope is invalid'); END;

-- Correct the catalog label to the exact newest private source filename.
DROP TRIGGER IF EXISTS preview_proposal_template_source_update_guard;

UPDATE preview_proposal_template_sources
SET source_name='260728 평택 세교1구역 리츠 HUG 대응 전력 용역제안서.hwp',
    version=version+1,
    updated_at='2026-08-21T12:00:00.000Z'
WHERE id='CF42-SRC-260728'
  AND source_name='260728 평택 세교1구역 리츠 HUG 대응 전략 용역제안서.hwp';

CREATE TRIGGER preview_proposal_template_source_update_guard
BEFORE UPDATE ON preview_proposal_template_sources
WHEN NEW.id<>OLD.id OR NEW.source_name<>OLD.source_name OR NEW.source_format<>OLD.source_format
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
  )
BEGIN SELECT RAISE(ABORT,'proposal template source update requires active admin and optimistic version'); END;
