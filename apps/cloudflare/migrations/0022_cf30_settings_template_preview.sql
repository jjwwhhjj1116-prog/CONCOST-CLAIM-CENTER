-- CF30: Settings consolidation, named Admin promotion, and finished report-template previews.

UPDATE preview_users
SET roles_json = json_insert(roles_json, '$[#]', 'admin')
WHERE login_id = 'yjw@con-cost.com' COLLATE NOCASE
  AND is_active = 1
  AND NOT EXISTS (SELECT 1 FROM json_each(preview_users.roles_json) WHERE lower(value) = 'admin');

CREATE TABLE IF NOT EXISTS preview_report_template_previews (
  claim_type TEXT PRIMARY KEY NOT NULL,
  template_name TEXT NOT NULL,
  purpose_text TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  finished_example_markdown TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
  CHECK (length(template_name) BETWEEN 2 AND 200),
  CHECK (length(purpose_text) BETWEEN 20 AND 1000),
  CHECK (length(finished_example_markdown) BETWEEN 300 AND 50000),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

INSERT OR IGNORE INTO preview_report_template_previews
  (claim_type, template_name, purpose_text, version, finished_example_markdown, updated_by, updated_at)
SELECT json_extract(t.value,'$.claimType'), json_extract(t.value,'$.name'), json_extract(t.value,'$.purpose'), 1,
       json_extract(t.value,'$.example'), u.id, CURRENT_TIMESTAMP
FROM json_each(json('[
  {
    "claimType":"TYPE-01",
    "name":"현장조사·수량산출 클레임 보고서",
    "purpose":"현장 상태와 계약도서의 차이를 조사하고 수량·비용 영향을 근거별로 제시하는 완제품 예시입니다.",
    "example":"# 현장조사 및 수량산출 클레임 검토보고서\n\n## 표지\n- 프로젝트: A 현장 외장공사 클레임\n- 기준일: 2026-08-18\n- 문서상태: 사람 검토 전 DRAFT\n\n## Executive Summary\n본 보고서는 계약도면, 착수회의록, 현장사진 및 실측표를 대조하여 시공 범위 차이를 검토하였다. 확인된 차이는 외장패널 128.4㎡이며 귀책 및 금액 확정은 계약조항 원문 확인 후 판단한다.\n\n## 1. 업무 개요 및 조사 범위\n조사 대상, 조사일, 참여자와 제외 범위를 명시한다.\n\n## 2. 검토 자료 및 적용 기준\n[근거 E-001] 계약도면 v3, [근거 E-004] 현장사진 24매, [근거 Q-002] 실측표를 사용하였다.\n\n## 3. 현장조사 결과\n관찰 사실과 기술 판단을 구분하고 사진번호·위치를 표로 연결한다.\n\n## 4. 하자·기시공·미시공 분석\n항목별 계약범위, 현장상태, 차이, 확인 필요사항을 정리한다.\n\n## 5. 수량산출 및 내역 검산\n산식, 단위, 원수량, 검산수량, 차이를 표시한다.\n\n## 6. 종합 분석 및 결론\n확인 사실만 결론에 반영하고 미확인 계약조항은 [확인 필요]로 남긴다.\n\n## 근거 목록\nE-001 계약도면 / E-004 현장사진 / Q-002 실측표"
  },
  {
    "claimType":"TYPE-02",
    "name":"쟁점 분석·검토의견 보고서",
    "purpose":"상대방 주장과 감정·기술자료를 쟁점별로 대조하고 반박 및 보완의견을 제시하는 완제품 예시입니다.",
    "example":"# 쟁점 분석 및 검토의견서\n\n## 표지\n- 사건: B 공사대금 청구 사건\n- 검토목적: 상대방 감정의견 검토\n- 문서상태: 사람 검토 전 DRAFT\n\n## Executive Summary\n검토 결과 주요 쟁점은 계약범위, 추가공사 지시, 수량 산정기준의 세 가지이다. 현재 자료만으로 확정할 수 없는 부분은 별도 보완자료 목록으로 분리하였다.\n\n## 1. 검토 목적과 질문\n의뢰인이 답을 필요로 하는 질문을 번호로 고정한다.\n\n## 2. 자료 목록과 사실관계 연혁\n계약, 공문, 회의록, 감정서의 날짜와 작성자를 시간순으로 정리한다.\n\n## 3. 상대방 주장·감정 결과\n주장을 왜곡하지 않고 원문 근거와 함께 요약한다.\n\n## 4. 쟁점별 분석 및 반박\n쟁점마다 상대방 근거, 당사 자료, 기술 판단, 불확실성을 표로 제시한다.\n\n## 5. 수치·공사비 검산\n원 산식과 재계산 결과를 병기하고 차이의 원인을 설명한다.\n\n## 6. 의견 및 보완 요청\n확정 의견과 추가 확인이 필요한 의견을 분리한다.\n\n## 근거 목록\nL-001 소장 / L-003 감정서 / E-021 현장도면"
  },
  {
    "claimType":"TYPE-03",
    "name":"일반 건설클레임 종합보고서",
    "purpose":"사건 개요부터 계약·현장·수량·비용 분석과 결론까지 한 문서로 연결하는 표준 완제품 예시입니다.",
    "example":"# 일반 건설클레임 종합보고서\n\n## 문서정보\n프로젝트, 발주자, 시공자, 기준일, 작성·검토자를 표시한다.\n\n## 요약의견\n제안서 연동, 착수회의, 현장조사, 수량산출 자료를 기준으로 사건의 핵심 원인과 금액 영향을 요약한다.\n\n## 1. 업무 개요 및 범위\n업무의뢰 내용과 보고서의 포함·제외 범위를 명확히 한다.\n\n## 2. 사실관계·계약·쟁점\n계약조건과 실제 사건 흐름을 연결하고 쟁점별 당사자 입장을 구분한다.\n\n## 3. 기술·현장 검토\n사진·도면·회의록을 근거로 관찰과 해석을 나누어 작성한다.\n\n## 4. 수량·비용 검토\n물량, 단가, 산식, 검산 결과와 민감도를 제시한다.\n\n## 5. 종합 분석 및 결론\n확정 사실, 합리적 판단, [확인 필요] 항목을 구분하고 후속조치를 제안한다.\n\n## 부록\n근거 인덱스, 사진대지, 수량산출표"
  },
  {
    "claimType":"TYPE-04",
    "name":"재건축·재개발 공사비 협상 보고서",
    "purpose":"시공사 증액 주장과 조합·발주자 검토근거를 항목별로 비교하여 협상 범위와 시나리오를 제시하는 완제품 예시입니다.",
    "example":"# 재건축·재개발 공사비 협상 검토보고서\n\n## Executive Summary\n시공사 증액 요청 000억원을 설계변경, 물가변동, 공기연장, 중복·근거미비 항목으로 재분류하였다. 권고 협상범위는 원자료 확인을 전제로 제시한다.\n\n## 1. 협상 업무 범위와 전제\n기준 계약, 기준일, 부가세 및 금융비용 포함 여부를 고정한다.\n\n## 2. 시공사 증액 주장과 근거\n제출문서별 주장금액과 산출근거를 원문 그대로 매핑한다.\n\n## 3. 항목별 공사비 적정성\n인정, 조정, 제외, 보완필요 네 상태로 분류한다.\n\n## 4. 계약·설계변경·시장조건 분석\n계약조항과 설계변경 승인기록을 비교한다.\n\n## 5. 협상 시나리오\n보수·기준·상한 시나리오와 각 전제조건을 제시한다.\n\n## 6. 종합 의견\n협상 우선순위와 추가 확보자료를 정리한다.\n\n## 7~8. 협상회의 및 수정의견\n회의별 상대방 반박과 당사 재검토 결과를 버전으로 누적한다."
  },
  {
    "claimType":"TYPE-05",
    "name":"사감정 기술보고서 참고본",
    "purpose":"법원 제출 가능성을 고려해 감정 대상, 조사방법, 산출 근거와 의견 한계를 엄격히 구분한 참고 완제품입니다.",
    "example":"# 사감정 기술보고서\n\n## 표지 및 확인\n사건번호, 법원, 당사자, 감정 대상, 기준일을 표시한다.\n\n## 1. 감정 의뢰사항\n의뢰 질문을 수정 없이 번호로 기재한다.\n\n## 2. 조사 대상과 방법\n현장방문, 계측, 도면대조, 인터뷰 방법과 한계를 밝힌다.\n\n## 3. 제출자료 목록\n자료명, 버전, 제출자, 수령일과 SHA-256을 기록한다.\n\n## 4. 사실관계 및 조사결과\n관찰 사실을 사진번호·위치·측정값과 연결한다.\n\n## 5. 기술 분석 및 수량·금액\n산식과 가정을 공개하고 재현 가능한 표를 제공한다.\n\n## 6. 감정 의견\n확인된 사실과 전문적 판단을 구분하고 법률 판단을 단정하지 않는다.\n\n## 7. 한계 및 확인 필요사항\n미제출 원본, 접근 불가 구역, 상충자료를 명시한다.\n\n※ 이 유형은 관리자 승인 템플릿 활성화 전 참고 열람만 가능합니다."
  },
  {
    "claimType":"TYPE-06",
    "name":"물가변동 검토보고서",
    "purpose":"계약기준·조정기간·지수 또는 품목 산식을 재현 가능하게 제시하고 조정금액을 검산하는 완제품 예시입니다.",
    "example":"# 물가변동 검토보고서\n\n## Executive Summary\n기준시점과 비교시점, 조정대상 계약금액 및 제외항목을 확정한 뒤 지수조정률과 조정금액을 계산하였다.\n\n## 1. 계약 조건과 조정 기준\n계약조항, 관련 기준, 조정방식, 적용 요건을 인용한다.\n\n## 2. 기준시점·비교시점·조정기간\n각 날짜의 근거문서와 공표지수 기준월을 표시한다.\n\n## 3. 적용 지수·품목·제외항목\n출처, 공표기관, 지수코드, 제외사유를 표로 관리한다.\n\n## 4. 물가변동 산식과 계산\n원계약금액, 공제액, 적용대가, 조정률, 부가세를 단계별로 재계산한다.\n\n## 5. 민감도·대안 비교\n기준월·제외항목 변경에 따른 결과 차이를 제시한다.\n\n## 6. 결과 및 권고\n확정값, 추정값, 미확인 입력값을 구분해 후속 확인사항과 함께 제시한다.\n\n## 근거 목록\nC-001 계약서 / I-002 공표지수 / Q-010 계산서"
  }
]')) t
CROSS JOIN (
  SELECT id FROM preview_users
  WHERE is_active=1 AND EXISTS (SELECT 1 FROM json_each(preview_users.roles_json) WHERE lower(value)='admin')
  ORDER BY CASE WHEN login_id='yjw@con-cost.com' COLLATE NOCASE THEN 0 ELSE 1 END, id LIMIT 1
) u;

CREATE TRIGGER IF NOT EXISTS preview_report_template_preview_update_guard
BEFORE UPDATE ON preview_report_template_previews
WHEN NEW.claim_type<>OLD.claim_type
  OR NEW.version<>OLD.version+1
  OR NEW.updated_at<=OLD.updated_at
  OR NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.updated_by AND u.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE lower(value)='admin')
  )
