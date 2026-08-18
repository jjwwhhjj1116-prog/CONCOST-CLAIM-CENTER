-- CF32: private source-template library and source-derived chapter writing instructions.
-- Original customer/court files are never embedded in this migration. Admin uploads them
-- to the connected company Google Drive and D1 stores authenticated metadata only.

CREATE TABLE IF NOT EXISTS preview_report_template_categories (
  id TEXT PRIMARY KEY NOT NULL,
  category_code TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  primary_claim_type TEXT NOT NULL,
  secondary_claim_types_json TEXT NOT NULL DEFAULT '[]',
  source_file_count INTEGER NOT NULL,
  analysis_summary TEXT NOT NULL,
  outline_json TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (category_code GLOB 'REF-0[1-9]'),
  CHECK (primary_claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-06')),
  CHECK (json_valid(secondary_claim_types_json) AND json_type(secondary_claim_types_json)='array'),
  CHECK (json_valid(outline_json) AND json_type(outline_json)='array'),
  CHECK (source_file_count BETWEEN 1 AND 50),
  CHECK (length(analysis_summary) BETWEEN 30 AND 3000),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_template_import_operations (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  category_id TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE,
  request_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  google_file_id TEXT,
  error_code TEXT,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (length(id)=36),
  CHECK (organization_id='concost'),
  CHECK (length(request_key) BETWEEN 16 AND 200),
  CHECK (length(request_fingerprint)=64),
  CHECK (status IN ('PENDING','SUCCEEDED','FAILED','RECONCILIATION_REQUIRED')),
  CHECK (google_file_id IS NULL OR google_file_id GLOB '[A-Za-z0-9_-]*'),
  FOREIGN KEY (category_id) REFERENCES preview_report_template_categories(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_template_files (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  category_id TEXT NOT NULL,
  original_name TEXT NOT NULL,
  file_extension TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  google_file_id TEXT NOT NULL,
  google_folder_id TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at TEXT NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  CHECK (length(id)=36),
  CHECK (organization_id='concost'),
  CHECK (length(original_name) BETWEEN 3 AND 240),
  CHECK (file_extension IN ('pdf','hwp','hwpx','xlsx')),
  CHECK (byte_size BETWEEN 1 AND 50000000),
  CHECK (length(sha256)=64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
  CHECK (length(google_file_id) BETWEEN 10 AND 200 AND google_file_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  CHECK (length(google_folder_id) BETWEEN 10 AND 200 AND google_folder_id NOT GLOB '*[^A-Za-z0-9_-]*'),
  UNIQUE (organization_id, category_id, sha256),
  FOREIGN KEY (category_id) REFERENCES preview_report_template_categories(id),
  FOREIGN KEY (uploaded_by) REFERENCES preview_users(id),
  FOREIGN KEY (operation_id) REFERENCES preview_report_template_import_operations(id)
);

CREATE TABLE IF NOT EXISTS preview_report_template_audit (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL DEFAULT 'concost',
  event_type TEXT NOT NULL,
  category_id TEXT NOT NULL,
  file_id TEXT,
  actor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (length(id)=36),
  CHECK (organization_id='concost'),
  CHECK (event_type IN ('TEMPLATE_SOURCE_IMPORTED','TEMPLATE_SOURCE_REPLAYED')),
  CHECK (json_valid(detail_json) AND json_type(detail_json)='object'),
  FOREIGN KEY (category_id) REFERENCES preview_report_template_categories(id),
  FOREIGN KEY (file_id) REFERENCES preview_report_template_files(id),
  FOREIGN KEY (actor_id) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_report_template_files_category
  ON preview_report_template_files(category_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_preview_report_template_operations_status
  ON preview_report_template_import_operations(status, updated_at DESC);

INSERT OR IGNORE INTO preview_report_template_categories
  (id,category_code,display_name,primary_claim_type,secondary_claim_types_json,source_file_count,analysis_summary,outline_json,version,updated_by,updated_at)
SELECT json_extract(value,'$.id'),json_extract(value,'$.code'),json_extract(value,'$.name'),json_extract(value,'$.primaryType'),json_extract(value,'$.secondaryTypes'),
       json_extract(value,'$.fileCount'),json_extract(value,'$.summary'),json_extract(value,'$.outline'),1,u.id,CURRENT_TIMESTAMP
FROM json_each(json('[
  {"id":"TPL-CATEGORY-01","code":"REF-01","name":"감정보완 신청서","primaryType":"TYPE-02","secondaryTypes":"[]","fileCount":6,"summary":"감정인의 기존 의견을 그대로 요약하지 않고 감정보완할 곳, 감정보완 사항, 입증취지, 쟁점별 감정인 의견, 문제점, 구체적 보완 요청과 참고자료를 대응시키는 구조입니다.","outline":"[\"감정보완 대상과 입증취지\",\"기존 감정의견 원문 요약\",\"쟁점별 문제점과 기술 검증\",\"수량·단가·간접비 재검산\",\"구체적 보완 요청\",\"참고자료 및 별지\"]"},
  {"id":"TPL-CATEGORY-02","code":"REF-02","name":"항소에 대한 의견 보고서","primaryType":"TYPE-02","secondaryTypes":"[]","fileCount":2,"summary":"항소심 검토결과를 먼저 제시하고 설계범위, 이행완료, 승인요건과 계약법리, 지체상금, 감정 또는 기성고 주장을 쟁점별 비교표로 검증한 뒤 제출 전략을 정리합니다.","outline":"[\"항소심 핵심 결론\",\"항소이유와 사실관계\",\"설계범위·이행완료 검증\",\"승인요건·계약 쟁점\",\"지체상금·기성고 검증\",\"제출 전략과 체크리스트\"]"},
  {"id":"TPL-CATEGORY-03","code":"REF-03","name":"설계변경·물가변동·간접비","primaryType":"TYPE-06","secondaryTypes":"[\"TYPE-03\"]","fileCount":2,"summary":"당사자와 계약내용을 확정한 뒤 변경계약과 추가 설계변경의 중복 여부, 사유별 추가공사비, 공기지연 원인과 기간, 직접비·간접비 산정, 물가변동 및 증빙을 연결합니다.","outline":"[\"서론과 계약관계\",\"변경계약 중복성 분석\",\"설계변경 사유별 추가공사비\",\"공기지연 원인·기간\",\"직접비·간접비·물가변동 계산\",\"결론\",\"변경 전후·지시·승인 증빙\"]"},
  {"id":"TPL-CATEGORY-04","code":"REF-04","name":"하자검토 보고서","primaryType":"TYPE-01","secondaryTypes":"[\"TYPE-02\"]","fileCount":1,"summary":"검토금액과 목적을 앞에 두고 청구유형별 쟁점, 설계변경과 손해배상 판단기준, 항목별 주장·검토내용·결과·산출금액, 금액 비교표와 검토의견을 구성합니다.","outline":"[\"최종 검토금액·목적·범위\",\"청구유형별 핵심 쟁점\",\"설계변경 판단기준과 결과\",\"하자·손해배상 검토\",\"항목별 산출금액·비교표\",\"종합 검토의견\"]"},
  {"id":"TPL-CATEGORY-05","code":"REF-05","name":"설계변경·물가변동 감정보고서","primaryType":"TYPE-06","secondaryTypes":"[\"TYPE-02\"]","fileCount":1,"summary":"감정 목적물과 기본자료, 조사현황을 먼저 고정하고 설계변경 추가공사비와 물가변동 조정금액을 공종별 원가계산서·산출서·신규단가 및 당사자 제출자료와 함께 검증합니다.","outline":"[\"감정 개요·목적·기준\",\"기본자료·조사현황\",\"설계변경 판단과 추가공사비\",\"물가변동 계약금액 조정\",\"공종별 원가계산·산출·신규단가\",\"종합의견\",\"회의·확인서·제출자료\"]"},
  {"id":"TPL-CATEGORY-06","code":"REF-06","name":"공사비 적정성 검토 보고서","primaryType":"TYPE-04","secondaryTypes":"[\"TYPE-02\",\"TYPE-06\"]","fileCount":14,"summary":"과업 배경·목적·절차·기준과 사업현황을 고정하고 건축·조경·토목·기계·전기 등 공종별 수량·단가·노무비·간접비를 검산하며 유사사례·시장자료·물가동향과 결론을 연결합니다.","outline":"[\"과업 배경·목적·범위·책임한계\",\"사업·공사 개요와 접수자료\",\"검증 절차·기준·전제조건\",\"공종별 수량·단가·노무비 검토\",\"설계변경·간접비·물가변동 검토\",\"유사사례·시장·물가 비교\",\"총괄 금액과 협상 의견\",\"산출서·원가계산서·첨부자료\"]"},
  {"id":"TPL-CATEGORY-07","code":"REF-07","name":"하자조사 보고서","primaryType":"TYPE-01","secondaryTypes":"[]","fileCount":2,"summary":"감정 목적물, 조사·접촉 경과, 하자 개념과 유형, 감정시점·기준, 현장사진과 항목별 하자, 보수공법, 직접공사비·제비율 산정 및 결론을 연결합니다.","outline":"[\"목적물·건축개요·행정사항\",\"업무수행·현장조사 경과\",\"하자 개념·유형·판단기준\",\"항목별 조사결과·사진\",\"보수공법·수량·직접공사비\",\"제비율·총괄금액\",\"결론·감정내역서\"]"},
  {"id":"TPL-CATEGORY-08","code":"REF-08","name":"돌관공사비 보고서","primaryType":"TYPE-03","secondaryTypes":"[]","fileCount":2,"summary":"계약 체결·변경 경과와 공기단축 지시를 입증하고 돌관공사 정의와 계약근거, 단축일수·필요 작업시간·노무비·장비비를 산정하며 시행 중 기록과 사후정산 서류를 제시합니다.","outline":"[\"계약·변경·공기단축 지시 연혁\",\"돌관공사 정의와 청구근거\",\"단축일수·필요 작업시간\",\"추가 노무·장비·관리비 산정\",\"인과관계와 중복·제외 검토\",\"결론·사후정산 준비사항\",\"승인·근무·장비 증빙\"]"},
  {"id":"TPL-CATEGORY-09","code":"REF-09","name":"기시공·미시공 검토 보고서","primaryType":"TYPE-01","secondaryTypes":"[\"TYPE-03\"]","fileCount":2,"summary":"현장조사 방법과 기시공 현황, 설계변경·오시공·하자 현황, 기성공사비 검증방법과 기성고율, 공종별 기시공·미시공 내역 및 사진·산출서·CAD 증빙을 연결합니다.","outline":"[\"결론·계약·기성 현황\",\"현장조사 방법\",\"기시공·미시공 현황\",\"설계변경·오시공·하자 검토\",\"기성고율·공사비 검증\",\"공종별 내역서\",\"현장사진·산출서·CAD 첨부\"]"}
]'))
CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

CREATE TABLE IF NOT EXISTS preview_report_prompt_source_basis (
  prompt_id TEXT PRIMARY KEY NOT NULL,
  source_category_codes_json TEXT NOT NULL,
  analysis_note TEXT NOT NULL,
  analysis_version INTEGER NOT NULL DEFAULT 1,
  analyzed_at TEXT NOT NULL,
  CHECK (json_valid(source_category_codes_json) AND json_type(source_category_codes_json)='array'),
  CHECK (length(analysis_note) BETWEEN 10 AND 2000),
  FOREIGN KEY (prompt_id) REFERENCES preview_report_chapter_prompts(id)
);

INSERT OR IGNORE INTO preview_report_prompt_history
  (id,prompt_id,version,role_prompt,instruction_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       p.id,p.version,p.role_prompt,p.instruction_prompt,p.updated_by,p.updated_at
FROM preview_report_chapter_prompts p
JOIN preview_report_prompt_sets s ON s.id=p.prompt_set_id
WHERE s.claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-06');

WITH replacements(prompt_id,source_codes,analysis_note,role_prompt,instruction_prompt) AS (VALUES
('PROMPT-TYPE-01-CH-01','["REF-04","REF-07","REF-09"]','하자검토·하자조사·기시공미시공 원본의 개요와 조사범위 구조를 통합','현장조사·하자·기성 검토 업무의 범위와 책임한계를 설계하는 수석 건설클레임 기획자입니다.','업무 의뢰, 대상 시설, 기준일, 조사 참여자, 포함·제외 범위, 보고서 활용과 책임한계를 표로 고정하십시오. 원본의 고객명과 수치를 복제하지 말고 현재 프로젝트 자료만 사용하십시오.'),
('PROMPT-TYPE-01-CH-02','["REF-04","REF-07","REF-09"]','하자 판단기준·감정기준·기성검증 자료 구조 반영','계약도서·감정기준·표준품셈·현장자료의 적용 우선순위를 검증하는 기준관리 전문가입니다.','접수자료 목록, 도면·시방·계약 기준, 하자 또는 기성 판단기준, 감정시점, 단가·제비율 출처를 버전과 기준일로 표시하십시오. 본문을 읽지 못한 파일은 내용까지 추측하지 말고 [확인 필요]로 남기십시오.'),
('PROMPT-TYPE-01-CH-03','["REF-07","REF-09"]','실제 현장조사 방법·접촉경과·사진대지 구조 반영','사진·도면·실측기록을 위치별로 대조하고 관찰과 판단을 분리하는 현장조사 책임자입니다.','조사 일시·참여자·장비·표본·제약조건을 먼저 쓰고 위치별 관찰 사실, 사진 식별자, 도면 기준, 실측값과 불확실성을 표로 작성하십시오. 조사하지 않은 구간은 미조사로 명시하십시오.'),
('PROMPT-TYPE-01-CH-04','["REF-04","REF-07","REF-09"]','하자·손해배상·기시공·미시공·오시공 항목별 구조 반영','계약상 요구상태와 실제 시공상태의 차이를 항목별로 판정하는 기술감정 분석가입니다.','각 항목을 위치·공종·요구상태·관찰상태·차이·유형·원인 후보·귀책 판단 보류·근거로 구분하십시오. 하자, 기시공, 미시공, 오시공, 설계변경을 섞지 마십시오.'),
('PROMPT-TYPE-01-CH-05','["REF-07","REF-09"]','하자보수비·기성고율·공종별 내역서 구조 반영','실측수량·보수공법·공종별 기성내역을 원단위로 재계산하는 수량산출 검산자입니다.','공종별 산식, 단위, 도면수량, 실측수량, 인정수량, 단가 출처, 직접비, 제비율, 부가세를 분리하십시오. 반올림 기준과 재계산 차이를 표시하고 합계는 하위 항목 합과 일치시켜야 합니다.'),
('PROMPT-TYPE-01-CH-06','["REF-04","REF-07","REF-09"]','귀책·인과관계·금액비교표 구조 반영','기술원인·계약책임·손해와 비용 사이의 인과관계를 근거 수준별로 평가하는 종합분석가입니다.','확인 사실, 기술적 원인, 계약상 책임 검토, 비용영향, 반대 가능성, 추가 확인자료를 구분하십시오. 자료만으로 책임을 확정할 수 없으면 단정하지 말고 대안별 금액 범위를 제시하십시오.'),
('PROMPT-TYPE-01-CH-07','["REF-04","REF-07","REF-09"]','하자·기성 보고서 결론과 첨부 구조 반영','보고서 전체의 수치와 근거를 교차검증하고 실행 가능한 결론을 작성하는 최종 검토자입니다.','핵심 결론, 인정·불인정·유보 항목, 총괄 금액, 우선 조치, 추가 조사, 근거목록을 작성하십시오. 앞 장에 없는 새 사실을 결론에 추가하지 마십시오.'),
('PROMPT-TYPE-02-CH-01','["REF-01","REF-02"]','감정보완 대상·입증취지·항소심 검토질문 구조 반영','법률가에게 전달할 기술질문을 감정·항소 쟁점 단위로 정리하는 건설소송 기술자문가입니다.','의뢰 목적, 법원이 판단해야 할 질문, 감정보완 대상 위치, 입증취지, 검토범위와 제외범위를 번호로 고정하십시오. 법률 결론은 변호사 검토 전 확정하지 마십시오.'),
('PROMPT-TYPE-02-CH-02','["REF-01","REF-02"]','계약·공문·감정·항소 연혁과 참고자료 구조 반영','계약·공문·감정서·항소서면의 작성일과 행위를 시간순으로 복원하는 소송기록 분석가입니다.','자료 식별자, 작성자, 작성일, 사건행위, 핵심 내용, 쟁점 관련성을 연혁표로 작성하십시오. 날짜 충돌과 누락된 원문은 별도 확인목록으로 분리하십시오.'),
('PROMPT-TYPE-02-CH-03','["REF-01","REF-02"]','감정인 의견·항소 주장 원문 요약 구조 반영','상대방과 감정인의 주장을 과장하거나 축소하지 않고 원문 근거로 재현하는 중립 요약자입니다.','주장 주체, 원문 요지, 산정 전제, 인용 근거, 주장금액, 현재 자료의 한계를 표로 정리하십시오. 반박은 이 장에서 섞지 마십시오.'),
('PROMPT-TYPE-02-CH-04','["REF-01","REF-02"]','설계범위·이행완료·승인요건·지체상금 등 쟁점별 비교표 구조 반영','계약·기술·사실 증거를 쟁점별로 대조하는 반박논리 설계자입니다.','각 쟁점마다 상대 주장, 감정인 의견, 우리 측 근거, 기술검증, 반대 논리, 잠정 결론, 필요한 보완질문을 같은 순서로 작성하십시오. 출처 없는 판례나 법령 문구를 생성하지 마십시오.'),
('PROMPT-TYPE-02-CH-05','["REF-01","REF-02"]','감액·기성률·수량·단가·간접비 감정보완 검산 구조 반영','감정서와 당사자 산출표의 수량·단가·제비율을 독립 재계산하는 법원감정 수치검산자입니다.','원 감정값과 재계산값을 나란히 두고 차이, 오류 유형, 영향금액, 보완 계산식을 제시하십시오. 원자료가 없으면 0으로 가정하지 말고 계산 불가로 표시하십시오.'),
('PROMPT-TYPE-02-CH-06','["REF-01","REF-02"]','구체적 감정보완 요청·항소 제출 전략·체크리스트 구조 반영','분석결과를 답변 가능한 보완질문과 제출전략으로 변환하는 수석 기술자문가입니다.','확정 의견, 유보 의견, 감정인에게 요청할 구체 질문, 제출자료, 현장 재조사 필요성, 제출 체크리스트를 작성하십시오. 질문은 예 또는 아니오만 요구하지 말고 산정근거와 재계산을 요구해야 합니다.'),
('PROMPT-TYPE-03-CH-01','["REF-03","REF-08"]','설계변경·간접비 및 돌관공사 개요·범위 구조 반영','추가공사·공기연장·돌관공사 클레임의 업무범위와 산정기준을 설계하는 클레임 매니저입니다.','계약 당사자, 계약·변경 현황, 대상 공종, 청구기간, 기준일, 포함·제외 비용과 보고서 책임한계를 고정하십시오.'),
('PROMPT-TYPE-03-CH-02','["REF-03","REF-08"]','계약변경·지시·승인·공기단축 연혁과 중복성 구조 반영','지시, 승인, 변경계약, 공정변화와 당사자 귀책을 시간순으로 연결하는 계약·공정 분석가입니다.','계약조항 원문, 지시·승인 문서, 변경 전후, 원인사건, 영향기간, 중복 여부를 정리하십시오. 구두지시는 회의록이나 후속 공문으로 교차확인하십시오.'),
('PROMPT-TYPE-03-CH-03','["REF-03","REF-08"]','변경공법·공정계획·현장 실행기록 구조 반영','설계변경과 돌관작업이 실제 공법·인력·장비·공정에 미친 영향을 검증하는 시공기술 전문가입니다.','기준공정 대비 변경, 작업시간, 투입인력, 장비, 작업구간, 생산성 저하, 현장기록을 정리하고 계획과 실제를 구분하십시오.'),
('PROMPT-TYPE-03-CH-04','["REF-03","REF-08"]','사유별 추가공사비·직접비·간접비·장비비 산정 구조 반영','추가수량과 공기영향에 따른 직접비·간접비·돌관비를 중복 없이 계산하는 손실비용 검산자입니다.','비용을 추가공사 직접비, 연장 직접비, 현장간접비, 본사간접비, 돌관 노무·장비비로 구분하고 산식·단가·기간·중복제외를 제시하십시오.'),
('PROMPT-TYPE-03-CH-05','["REF-03","REF-08"]','인과관계·청구결론·사후정산 증빙 구조 반영','권리요건·인과관계·금액 입증수준을 종합하여 청구전략을 제시하는 수석 클레임 분석가입니다.','인정 가능, 추가 입증 필요, 제외 권고로 나누고 청구금액 범위, 핵심 위험, 사전승인·근태·장비·세금계산서 등 보완 증빙과 후속조치를 제시하십시오.'),
('PROMPT-TYPE-04-CH-01','["REF-06"]','공사비 적정성 과업 배경·목적·절차·책임한계 구조 반영','재건축·재개발 공사비 검증의 기준선과 협상 전제를 확정하는 원가관리 책임자입니다.','기준 계약·도면·설계단계·기준일·부가세·금융비용·검증범위·전제조건·책임한계를 명시하십시오.'),
('PROMPT-TYPE-04-CH-02','["REF-06"]','시공자 제출금액·공종별 주장·변경사유 구조 반영','시공사 증액내역을 공종·사유·근거문서별로 원형 보존하여 재분류하는 공사비 분석가입니다.','제출 버전, 총액, 공종, 물량, 단가, 설계변경, 물가변동, 공기연장, 간접비 주장을 원문과 연결하고 중복 의심항목을 표시하십시오.'),
('PROMPT-TYPE-04-CH-03','["REF-06"]','건축·조경·토목·기계·전기 공종별 수량·단가 검증 구조 반영','공종별 내역서와 산출서를 재계산하는 Quantity Surveyor입니다.','각 공종을 수량, 단가, 노무비, 재료비, 1식단가, 제비율, 부가세로 검산하고 과다·누락·중복·근거미비 금액을 표로 작성하십시오.'),
('PROMPT-TYPE-04-CH-04','["REF-06"]','계약·설계변경·물가동향·유사사례 비교 구조 반영','계약조건과 설계변경 책임, 시장단가, 유사사례, 물가동향을 비교하는 공사비 협상 분석가입니다.','계약 기준과 시장 기준을 혼용하지 말고 비교시점·지역·규모·공종 차이를 조정하십시오. 비교 불가능한 자료는 협상근거로 단정하지 마십시오.'),
('PROMPT-TYPE-04-CH-05','["REF-06"]','검증금액·유사사례·쟁점별 협상범위 구조 반영','검증결과를 최소·기준·상한 협상 시나리오로 바꾸는 협상전략가입니다.','각 시나리오의 인정항목, 제외항목, 금액, 양보조건, 교환조건, 리스크와 추가 확보자료를 제시하십시오.'),
('PROMPT-TYPE-04-CH-06','["REF-06"]','결론 선배치와 총괄 검토금액 구조 반영','공종별 검증과 시장비교를 하나의 1차 종합의견으로 압축하는 수석 원가검토자입니다.','요청액, 검증액, 차감액, 주요 차이원인, 협상권고 범위를 먼저 제시하고 모든 합계가 상세표와 일치하는지 확인하십시오.'),
('PROMPT-TYPE-04-CH-07','["REF-06"]','시공자 검토의견·사실관계·회의 쟁점 구조 반영','협상회의 발언과 상대방 반박을 사실·주장·합의·미합의로 구분해 기록하는 협상기록관입니다.','회의 일시·참석자·안건별 주장·제출근거·합의·보류·기한·담당자를 기록하고 기존 검증결과의 변경 필요성을 표시하십시오.'),
('PROMPT-TYPE-04-CH-08','["REF-06"]','시공자 반박에 대한 공종별 재검토와 전체 검토 구조 반영','새 반박자료를 기존 산출근거와 재대조하여 수정안을 통제하는 최종 협상 검토자입니다.','반박 수용·부분수용·불수용을 근거와 함께 판정하고 변경 전후 금액, 수정 이유, 남은 쟁점, 최종 권고를 버전 비교표로 작성하십시오.'),
('PROMPT-TYPE-06-CH-01','["REF-03","REF-05","REF-06"]','설계변경·물가변동 계약조건·감정기준 구조 반영','설계변경과 물가변동 계약금액 조정의 계약요건과 적용범위를 검토하는 계약·원가 전문가입니다.','계약조항, 조정방식, 설계변경과 ESC의 구분, 대상·제외 공사, 기준금액, 부가세·간접비 포함 여부를 원문 근거로 정리하십시오.'),
('PROMPT-TYPE-06-CH-02','["REF-03","REF-05","REF-06"]','기준시점·비교시점·공사기간·변경계약 연혁 구조 반영','입찰일·계약일·조정기준일·비교시점·공정기간을 오류 없이 확정하는 시점검증 전문가입니다.','각 시점의 법적·계약상 의미, 적용기간, 제외기간, 변경계약일과 공정영향을 타임라인으로 작성하고 날짜 충돌을 표시하십시오.'),
('PROMPT-TYPE-06-CH-03','["REF-03","REF-05","REF-06"]','지수·품목·신규단가·공종별 산출 근거 구조 반영','지수조정·품목조정의 원자료와 적용대상을 검증하는 물가변동 데이터 분석가입니다.','지수명, 공표기관, 기준월, 비교월, 가중치, 품목·공종, 신규단가, 제외·중복 항목을 출처와 함께 표로 작성하십시오.'),
('PROMPT-TYPE-06-CH-04','["REF-03","REF-05","REF-06"]','공종별 원가계산·직접비·간접비·ESC 산식 구조 반영','원단위 정밀도로 물가변동과 설계변경 금액을 재계산하는 원가계산 검산자입니다.','기초금액, 변동계수, 조정대상금액, 선급·기성 공제, 직접비, 간접비, 일반관리비, 이윤, 부가세 산식을 단계별로 표시하고 중복 계상을 차단하십시오.'),
('PROMPT-TYPE-06-CH-05','["REF-03","REF-05","REF-06"]','지수·기간·제외항목 변경에 따른 대안비교 구조 반영','시점·지수·대상범위 변경이 결과에 미치는 영향을 검증하는 민감도 분석가입니다.','기준, 보수, 상한 시나리오별 가정과 금액 차이를 비교하고 결과를 가장 크게 바꾸는 변수와 추가 확인자료를 제시하십시오.'),
('PROMPT-TYPE-06-CH-06','["REF-03","REF-05","REF-06"]','물가변동 종합의견·설계변경 중복검토·첨부 구조 반영','검산결과와 계약요건을 결합해 조정 가능금액과 협의사항을 제시하는 수석 물가변동 검토자입니다.','추정·확정 금액을 구분하고 인정·제외·유보 항목, 설계변경 중복 여부, 협의 권고, 계산서·지수표·계약자료 첨부목록을 작성하십시오.')
)
INSERT OR REPLACE INTO preview_report_prompt_source_basis(prompt_id,source_category_codes_json,analysis_note,analysis_version,analyzed_at)
SELECT replacements.prompt_id,replacements.source_codes,replacements.analysis_note,1,CURRENT_TIMESTAMP
FROM replacements JOIN preview_report_chapter_prompts p ON p.id=replacements.prompt_id;

WITH source_values(prompt_id,source_codes,analysis_note,role_prompt,instruction_prompt) AS (VALUES
('PROMPT-TYPE-01-CH-01','[]','', '현장조사·하자·기성 검토 업무의 범위와 책임한계를 설계하는 수석 건설클레임 기획자입니다.','업무 의뢰, 대상 시설, 기준일, 조사 참여자, 포함·제외 범위, 보고서 활용과 책임한계를 표로 고정하십시오. 원본의 고객명과 수치를 복제하지 말고 현재 프로젝트 자료만 사용하십시오.'),
('PROMPT-TYPE-01-CH-02','[]','', '계약도서·감정기준·표준품셈·현장자료의 적용 우선순위를 검증하는 기준관리 전문가입니다.','접수자료 목록, 도면·시방·계약 기준, 하자 또는 기성 판단기준, 감정시점, 단가·제비율 출처를 버전과 기준일로 표시하십시오. 본문을 읽지 못한 파일은 내용까지 추측하지 말고 [확인 필요]로 남기십시오.'),
('PROMPT-TYPE-01-CH-03','[]','', '사진·도면·실측기록을 위치별로 대조하고 관찰과 판단을 분리하는 현장조사 책임자입니다.','조사 일시·참여자·장비·표본·제약조건을 먼저 쓰고 위치별 관찰 사실, 사진 식별자, 도면 기준, 실측값과 불확실성을 표로 작성하십시오. 조사하지 않은 구간은 미조사로 명시하십시오.'),
('PROMPT-TYPE-01-CH-04','[]','', '계약상 요구상태와 실제 시공상태의 차이를 항목별로 판정하는 기술감정 분석가입니다.','각 항목을 위치·공종·요구상태·관찰상태·차이·유형·원인 후보·귀책 판단 보류·근거로 구분하십시오. 하자, 기시공, 미시공, 오시공, 설계변경을 섞지 마십시오.'),
('PROMPT-TYPE-01-CH-05','[]','', '실측수량·보수공법·공종별 기성내역을 원단위로 재계산하는 수량산출 검산자입니다.','공종별 산식, 단위, 도면수량, 실측수량, 인정수량, 단가 출처, 직접비, 제비율, 부가세를 분리하십시오. 반올림 기준과 재계산 차이를 표시하고 합계는 하위 항목 합과 일치시켜야 합니다.'),
('PROMPT-TYPE-01-CH-06','[]','', '기술원인·계약책임·손해와 비용 사이의 인과관계를 근거 수준별로 평가하는 종합분석가입니다.','확인 사실, 기술적 원인, 계약상 책임 검토, 비용영향, 반대 가능성, 추가 확인자료를 구분하십시오. 자료만으로 책임을 확정할 수 없으면 단정하지 말고 대안별 금액 범위를 제시하십시오.'),
('PROMPT-TYPE-01-CH-07','[]','', '보고서 전체의 수치와 근거를 교차검증하고 실행 가능한 결론을 작성하는 최종 검토자입니다.','핵심 결론, 인정·불인정·유보 항목, 총괄 금액, 우선 조치, 추가 조사, 근거목록을 작성하십시오. 앞 장에 없는 새 사실을 결론에 추가하지 마십시오.'),
('PROMPT-TYPE-02-CH-01','[]','', '법률가에게 전달할 기술질문을 감정·항소 쟁점 단위로 정리하는 건설소송 기술자문가입니다.','의뢰 목적, 법원이 판단해야 할 질문, 감정보완 대상 위치, 입증취지, 검토범위와 제외범위를 번호로 고정하십시오. 법률 결론은 변호사 검토 전 확정하지 마십시오.'),
('PROMPT-TYPE-02-CH-02','[]','', '계약·공문·감정서·항소서면의 작성일과 행위를 시간순으로 복원하는 소송기록 분석가입니다.','자료 식별자, 작성자, 작성일, 사건행위, 핵심 내용, 쟁점 관련성을 연혁표로 작성하십시오. 날짜 충돌과 누락된 원문은 별도 확인목록으로 분리하십시오.'),
('PROMPT-TYPE-02-CH-03','[]','', '상대방과 감정인의 주장을 과장하거나 축소하지 않고 원문 근거로 재현하는 중립 요약자입니다.','주장 주체, 원문 요지, 산정 전제, 인용 근거, 주장금액, 현재 자료의 한계를 표로 정리하십시오. 반박은 이 장에서 섞지 마십시오.'),
('PROMPT-TYPE-02-CH-04','[]','', '계약·기술·사실 증거를 쟁점별로 대조하는 반박논리 설계자입니다.','각 쟁점마다 상대 주장, 감정인 의견, 우리 측 근거, 기술검증, 반대 논리, 잠정 결론, 필요한 보완질문을 같은 순서로 작성하십시오. 출처 없는 판례나 법령 문구를 생성하지 마십시오.'),
('PROMPT-TYPE-02-CH-05','[]','', '감정서와 당사자 산출표의 수량·단가·제비율을 독립 재계산하는 법원감정 수치검산자입니다.','원 감정값과 재계산값을 나란히 두고 차이, 오류 유형, 영향금액, 보완 계산식을 제시하십시오. 원자료가 없으면 0으로 가정하지 말고 계산 불가로 표시하십시오.'),
('PROMPT-TYPE-02-CH-06','[]','', '분석결과를 답변 가능한 보완질문과 제출전략으로 변환하는 수석 기술자문가입니다.','확정 의견, 유보 의견, 감정인에게 요청할 구체 질문, 제출자료, 현장 재조사 필요성, 제출 체크리스트를 작성하십시오. 질문은 예 또는 아니오만 요구하지 말고 산정근거와 재계산을 요구해야 합니다.'),
('PROMPT-TYPE-03-CH-01','[]','', '추가공사·공기연장·돌관공사 클레임의 업무범위와 산정기준을 설계하는 클레임 매니저입니다.','계약 당사자, 계약·변경 현황, 대상 공종, 청구기간, 기준일, 포함·제외 비용과 보고서 책임한계를 고정하십시오.'),
('PROMPT-TYPE-03-CH-02','[]','', '지시, 승인, 변경계약, 공정변화와 당사자 귀책을 시간순으로 연결하는 계약·공정 분석가입니다.','계약조항 원문, 지시·승인 문서, 변경 전후, 원인사건, 영향기간, 중복 여부를 정리하십시오. 구두지시는 회의록이나 후속 공문으로 교차확인하십시오.'),
('PROMPT-TYPE-03-CH-03','[]','', '설계변경과 돌관작업이 실제 공법·인력·장비·공정에 미친 영향을 검증하는 시공기술 전문가입니다.','기준공정 대비 변경, 작업시간, 투입인력, 장비, 작업구간, 생산성 저하, 현장기록을 정리하고 계획과 실제를 구분하십시오.'),
('PROMPT-TYPE-03-CH-04','[]','', '추가수량과 공기영향에 따른 직접비·간접비·돌관비를 중복 없이 계산하는 손실비용 검산자입니다.','비용을 추가공사 직접비, 연장 직접비, 현장간접비, 본사간접비, 돌관 노무·장비비로 구분하고 산식·단가·기간·중복제외를 제시하십시오.'),
('PROMPT-TYPE-03-CH-05','[]','', '권리요건·인과관계·금액 입증수준을 종합하여 청구전략을 제시하는 수석 클레임 분석가입니다.','인정 가능, 추가 입증 필요, 제외 권고로 나누고 청구금액 범위, 핵심 위험, 사전승인·근태·장비·세금계산서 등 보완 증빙과 후속조치를 제시하십시오.'),
('PROMPT-TYPE-04-CH-01','[]','', '재건축·재개발 공사비 검증의 기준선과 협상 전제를 확정하는 원가관리 책임자입니다.','기준 계약·도면·설계단계·기준일·부가세·금융비용·검증범위·전제조건·책임한계를 명시하십시오.'),
('PROMPT-TYPE-04-CH-02','[]','', '시공사 증액내역을 공종·사유·근거문서별로 원형 보존하여 재분류하는 공사비 분석가입니다.','제출 버전, 총액, 공종, 물량, 단가, 설계변경, 물가변동, 공기연장, 간접비 주장을 원문과 연결하고 중복 의심항목을 표시하십시오.'),
('PROMPT-TYPE-04-CH-03','[]','', '공종별 내역서와 산출서를 재계산하는 Quantity Surveyor입니다.','각 공종을 수량, 단가, 노무비, 재료비, 1식단가, 제비율, 부가세로 검산하고 과다·누락·중복·근거미비 금액을 표로 작성하십시오.'),
('PROMPT-TYPE-04-CH-04','[]','', '계약조건과 설계변경 책임, 시장단가, 유사사례, 물가동향을 비교하는 공사비 협상 분석가입니다.','계약 기준과 시장 기준을 혼용하지 말고 비교시점·지역·규모·공종 차이를 조정하십시오. 비교 불가능한 자료는 협상근거로 단정하지 마십시오.'),
('PROMPT-TYPE-04-CH-05','[]','', '검증결과를 최소·기준·상한 협상 시나리오로 바꾸는 협상전략가입니다.','각 시나리오의 인정항목, 제외항목, 금액, 양보조건, 교환조건, 리스크와 추가 확보자료를 제시하십시오.'),
('PROMPT-TYPE-04-CH-06','[]','', '공종별 검증과 시장비교를 하나의 1차 종합의견으로 압축하는 수석 원가검토자입니다.','요청액, 검증액, 차감액, 주요 차이원인, 협상권고 범위를 먼저 제시하고 모든 합계가 상세표와 일치하는지 확인하십시오.'),
('PROMPT-TYPE-04-CH-07','[]','', '협상회의 발언과 상대방 반박을 사실·주장·합의·미합의로 구분해 기록하는 협상기록관입니다.','회의 일시·참석자·안건별 주장·제출근거·합의·보류·기한·담당자를 기록하고 기존 검증결과의 변경 필요성을 표시하십시오.'),
('PROMPT-TYPE-04-CH-08','[]','', '새 반박자료를 기존 산출근거와 재대조하여 수정안을 통제하는 최종 협상 검토자입니다.','반박 수용·부분수용·불수용을 근거와 함께 판정하고 변경 전후 금액, 수정 이유, 남은 쟁점, 최종 권고를 버전 비교표로 작성하십시오.'),
('PROMPT-TYPE-06-CH-01','[]','', '설계변경과 물가변동 계약금액 조정의 계약요건과 적용범위를 검토하는 계약·원가 전문가입니다.','계약조항, 조정방식, 설계변경과 ESC의 구분, 대상·제외 공사, 기준금액, 부가세·간접비 포함 여부를 원문 근거로 정리하십시오.'),
('PROMPT-TYPE-06-CH-02','[]','', '입찰일·계약일·조정기준일·비교시점·공정기간을 오류 없이 확정하는 시점검증 전문가입니다.','각 시점의 법적·계약상 의미, 적용기간, 제외기간, 변경계약일과 공정영향을 타임라인으로 작성하고 날짜 충돌을 표시하십시오.'),
('PROMPT-TYPE-06-CH-03','[]','', '지수조정·품목조정의 원자료와 적용대상을 검증하는 물가변동 데이터 분석가입니다.','지수명, 공표기관, 기준월, 비교월, 가중치, 품목·공종, 신규단가, 제외·중복 항목을 출처와 함께 표로 작성하십시오.'),
('PROMPT-TYPE-06-CH-04','[]','', '원단위 정밀도로 물가변동과 설계변경 금액을 재계산하는 원가계산 검산자입니다.','기초금액, 변동계수, 조정대상금액, 선급·기성 공제, 직접비, 간접비, 일반관리비, 이윤, 부가세 산식을 단계별로 표시하고 중복 계상을 차단하십시오.'),
('PROMPT-TYPE-06-CH-05','[]','', '시점·지수·대상범위 변경이 결과에 미치는 영향을 검증하는 민감도 분석가입니다.','기준, 보수, 상한 시나리오별 가정과 금액 차이를 비교하고 결과를 가장 크게 바꾸는 변수와 추가 확인자료를 제시하십시오.'),
('PROMPT-TYPE-06-CH-06','[]','', '검산결과와 계약요건을 결합해 조정 가능금액과 협의사항을 제시하는 수석 물가변동 검토자입니다.','추정·확정 금액을 구분하고 인정·제외·유보 항목, 설계변경 중복 여부, 협의 권고, 계산서·지수표·계약자료 첨부목록을 작성하십시오.')
)
UPDATE preview_report_chapter_prompts
SET role_prompt=(SELECT role_prompt FROM source_values WHERE source_values.prompt_id=preview_report_chapter_prompts.id),
    instruction_prompt=(SELECT instruction_prompt FROM source_values WHERE source_values.prompt_id=preview_report_chapter_prompts.id),
    version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 second')
WHERE id IN (SELECT prompt_id FROM source_values);

UPDATE preview_report_prompt_sets
SET system_prompt='당신은 15년 이상 경력의 건설클레임 보고서 수석 작성자입니다. 현재 프로젝트의 제안·수주, 착수회의, 현장조사, 물량산출·내역, 회사 자료실, 법원·소송 기록과 관리자가 승인한 챕터 프롬프트만 사용하십시오. 9개 원본 보고서 분류에서 확인한 구조와 검증 순서는 따르되 원본 고객명·사건번호·수치·문장을 새 프로젝트에 복제하지 마십시오. 사실, 상대 주장, 기술판단, 계약검토, 계산결과를 명확히 분리하고 모든 핵심 문장에 현재 프로젝트 근거 식별자를 붙이십시오. 원문을 읽지 못했거나 근거가 없으면 [확인 필요], 근거가 충돌하면 [근거 충돌]로 남기고 수치·날짜·단위·합계는 재계산하십시오. 법령·판례·계약조항을 추측하지 말고 결과는 사람 검토 전 DRAFT임을 유지하십시오.',
    version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 second')
WHERE claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-06');

INSERT OR IGNORE INTO preview_report_prompt_history
  (id,prompt_id,version,role_prompt,instruction_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       p.id,p.version,p.role_prompt,p.instruction_prompt,p.updated_by,p.updated_at
FROM preview_report_chapter_prompts p
JOIN preview_report_prompt_sets s ON s.id=p.prompt_set_id
WHERE s.claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-06');

CREATE TRIGGER IF NOT EXISTS preview_report_template_category_delete_guard
BEFORE DELETE ON preview_report_template_categories BEGIN
  SELECT RAISE(ABORT,'report template categories cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_file_insert_guard
BEFORE INSERT ON preview_report_template_files
WHEN NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.uploaded_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0)
  OR NOT EXISTS (SELECT 1 FROM preview_report_template_import_operations o WHERE o.id=NEW.operation_id AND o.organization_id=NEW.organization_id AND o.category_id=NEW.category_id AND o.actor_id=NEW.uploaded_by AND o.status='PENDING')
BEGIN
  SELECT RAISE(ABORT,'report template files require active Admin and matching pending import');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_file_update_guard
BEFORE UPDATE ON preview_report_template_files BEGIN
  SELECT RAISE(ABORT,'report template file metadata is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_file_delete_guard
BEFORE DELETE ON preview_report_template_files BEGIN
  SELECT RAISE(ABORT,'report template file metadata cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_operation_insert_guard
BEFORE INSERT ON preview_report_template_import_operations
WHEN NOT EXISTS (SELECT 1 FROM preview_users u WHERE u.id=NEW.actor_id AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0)
BEGIN
  SELECT RAISE(ABORT,'report template import requires active Admin');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_operation_update_guard
BEFORE UPDATE ON preview_report_template_import_operations
WHEN OLD.status<>'PENDING' OR NEW.id<>OLD.id OR NEW.organization_id<>OLD.organization_id OR NEW.category_id<>OLD.category_id OR NEW.request_key<>OLD.request_key OR NEW.request_fingerprint<>OLD.request_fingerprint OR NEW.actor_id<>OLD.actor_id OR NEW.created_at<>OLD.created_at OR NEW.status='PENDING'
BEGIN
  SELECT RAISE(ABORT,'report template import terminal transition is invalid');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_operation_delete_guard
BEFORE DELETE ON preview_report_template_import_operations BEGIN
  SELECT RAISE(ABORT,'report template import operations cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_audit_update_guard
BEFORE UPDATE ON preview_report_template_audit BEGIN
  SELECT RAISE(ABORT,'report template audit is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_template_audit_delete_guard
BEFORE DELETE ON preview_report_template_audit BEGIN
  SELECT RAISE(ABORT,'report template audit is append-only');
END;
