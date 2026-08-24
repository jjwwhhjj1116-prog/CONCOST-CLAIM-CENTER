-- CF51: Admin-managed variable proposal chapter prompts (chapters 1-3).
CREATE TABLE IF NOT EXISTS preview_proposal_writing_prompts (
  chapter_number INTEGER PRIMARY KEY CHECK (chapter_number BETWEEN 1 AND 3),
  chapter_title TEXT NOT NULL,
  instruction_text TEXT NOT NULL CHECK (length(instruction_text) BETWEEN 100 AND 12000),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL REFERENCES preview_users(id),
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO preview_proposal_writing_prompts
  (chapter_number,chapter_title,instruction_text,is_active,version,updated_by,updated_at)
SELECT 1,'제안(용역)의 목적','서로 중복되지 않는 목적 5~7개를 작성한다. 각 항목은 반드시 "- "로 시작하고 2~4개의 완전한 문장으로 프로젝트 문제, 수행 행동, 기대 성과를 설명한다. 클라이언트 권익 보호, 사업 정상화 또는 분쟁 대응, 계약·정책·원가자료 검토, 협상·의사결정용 산출물을 포함한다. 입력한 의뢰 배경과 목적을 최우선 근거로 사용하며 없는 사실은 [확인 필요]로 표시한다. 최소 450자 이상 작성한다.',1,1,id,'2026-08-24T00:00:00.000Z' FROM preview_users WHERE login_id='yjw@con-cost.com' COLLATE NOCASE LIMIT 1;
INSERT OR IGNORE INTO preview_proposal_writing_prompts
  (chapter_number,chapter_title,instruction_text,is_active,version,updated_by,updated_at)
SELECT 2,'당 현장의 핵심 쟁점 분석','의뢰 단계의 핵심 쟁점과 첨부자료 요약을 바탕으로 3~5개 쟁점을 선정한다. 각 쟁점은 "### 1) 쟁점 제목" 형식의 제목과 2~4문장의 상세 분석으로 구성한다. 확인된 상황, 검증할 자료·기준, 클라이언트에 미치는 영향, 대응 방향을 반드시 포함한다. 근거 없는 계약조건·판례·수치·일정은 만들지 않고 [확인 필요]로 표시한다. 최소 600자 이상 작성한다.',1,1,id,'2026-08-24T00:00:00.000Z' FROM preview_users WHERE login_id='yjw@con-cost.com' COLLATE NOCASE LIMIT 1;
INSERT OR IGNORE INTO preview_proposal_writing_prompts
  (chapter_number,chapter_title,instruction_text,is_active,version,updated_by,updated_at)
SELECT 3,'업무 수행 내용 및 추진 계획','반드시 Markdown 표 하나로 작성한다. 열은 정확히 "단계 | 수행 업무 | 세부 내용 | 주요 산출물" 네 개를 사용한다. 데이터 행은 Fact Finding, 법리·원가 검증, 협상 지원, 총회·의결/최종 정산의 정확히 4단계로 구성한다. 각 행의 세부 내용은 2개 이상의 구체적 행동을 포함하고 주요 산출물을 명시한다. 입력한 수행 계획 메모를 최우선으로 반영하며 최소 450자 이상 작성한다.',1,1,id,'2026-08-24T00:00:00.000Z' FROM preview_users WHERE login_id='yjw@con-cost.com' COLLATE NOCASE LIMIT 1;

CREATE TRIGGER IF NOT EXISTS preview_proposal_writing_prompt_delete_guard
BEFORE DELETE ON preview_proposal_writing_prompts
BEGIN
  SELECT RAISE(ABORT,'PROPOSAL_PROMPT_DELETE_FORBIDDEN');
END;
