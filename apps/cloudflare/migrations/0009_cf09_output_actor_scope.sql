-- CF09 follow-up: permit any currently assigned output-author role to
-- generate the deterministic binary for an already immutable finalization.
DROP TRIGGER IF EXISTS preview_report_output_insert_guard;
CREATE TRIGGER preview_report_output_insert_guard BEFORE INSERT ON preview_report_outputs
WHEN NOT EXISTS (SELECT 1 FROM preview_report_finalizations f JOIN preview_users u ON u.id=NEW.created_by
  WHERE f.id=NEW.finalization_id AND u.is_active=1
    AND (instr(u.roles_json,'"admin"')>0 OR instr(u.roles_json,'"ceo"')>0 OR instr(u.roles_json,'"director"')>0 OR instr(u.roles_json,'"pm"')>0)
    AND (instr(u.roles_json,'"admin"')>0 OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=f.case_id AND a.user_id=NEW.created_by)))
BEGIN SELECT RAISE(ABORT,'report output scope is invalid'); END;