BEGIN
  SELECT RAISE(ABORT,'finished report templates require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_template_preview_delete_guard
BEFORE DELETE ON preview_report_template_previews
BEGIN
  SELECT RAISE(ABORT,'finished report templates cannot be deleted');
END;

CREATE TABLE IF NOT EXISTS preview_google_case_operations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  category TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  google_file_id TEXT,
  error_code TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id)=36),
  CHECK (organization_id='concost'),
  CHECK (category IN ('TAKEOFF_SOURCE','COST_BREAKDOWN')),
  CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CHECK (request_fingerprint GLOB '[0-9a-f]*' AND length(request_fingerprint)=64),
  CHECK (status IN ('PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  CHECK (google_file_id IS NULL OR length(google_file_id) BETWEEN 10 AND 200),
  UNIQUE (organization_id,case_id,idempotency_key),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (created_by) REFERENCES preview_users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_preview_google_case_operation_active_fingerprint
ON preview_google_case_operations(organization_id,case_id,category,request_fingerprint)
WHERE status IN ('PENDING','RECONCILIATION_REQUIRED');

CREATE TABLE IF NOT EXISTS preview_google_case_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  case_id TEXT NOT NULL,
  category TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  google_file_id TEXT NOT NULL UNIQUE,
  google_folder_id TEXT NOT NULL,
  uploaded_by_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  CHECK (length(id)=36),
  CHECK (organization_id='concost'),
  CHECK (category IN ('TAKEOFF_SOURCE','COST_BREAKDOWN')),
  CHECK (length(original_name) BETWEEN 1 AND 240),
  CHECK (length(mime_type) BETWEEN 3 AND 160),
  CHECK (byte_size BETWEEN 1 AND 10000000),
  CHECK (sha256 GLOB '[0-9a-f]*' AND length(sha256)=64),
  CHECK (length(google_file_id) BETWEEN 10 AND 200),
  CHECK (length(google_folder_id) BETWEEN 10 AND 200),
  CHECK (length(uploaded_by_name) BETWEEN 1 AND 100),
  CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  CHECK (request_fingerprint GLOB '[0-9a-f]*' AND length(request_fingerprint)=64),
  UNIQUE (organization_id,case_id,idempotency_key),
  FOREIGN KEY (case_id) REFERENCES preview_cases(id),
  FOREIGN KEY (uploaded_by_id) REFERENCES preview_users(id),
  FOREIGN KEY (operation_id) REFERENCES preview_google_case_operations(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_google_case_evidence_case_uploaded
ON preview_google_case_evidence(case_id,uploaded_at DESC);

CREATE TRIGGER IF NOT EXISTS preview_google_case_operation_insert_guard
BEFORE INSERT ON preview_google_case_operations
BEGIN
  SELECT RAISE(ABORT,'Google case operation scope or actor is invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_cases c JOIN preview_users u ON u.id=NEW.created_by
    WHERE c.id=NEW.case_id AND c.organization_id=NEW.organization_id AND c.deleted_at IS NULL
      AND u.is_active=1
      AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value IN ('admin','ceo','director','pm','staff','reviewer'))
      AND (EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value='admin') OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=NEW.created_by))
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_operation_update_guard
BEFORE UPDATE ON preview_google_case_operations
BEGIN
  SELECT RAISE(ABORT,'Google case operation identity is immutable')
  WHERE NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.case_id<>OLD.case_id OR NEW.category<>OLD.category
     OR NEW.idempotency_key<>OLD.idempotency_key OR NEW.request_fingerprint<>OLD.request_fingerprint
     OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at OR NEW.updated_at<=OLD.updated_at;
  SELECT RAISE(ABORT,'Google case operation terminal transition is invalid')
  WHERE OLD.status<>'PENDING' OR NEW.status NOT IN ('SUCCEEDED','FAILED','RECONCILIATION_REQUIRED');
  SELECT RAISE(ABORT,'successful Google case operation requires exact evidence metadata')
  WHERE NEW.status='SUCCEEDED' AND NOT EXISTS (
    SELECT 1 FROM preview_google_case_evidence e
    WHERE e.operation_id=NEW.id AND e.case_id=NEW.case_id AND e.category=NEW.category
      AND e.idempotency_key=NEW.idempotency_key AND e.request_fingerprint=NEW.request_fingerprint
      AND e.google_file_id=NEW.google_file_id
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_operation_delete_guard
BEFORE DELETE ON preview_google_case_operations
BEGIN
  SELECT RAISE(ABORT,'Google case operations are append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_evidence_insert_guard
BEFORE INSERT ON preview_google_case_evidence
BEGIN
  SELECT RAISE(ABORT,'Google case evidence requires its pending reserved operation')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_google_case_operations o
    WHERE o.id=NEW.operation_id AND o.organization_id=NEW.organization_id AND o.case_id=NEW.case_id
      AND o.category=NEW.category AND o.idempotency_key=NEW.idempotency_key
      AND o.request_fingerprint=NEW.request_fingerprint AND o.status='PENDING'
      AND o.created_by=NEW.uploaded_by_id
  );
  SELECT RAISE(ABORT,'Google case evidence actor is invalid')
  WHERE NOT EXISTS (
    SELECT 1 FROM preview_users u
    WHERE u.id=NEW.uploaded_by_id AND u.is_active=1 AND u.display_name=NEW.uploaded_by_name
      AND (EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value='admin') OR EXISTS (SELECT 1 FROM preview_case_assignments a WHERE a.case_id=NEW.case_id AND a.user_id=NEW.uploaded_by_id))
  );
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_evidence_update_guard
BEFORE UPDATE ON preview_google_case_evidence
BEGIN
  SELECT RAISE(ABORT,'Google case evidence is append-only');
END;

CREATE TRIGGER IF NOT EXISTS preview_google_case_evidence_delete_guard
BEFORE DELETE ON preview_google_case_evidence
BEGIN
  SELECT RAISE(ABORT,'Google case evidence is append-only');
END;
