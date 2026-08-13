-- CF12: Admin-owned chapter prompts and server-only AI report authoring settings.

CREATE TABLE IF NOT EXISTS preview_report_ai_settings (
  organization_id TEXT PRIMARY KEY NOT NULL,
  provider_kind TEXT NOT NULL DEFAULT 'OPENAI',
  model_code TEXT NOT NULL DEFAULT 'gpt-5.6',
  reasoning_effort TEXT NOT NULL DEFAULT 'medium',
  secret_name TEXT NOT NULL DEFAULT 'OPENAI_API_KEY',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (provider_kind = 'OPENAI'),
  CHECK (model_code IN ('gpt-5.6','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna')),
  CHECK (reasoning_effort IN ('low','medium','high','xhigh','max')),
  CHECK (secret_name = 'OPENAI_API_KEY'),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_prompt_sets (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  claim_type TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (organization_id = 'concost'),
  CHECK (claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
  CHECK (length(name) BETWEEN 1 AND 200),
  CHECK (length(system_prompt) BETWEEN 100 AND 20000),
  CHECK (status IN ('ACTIVE','TEMPLATE_NOT_FOUND','ARCHIVED')),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_chapter_prompts (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_set_id TEXT NOT NULL,
  chapter_code TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_code TEXT NOT NULL,
  role_prompt TEXT NOT NULL,
  instruction_prompt TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (chapter_code GLOB 'CH-[0-9][0-9]'),
  CHECK (agent_code GLOB 'AGENT-[0-9][0-9]'),
  CHECK (length(title) BETWEEN 1 AND 200),
  CHECK (length(role_prompt) BETWEEN 20 AND 5000),
  CHECK (length(instruction_prompt) BETWEEN 20 AND 10000),
  CHECK (ordinal BETWEEN 1 AND 99),
  CHECK (version >= 1),
  UNIQUE (prompt_set_id, chapter_code),
  UNIQUE (prompt_set_id, ordinal),
  FOREIGN KEY (prompt_set_id) REFERENCES preview_report_prompt_sets(id),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_prompt_history (
  id TEXT PRIMARY KEY NOT NULL,
  prompt_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  role_prompt TEXT NOT NULL,
  instruction_prompt TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (version >= 1),
  UNIQUE (prompt_id, version),
  FOREIGN KEY (prompt_id) REFERENCES preview_report_chapter_prompts(id),
  FOREIGN KEY (changed_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_ai_generations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  prompt_id TEXT NOT NULL,
  prompt_version INTEGER NOT NULL,
  model_code TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  input_sha256 TEXT NOT NULL,
  output_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (organization_id = 'concost'),
  CHECK (length(input_sha256) = 64),
  CHECK (length(output_sha256) = 64),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (prompt_id) REFERENCES preview_report_chapter_prompts(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_prompt_chapters
  ON preview_report_chapter_prompts(prompt_set_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_preview_report_ai_generations_case
  ON preview_report_ai_generations(case_id, created_at DESC);

INSERT OR IGNORE INTO preview_report_ai_settings
  (organization_id, provider_kind, model_code, reasoning_effort, secret_name, version, updated_by, updated_at)
SELECT 'concost', 'OPENAI', 'gpt-5.6', 'medium', 'OPENAI_API_KEY', 1, id, CURRENT_TIMESTAMP
FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1;

INSERT OR IGNORE INTO preview_report_prompt_sets
  (id, organization_id, claim_type, name, system_prompt, status, version, updated_by, updated_at)
SELECT 'PROMPT-TYPE-' || substr(json_extract(t.value, '$.claimType'), 6, 2), 'concost', json_extract(t.value, '$.claimType'), json_extract(t.value, '$.name'),
  '당신은 건설 클레임 보고서를 작성하는 수석 전문가입니다. 승인된 사건 자료와 현재 사건의 워크플로우 기록만 사용하십시오. 근거 없는 사실, 수치, 법령, 판례를 만들지 마십시오. 각 중요 문장에 근거 식별자를 표시하고 누락은 [확인 필요], 충돌은 [근거 충돌]로 남기십시오. 결과는 DRAFT이며 사람의 검토와 승인 전에는 확정하지 마십시오.',
  CASE WHEN json_extract(t.value, '$.claimType') = 'TYPE-05' THEN 'TEMPLATE_NOT_FOUND' ELSE 'ACTIVE' END, 1, u.id, CURRENT_TIMESTAMP
FROM json_each('[{"claimType":"TYPE-01","name":"현장조사 및 수량산출 클레임"},{"claimType":"TYPE-02","name":"분석 보고서 작성 클레임"},{"claimType":"TYPE-03","name":"일반적인 클레임"},{"claimType":"TYPE-04","name":"재건축·재개발 공사비 협상"},{"claimType":"TYPE-05","name":"사감정보고서"},{"claimType":"TYPE-06","name":"물가변동"}]') t
CROSS JOIN (SELECT id FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1) u;

INSERT OR IGNORE INTO preview_report_chapter_prompts
  (id, prompt_set_id, chapter_code, title, agent_code, role_prompt, instruction_prompt, ordinal, version, updated_by, updated_at)
SELECT 'PROMPT-' || json_extract(c.value, '$.claimType') || '-' || json_extract(c.value, '$.chapterCode'), 'PROMPT-TYPE-' || substr(json_extract(c.value, '$.claimType'), 6, 2), json_extract(c.value, '$.chapterCode'), json_extract(c.value, '$.title'), json_extract(c.value, '$.agentCode'),
  CASE json_extract(c.value, '$.agentCode')
    WHEN 'AGENT-01' THEN '사건·워크플로우 사실을 시간순으로 정리하는 팩트 분석가입니다.'
    WHEN 'AGENT-02' THEN '계약 조항, 당사자 주장, 법원·감정 쟁점을 근거별로 대조하는 계약·쟁점 분석가입니다.'
    WHEN 'AGENT-03' THEN '현장 사진·도면·녹음·조사기록을 관찰과 판단으로 구분하는 현장조사 전문가입니다.'
    WHEN 'AGENT-04' THEN '수량, 단위, 산식, 단가와 합계를 재계산하는 수량·공사비 검산 전문가입니다.'
    WHEN 'AGENT-05' THEN '장별 사실과 분석을 결합하되 근거 범위를 넘지 않는 종합분석 전문가입니다.'
    ELSE '확인된 분석만 사용해 결론과 후속 조치를 작성하는 수석 검토자입니다.'
  END,
  '이 장의 제목은 "' || json_extract(c.value, '$.title') || '"입니다. 제공된 사건 특성, 제안서 연동, 착수회의, 현장조사, 수량산출, 소송기록 중 이 장에 필요한 자료만 사용하십시오. 목적 → 확인 사실 → 분석 → 장 결론 → 근거 목록 → 확인 필요 순서로 작성하십시오. 금액·수량·날짜는 원문과 대조하고 작성 분량을 늘리기 위한 반복은 금지합니다.',
  CAST(json_extract(c.value, '$.ordinal') AS INTEGER), 1, u.id, CURRENT_TIMESTAMP
FROM json_each('[{"claimType":"TYPE-01","chapterCode":"CH-01","title":"업무 개요 및 조사 범위","agentCode":"AGENT-01","ordinal":1},{"claimType":"TYPE-01","chapterCode":"CH-02","title":"검토 자료 및 적용 기준","agentCode":"AGENT-02","ordinal":2},{"claimType":"TYPE-01","chapterCode":"CH-03","title":"현장조사 방법 및 결과","agentCode":"AGENT-03","ordinal":3},{"claimType":"TYPE-01","chapterCode":"CH-04","title":"하자·기시공·미시공 항목 분석","agentCode":"AGENT-03","ordinal":4},{"claimType":"TYPE-01","chapterCode":"CH-05","title":"수량산출 및 내역 검산","agentCode":"AGENT-04","ordinal":5},{"claimType":"TYPE-01","chapterCode":"CH-06","title":"원인·책임·비용 종합","agentCode":"AGENT-05","ordinal":6},{"claimType":"TYPE-01","chapterCode":"CH-07","title":"결론 및 후속조치","agentCode":"AGENT-06","ordinal":7},{"claimType":"TYPE-02","chapterCode":"CH-01","title":"검토 목적과 질문","agentCode":"AGENT-01","ordinal":1},{"claimType":"TYPE-02","chapterCode":"CH-02","title":"자료 목록과 사실관계 연혁","agentCode":"AGENT-01","ordinal":2},{"claimType":"TYPE-02","chapterCode":"CH-03","title":"상대방 주장·감정 결과 요약","agentCode":"AGENT-02","ordinal":3},{"claimType":"TYPE-02","chapterCode":"CH-04","title":"쟁점별 분석 및 반박","agentCode":"AGENT-05","ordinal":4},{"claimType":"TYPE-02","chapterCode":"CH-05","title":"수치·공사비 검산","agentCode":"AGENT-04","ordinal":5},{"claimType":"TYPE-02","chapterCode":"CH-06","title":"의견 및 보완 요청사항","agentCode":"AGENT-06","ordinal":6},{"claimType":"TYPE-03","chapterCode":"CH-01","title":"업무 개요 및 범위","agentCode":"AGENT-01","ordinal":1},{"claimType":"TYPE-03","chapterCode":"CH-02","title":"사실관계·계약·쟁점","agentCode":"AGENT-02","ordinal":2},{"claimType":"TYPE-03","chapterCode":"CH-03","title":"기술·현장 검토","agentCode":"AGENT-03","ordinal":3},{"claimType":"TYPE-03","chapterCode":"CH-04","title":"수량·비용 검토","agentCode":"AGENT-04","ordinal":4},{"claimType":"TYPE-03","chapterCode":"CH-05","title":"종합 분석 및 결론","agentCode":"AGENT-05","ordinal":5},{"claimType":"TYPE-04","chapterCode":"CH-01","title":"협상 업무 범위와 전제","agentCode":"AGENT-01","ordinal":1},{"claimType":"TYPE-04","chapterCode":"CH-02","title":"시공사 증액 주장과 근거","agentCode":"AGENT-02","ordinal":2},{"claimType":"TYPE-04","chapterCode":"CH-03","title":"항목별 공사비 적정성","agentCode":"AGENT-04","ordinal":3},{"claimType":"TYPE-04","chapterCode":"CH-04","title":"계약·설계변경·시장조건 분석","agentCode":"AGENT-05","ordinal":4},{"claimType":"TYPE-04","chapterCode":"CH-05","title":"협상 시나리오와 권고 범위","agentCode":"AGENT-06","ordinal":5},{"claimType":"TYPE-04","chapterCode":"CH-06","title":"1차 종합 의견","agentCode":"AGENT-06","ordinal":6},{"claimType":"TYPE-04","chapterCode":"CH-07","title":"협상회의 기록과 상대방 반박","agentCode":"AGENT-01","ordinal":7},{"claimType":"TYPE-04","chapterCode":"CH-08","title":"반박 검토 및 수정 의견","agentCode":"AGENT-05","ordinal":8},{"claimType":"TYPE-06","chapterCode":"CH-01","title":"계약 조건과 조정 기준","agentCode":"AGENT-02","ordinal":1},{"claimType":"TYPE-06","chapterCode":"CH-02","title":"기준시점·비교시점·조정기간","agentCode":"AGENT-01","ordinal":2},{"claimType":"TYPE-06","chapterCode":"CH-03","title":"적용 지수·품목·제외 항목","agentCode":"AGENT-04","ordinal":3},{"claimType":"TYPE-06","chapterCode":"CH-04","title":"물가변동 산식과 항목별 계산","agentCode":"AGENT-04","ordinal":4},{"claimType":"TYPE-06","chapterCode":"CH-05","title":"민감도·대안 비교","agentCode":"AGENT-05","ordinal":5},{"claimType":"TYPE-06","chapterCode":"CH-06","title":"추정·확정 결과 및 권고","agentCode":"AGENT-06","ordinal":6}]') c
CROSS JOIN (SELECT id FROM preview_users WHERE is_active = 1 AND instr(roles_json, '"admin"') > 0 ORDER BY id LIMIT 1) u;

CREATE TRIGGER IF NOT EXISTS preview_report_ai_settings_admin_update
BEFORE UPDATE ON preview_report_ai_settings
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id = NEW.updated_by AND u.is_active = 1 AND instr(u.roles_json, '"admin"') > 0
) OR NEW.organization_id <> OLD.organization_id OR NEW.secret_name <> OLD.secret_name
  OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'report AI settings require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_prompt_admin_update
BEFORE UPDATE ON preview_report_chapter_prompts
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id = NEW.updated_by AND u.is_active = 1 AND instr(u.roles_json, '"admin"') > 0
) OR NEW.id <> OLD.id OR NEW.prompt_set_id <> OLD.prompt_set_id OR NEW.chapter_code <> OLD.chapter_code
  OR NEW.ordinal <> OLD.ordinal OR NEW.version <> OLD.version + 1 OR NEW.updated_at <= OLD.updated_at
BEGIN
  SELECT RAISE(ABORT, 'chapter prompts require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_prompt_delete_guard
BEFORE DELETE ON preview_report_chapter_prompts
BEGIN
  SELECT RAISE(ABORT, 'chapter prompts cannot be deleted');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_prompt_history_update_guard
BEFORE UPDATE ON preview_report_prompt_history
BEGIN
  SELECT RAISE(ABORT, 'prompt history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_prompt_history_delete_guard
BEFORE DELETE ON preview_report_prompt_history
BEGIN
  SELECT RAISE(ABORT, 'prompt history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_ai_generation_update_guard
BEFORE UPDATE ON preview_report_ai_generations
BEGIN
  SELECT RAISE(ABORT, 'AI generation ledger is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_ai_generation_delete_guard
BEFORE DELETE ON preview_report_ai_generations
BEGIN
  SELECT RAISE(ABORT, 'AI generation ledger is append-only');
END;
