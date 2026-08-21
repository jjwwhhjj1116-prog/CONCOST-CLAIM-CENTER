PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preview_proposal_company_modules (
  code TEXT PRIMARY KEY,
  chapter_number INTEGER NOT NULL UNIQUE CHECK (chapter_number BETWEEN 4 AND 11),
  title TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('EXPERTS','STRENGTHS','ORGANIZATION','TRACK_RECORD_REDEVELOPMENT','TRACK_RECORD_REB','TRACK_RECORD_CLAIM','CERTIFICATIONS','TERMS')),
  body_markdown TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preview_proposal_template_sources (
  id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL UNIQUE,
  source_format TEXT NOT NULL CHECK (source_format IN ('HWP','PDF','DOCX')),
  source_date TEXT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  analysis_status TEXT NOT NULL CHECK (analysis_status IN ('ANALYZED','REFERENCE_ONLY')),
  chapter_map_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(chapter_map_json)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  updated_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_proposal_template_default
ON preview_proposal_template_sources(is_default) WHERE is_default=1;

CREATE TABLE IF NOT EXISTS preview_proposal_exports (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  case_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  export_format TEXT NOT NULL CHECK (export_format IN ('DOCX','MARKDOWN')),
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

CREATE INDEX IF NOT EXISTS idx_preview_proposal_exports_proposal
ON preview_proposal_exports(proposal_id, created_at DESC);

INSERT OR IGNORE INTO preview_proposal_company_modules
(code,chapter_number,title,category,body_markdown,is_active,version,updated_by,created_at,updated_at) VALUES
('CH04_EXPERTS',4,'전문가 현황','EXPERTS','현동명 대표이사는 건설법무학 박사로서 건설공사비 및 클레임 업무를 30년간 수행해 왔습니다. 이원희 부사장, 이경훈 클레임센터장, 최영배 본부장, 장범선 실장이 계약·원가·현장·보고서 실무를 분담합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH05_STRENGTHS',5,'당사의 강점','STRENGTHS','주식회사 컨코스트는 1999년 설립 이후 공사비 산정·검증, 물가변동, 설계변경, 기술감정과 건설 클레임 업무를 수행해 왔습니다. 법무법인과의 협업 경험 및 한국부동산원 협력 업무를 바탕으로 기술·원가·법리 검토를 하나의 실행안으로 연결합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH06_ORGANIZATION',6,'조직도 및 업무 영역','ORGANIZATION','본사, 클레임센터, 아파트공사비연구원이 프로젝트 특성에 따라 협업합니다. 본사는 사업·계약 관리를, 클레임센터는 쟁점 분석과 협상·송무 지원을, 아파트공사비연구원은 수량·단가·공사비 검증을 담당합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH07_REDEVELOPMENT',7,'도시정비사업 공사비검증 실적','TRACK_RECORD_REDEVELOPMENT','우동3구역, 오류현대연립, 부곡가구역, 상인천초교 주변구역 등 도시정비사업에서 공사비 검증과 협상 지원을 수행했습니다. 상세 실적은 관리자 승인 DB에서 프로젝트 성격에 맞는 항목만 선택하여 첨부합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH08_REB',8,'한국부동산원 공사비검증 실적','TRACK_RECORD_REB','신촌 재개발, 학동4구역, 신반포4지구, 수원 111-3구역 등 한국부동산원 공사비검증 관련 업무를 수행했습니다. 최신성과 공개 가능 범위는 관리자 승인 실적 DB를 기준으로 적용합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH09_CLAIM',9,'건설 클레임·소송·기술감정 실적','TRACK_RECORD_CLAIM','설계변경, 공기연장, 간접비, 공사타절·정산, 하자 및 공사대금 분쟁에 관한 기술검토와 감정·송무 지원을 수행했습니다. 사건명과 당사자는 비식별 처리된 승인 실적만 제안서에 병합합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH10_CERTIFICATES',10,'자격 증명자료','CERTIFICATIONS','광운대학교 건설법무학 박사 학위, 법원감정 건설감정사 자격, 「건축견적이야기」 및 「건축시공이야기」 등 전문 저서와 승인된 증빙자료를 첨부합니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CH11_TERMS',11,'용역 조건 및 제안 범위','TERMS','세부 수행기간, 투입인력, 계약조건과 용역대가는 자료 확인 후 협의합니다. 용역대가는 [클라이언트 맞춤 견적 별도 제시]로 표기하고 공개 제안서·DB에는 원금액을 저장하지 않습니다.',1,1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z');

INSERT OR IGNORE INTO preview_proposal_template_sources
(id,source_name,source_format,source_date,is_default,analysis_status,chapter_map_json,version,updated_by,created_at,updated_at) VALUES
('CF42-SRC-260728','260728 평택 세교1구역 리츠 HUG 대응 전략 용역제안서.hwp','HWP','2026-07-28',1,'ANALYZED','[1,2,3,4,5,6,7,8,9,10,11,12]',1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CF42-SRC-260715','260715 LH매입임대주택 지원용역 제안서 실적반영파일.pdf','PDF','2026-07-15',0,'ANALYZED','[1,2,3,4,5,6,7,8,9,10]',1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CF42-SRC-260607','260607 평택화양센트럴조합 정비사업 공사비 검증 및 협상 제안서.pdf','PDF','2026-06-07',0,'ANALYZED','[1,2,3,4,5,6,7,8,9,10,11,12]',1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CF42-SRC-260624','260624 수원시 조원동 가로주택현장 용역 제안서.pdf','PDF','2026-06-24',0,'ANALYZED','[1,2,3,4,5,6,7,8,9,10,11,12]',1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z'),
('CF42-SRC-DOCX','건설공사 클레임 전문용역 제안서_2026.02.18.docx','DOCX','2026-02-18',0,'ANALYZED','[1,2,3,4,5,6,7,8]',1,'SYSTEM_SEED','2026-08-21T00:00:00.000Z','2026-08-21T00:00:00.000Z');

CREATE TRIGGER IF NOT EXISTS preview_proposal_module_update_guard
BEFORE UPDATE ON preview_proposal_company_modules
WHEN NEW.code<>OLD.code OR NEW.chapter_number<>OLD.chapter_number OR NEW.category<>OLD.category
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
  )
BEGIN SELECT RAISE(ABORT,'proposal module update requires active admin and optimistic version'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_module_delete_guard
BEFORE DELETE ON preview_proposal_company_modules
BEGIN SELECT RAISE(ABORT,'proposal module is versioned and cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_template_source_update_guard
BEFORE UPDATE ON preview_proposal_template_sources
WHEN NEW.id<>OLD.id OR NEW.source_name<>OLD.source_name OR NEW.source_format<>OLD.source_format
  OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
  )
BEGIN SELECT RAISE(ABORT,'proposal template source update requires active admin and optimistic version'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_template_source_delete_guard
BEFORE DELETE ON preview_proposal_template_sources
BEGIN SELECT RAISE(ABORT,'proposal template source cannot be deleted'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_version_cost_mask_guard
BEFORE INSERT ON preview_proposal_versions
WHEN NEW.body_text GLOB '*₩*'
  OR lower(NEW.body_text) GLOB '*krw*'
  OR NEW.body_text GLOB '*[0-9]원*'
  OR NEW.body_text GLOB '*[0-9]만원*'
  OR NEW.body_text GLOB '*[0-9]억원*'
  OR NEW.structured_inputs_json GLOB '*₩*'
  OR lower(NEW.structured_inputs_json) GLOB '*krw*'
  OR NEW.structured_inputs_json GLOB '*[0-9]원*'
  OR NEW.structured_inputs_json GLOB '*[0-9]만원*'
  OR NEW.structured_inputs_json GLOB '*[0-9]억원*'
BEGIN SELECT RAISE(ABORT,'proposal cost data must be masked before persistence'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_export_update_guard
BEFORE UPDATE ON preview_proposal_exports
BEGIN SELECT RAISE(ABORT,'proposal export history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_export_delete_guard
BEFORE DELETE ON preview_proposal_exports
BEGIN SELECT RAISE(ABORT,'proposal export history is append-only'); END;

CREATE TRIGGER IF NOT EXISTS preview_proposal_export_scope_guard
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
