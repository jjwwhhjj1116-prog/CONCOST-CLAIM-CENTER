-- CF221: bind new submissions to one final approver. Existing requests stay intact.
ALTER TABLE preview_report_reviews ADD COLUMN assigned_reviewer_id TEXT REFERENCES preview_users(id);
CREATE INDEX idx_preview_report_reviews_recipient ON preview_report_reviews(assigned_reviewer_id, requested_at DESC);

CREATE TRIGGER preview_report_review_recipient_insert_guard
BEFORE INSERT ON preview_report_reviews
WHEN NEW.assigned_reviewer_id IS NULL
  OR NEW.assigned_reviewer_id = NEW.requested_by
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u JOIN preview_report_revisions r ON r.id=NEW.report_revision_id
    JOIN preview_report_drafts d ON d.case_id=r.case_id AND d.version=r.version
    WHERE u.id=NEW.assigned_reviewer_id AND u.is_active=1 AND u.id<>r.saved_by
      AND (instr(u.roles_json, '"ceo"')>0 OR instr(u.roles_json, '"director"')>0)
  )
BEGIN SELECT RAISE(ABORT, 'report final approver is invalid'); END;

CREATE TRIGGER preview_report_review_recipient_identity_guard
BEFORE UPDATE ON preview_report_reviews
WHEN NEW.assigned_reviewer_id IS NOT OLD.assigned_reviewer_id
BEGIN SELECT RAISE(ABORT, 'report final approver is immutable'); END;

-- Extend the existing decision scope to the named recipient without assigning
-- that person to the whole project. Preserve the guards on legacy requests.
DROP TRIGGER preview_report_review_decision_guard;
CREATE TRIGGER preview_report_review_decision_guard
BEFORE UPDATE ON preview_report_reviews
WHEN OLD.status <> 'PENDING'
  OR NEW.status NOT IN ('APPROVED','CHANGES_REQUESTED')
  OR NEW.reviewed_by IS NULL OR NEW.reviewed_by=OLD.requested_by
  OR NEW.reviewed_at IS NULL OR NEW.reviewed_at<=OLD.requested_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u JOIN preview_report_revisions r ON r.id=OLD.report_revision_id
    WHERE u.id=NEW.reviewed_by AND u.is_active=1 AND u.id<>r.saved_by
      AND (
        (OLD.assigned_reviewer_id=u.id AND (instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0))
        OR (OLD.assigned_reviewer_id IS NULL
          AND (instr(u.roles_json,'"admin"')>0 OR instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0 OR instr(u.roles_json,'"reviewer"')>0)
          AND (instr(u.roles_json,'"admin"')>0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=OLD.case_id AND a.user_id=u.id)))
      )
  )
  OR (NEW.status='APPROVED' AND NOT EXISTS (SELECT 1 FROM preview_report_drafts d WHERE d.case_id=OLD.case_id AND d.version=OLD.report_version))
BEGIN SELECT RAISE(ABORT, 'report review decision is invalid or not independent'); END;
