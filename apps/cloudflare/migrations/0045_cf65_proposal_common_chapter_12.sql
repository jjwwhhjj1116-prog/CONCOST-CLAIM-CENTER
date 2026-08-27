PRAGMA foreign_keys = OFF;

DROP TRIGGER IF EXISTS preview_proposal_module_update_guard;
DROP TRIGGER IF EXISTS preview_proposal_module_delete_guard;

ALTER TABLE preview_proposal_company_modules RENAME TO preview_proposal_company_modules_cf42;

CREATE TABLE preview_proposal_company_modules (
  code TEXT PRIMARY KEY,
  chapter_number INTEGER NOT NULL UNIQUE CHECK (chapter_number BETWEEN 4 AND 12),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('EXPERTS','STRENGTHS','ORGANIZATION','TRACK_RECORD_REDEVELOPMENT','TRACK_RECORD_REB','TRACK_RECORD_CLAIM','CERTIFICATIONS','TERMS','CLOSING')),
  body_markdown TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO preview_proposal_company_modules
(code,chapter_number,title,category,body_markdown,is_active,version,updated_by,created_at,updated_at)
SELECT code,chapter_number,title,category,body_markdown,is_active,version,updated_by,created_at,updated_at
FROM preview_proposal_company_modules_cf42;

INSERT OR IGNORE INTO preview_proposal_company_modules
(code,chapter_number,title,category,body_markdown,is_active,version,updated_by,created_at,updated_at) VALUES
('CH12_CLOSING',12,'맺음말','CLOSING','당사는 시공사의 근거 없는 공사비 증액을 데이터 기반의 적정 공사비 산출 및 협상을 통해 검증하고, 클라이언트의 재산권과 의사결정을 보호하겠습니다.

건설공사비 업무 30년 경력의 법학박사 현동명 대표가 계약의 주요 조항을 점검하고 협상에 참여하며, 공사비 분쟁 시에는 법률·기술 지식을 바탕으로 협력 법무법인과 함께 최선의 전략과 전문자료를 제시하겠습니다.

저희의 자신감은 실적과 경험입니다. 주식회사 컨코스트 클레임센터는 확인된 자료와 객관적인 근거로 프로젝트의 합리적인 해결을 지원하겠습니다.',1,1,'SYSTEM_SEED','2026-08-27T00:00:00.000Z','2026-08-27T00:00:00.000Z');

DROP TABLE preview_proposal_company_modules_cf42;

CREATE TRIGGER preview_proposal_module_update_guard
BEFORE UPDATE ON preview_proposal_company_modules
WHEN NEW.code<>OLD.code OR NEW.chapter_number<>OLD.chapter_number OR NEW.category<>OLD.category
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
  )
BEGIN SELECT RAISE(ABORT,'proposal module update requires active admin and optimistic version'); END;

CREATE TRIGGER preview_proposal_module_delete_guard
BEFORE DELETE ON preview_proposal_company_modules
BEGIN SELECT RAISE(ABORT,'proposal module is versioned and cannot be deleted'); END;

PRAGMA foreign_keys = ON;
