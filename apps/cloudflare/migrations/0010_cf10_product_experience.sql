-- CF10: A shared synthetic onboarding case makes the real workflow visible
-- immediately after login. No customer or project data is included.

INSERT OR IGNORE INTO preview_case_sequences (case_id)
VALUES ('40000000-0000-4000-8000-000000000010');

INSERT OR IGNORE INTO preview_cases (
  id, organization_id, case_number, title, description, claim_type, status, version,
  category_major, category_middle, category_minor, created_by,
  idempotency_key, request_fingerprint, created_at, updated_at, deleted_at
)
SELECT
  '40000000-0000-4000-8000-000000000010', 'concost', 'DEMO-2026-001',
  '클레임센터 스튜디오 샘플 사건',
  '로그인 후 사건 관리부터 보고서 자동저장, 검토·승인, DOCX·PDF 출력까지 직접 확인하는 합성 데모 사건입니다.',
  'TYPE-02', 'REPORT_DRAFTING', 1,
  '건설 클레임', 'TYPE-02', '분석 보고서', id,
  NULL, NULL, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL
FROM preview_users
WHERE is_active = 1
ORDER BY instr(roles_json, '"admin"') DESC, id
LIMIT 1;

INSERT OR IGNORE INTO preview_case_assignments (case_id, user_id, assigned_by, assigned_at)
SELECT
  '40000000-0000-4000-8000-000000000010', u.id,
  (SELECT id FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1),
  strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users u
WHERE u.is_active = 1
  AND EXISTS (SELECT 1 FROM preview_cases WHERE id = '40000000-0000-4000-8000-000000000010');

INSERT OR IGNORE INTO preview_case_parties (id, case_id, name, role, contact, created_by, created_at)
SELECT '40000000-0000-4000-8000-000000000011', '40000000-0000-4000-8000-000000000010',
  '샘플 발주자', 'CLIENT', 'demo-client@example.invalid', id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1;

INSERT OR IGNORE INTO preview_case_parties (id, case_id, name, role, contact, created_by, created_at)
SELECT '40000000-0000-4000-8000-000000000012', '40000000-0000-4000-8000-000000000010',
  '샘플 시공사', 'COUNTERPARTY', 'demo-builder@example.invalid', id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1;

INSERT OR IGNORE INTO preview_case_schedules (id, case_id, title, type, scheduled_at, location, created_by, created_at)
SELECT '40000000-0000-4000-8000-000000000013', '40000000-0000-4000-8000-000000000010',
  '착수 자료 검토 회의', 'INTERNAL', strftime('%Y-%m-%dT09:30:00.000Z','now','+2 days'), '온라인 회의', id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1;

INSERT OR IGNORE INTO preview_case_schedules (id, case_id, title, type, scheduled_at, location, created_by, created_at)
SELECT '40000000-0000-4000-8000-000000000014', '40000000-0000-4000-8000-000000000010',
  '1차 보고서 검토', 'CLIENT', strftime('%Y-%m-%dT05:00:00.000Z','now','+7 days'), '클레임센터 회의실', id, strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1;

INSERT OR IGNORE INTO preview_case_activities (id, case_id, actor_id, event_type, title, description, created_at)
SELECT '40000000-0000-4000-8000-000000000015', '40000000-0000-4000-8000-000000000010', id,
  'WORKSPACE_READY', '샘플 업무공간 준비 완료', '실제 기능을 바로 확인할 수 있도록 모든 활성 사용자에게 배정되었습니다.', strftime('%Y-%m-%dT%H:%M:%fZ','now')
FROM preview_users WHERE is_active = 1 ORDER BY instr(roles_json, '"admin"') DESC, id LIMIT 1;
