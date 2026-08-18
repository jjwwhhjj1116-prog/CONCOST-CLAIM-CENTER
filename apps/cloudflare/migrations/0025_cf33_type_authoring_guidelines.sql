-- CF33: Admin-versioned two-stage report-type guidelines imported from the
-- user-approved TYPE_01..TYPE_06 authoring specifications.

ALTER TABLE preview_report_chapter_prompts
  ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'
  CHECK (status IN ('ACTIVE','ARCHIVED'));

CREATE TABLE IF NOT EXISTS preview_report_type_guidelines (
  organization_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  type_name TEXT NOT NULL,
  target_work TEXT NOT NULL,
  toc_blueprint TEXT NOT NULL,
  stage1_prompt TEXT NOT NULL,
  stage2_prompt TEXT NOT NULL,
  source_file_name TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, claim_type),
  CHECK (organization_id = 'concost'),
  CHECK (claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06')),
  CHECK (length(type_name) BETWEEN 1 AND 200),
  CHECK (length(target_work) BETWEEN 10 AND 3000),
  CHECK (length(toc_blueprint) BETWEEN 20 AND 30000),
  CHECK (length(stage1_prompt) BETWEEN 50 AND 20000),
  CHECK (length(stage2_prompt) BETWEEN 50 AND 30000),
  CHECK (source_file_name GLOB 'TYPE_0[1-6]_*.md'),
  CHECK (length(source_sha256) = 64 AND lower(source_sha256) NOT GLOB '*[^0-9a-f]*'),
  CHECK (status IN ('ACTIVE','ARCHIVED')),
  CHECK (version >= 1),
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE TABLE IF NOT EXISTS preview_report_type_guideline_history (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL,
  claim_type TEXT NOT NULL,
  version INTEGER NOT NULL,
  target_work TEXT NOT NULL,
  toc_blueprint TEXT NOT NULL,
  stage1_prompt TEXT NOT NULL,
  stage2_prompt TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  CHECK (length(id) = 36),
  CHECK (version >= 1),
  UNIQUE (organization_id, claim_type, version),
  FOREIGN KEY (organization_id, claim_type) REFERENCES preview_report_type_guidelines(organization_id, claim_type),
  FOREIGN KEY (changed_by) REFERENCES preview_users(id)
);

INSERT OR IGNORE INTO preview_report_type_guidelines
  (organization_id,claim_type,type_name,target_work,toc_blueprint,stage1_prompt,stage2_prompt,source_file_name,source_sha256,status,version,updated_by,updated_at)
SELECT 'concost',json_extract(g.value,'$.claimType'),json_extract(g.value,'$.typeName'),json_extract(g.value,'$.targetWork'),
       json_extract(g.value,'$.toc'),json_extract(g.value,'$.stage1'),json_extract(g.value,'$.stage2'),json_extract(g.value,'$.sourceFile'),
       lower(json_extract(g.value,'$.sha256')),'ACTIVE',1,u.id,CURRENT_TIMESTAMP
FROM json_each(json('[
 {"claimType":"TYPE-01","typeName":"현장조사 및 수량산출 클레임","targetWork":"하자 판정·보수비 검토, 기시공·미시공 비교, 계약타절 기성고 산정, 시공품질 분쟁","sourceFile":"TYPE_01_FIELD_SURVEY_QUANTITY.md","sha256":"4FE91898163A1371099A6A21AC49BD8B1180E2C427FDD44D27C46516F848A82C","toc":"Ⅰ. 결론\n  1. 검토 결과 요약\n  2. 기시공·하자보수비 총괄 비교표\n  3. 주요 쟁점별 검토의견\nⅡ. 개요\n  1. 용역 목적\n  2. 공사 개요\n  3. 접수 자료\n  4. 검토 기준과 방법\nⅢ. 현장조사 및 기시공·하자 현황\nⅣ. 설계변경·오시공·하자 쟁점별 세부 분석\nⅤ. 기성공사비·하자보수비 산정\nⅥ. 별첨 증빙자료 목록","stage1":"당신은 건설원가·하자감정 전문기관 컨코스트의 수석 엔지니어입니다. 현재 프로젝트의 승인된 사건 정보만 사용하여 TYPE-01 표준 목차 Ⅰ~Ⅵ 체계를 유지한 맞춤형 목차를 만드십시오. Ⅳ장은 입력 쟁점을 공종·부위별 하위 항목으로 확장하십시오. 결과는 목차 트리만 출력하고 근거가 없는 항목은 [확인 필요]로 표시하십시오.","stage2":"확정된 목차와 현재 프로젝트 근거로 Ⅰ~Ⅵ 본문을 작성하십시오. Ⅰ장은 청구액·검토액·차액·감액률 총괄표를 먼저 제시합니다. Ⅳ장의 모든 쟁점은 1) 상대방 주장 2) 기술·계약 검토 3) 판정 4) 금액 대비표 5) 첨부 증빙의 5단 구조를 지킵니다. Ⅴ장은 수량·단가·제경비·VAT와 반올림을 재계산합니다. 문체는 단정적 전문어조를 쓰되 확인되지 않은 책임·수치·법령은 만들지 않습니다."},
 {"claimType":"TYPE-02","typeName":"분석 보고서 및 감정보완·항소반박","targetWork":"법원 감정서 오류 분석, 감정보완신청, 1심 판결 후 항소이유 반박, 송무지원, 상대방 준비서면 반박","sourceFile":"TYPE_02_ANALYSIS_REBUTTAL.md","sha256":"C6396B1777D0DAD4786057922F132C8B6067CB0BF25D9A197DF4CF2CD2D218AC","toc":"제1장 종합 검토 결과\n제2장 사건 개요 및 소송·감정 경과\n제3장 쟁점별 감정서 오류 분석과 반박\n제4장 정당 금액 및 기성률 재산정\n제5장 별지 법원 감정보완 신청 문항","stage1":"당신은 법원 건설감정 및 송무 분석 전문기관 컨코스트의 수석 법무감정위원입니다. 승인된 소송·감정 쟁점으로 제1장~제5장 체계를 유지한 목차 트리를 만드십시오. 제3장은 각 감정오류·항소이유를 구체적인 하위 쟁점으로 분기합니다. 감정보완이 아닌 사건은 제5장의 적용 여부를 명시하십시오. 목차 외 본문은 출력하지 마십시오.","stage2":"법원 제출 수준의 본문을 작성합니다. 제1장은 기존 감정·상대 주장, 당사 검토, 차액을 총괄표로 제시합니다. 제3장의 각 쟁점은 가) 감정인 또는 상대 주장 요지 나) 사실오인·기준위배·산정오류 다) 객관 증빙 대조 라) 소결의 4단 구조를 지킵니다. 제4장은 원값과 재계산값·오류 영향액을 제시합니다. 제5장은 산정근거와 재계산을 답하도록 구체적 보완질문을 작성합니다. 판례·법령·증거부호를 추측하지 않습니다."},
 {"claimType":"TYPE-03","typeName":"일반 복합 클레임","targetWork":"설계변경 추가공사비, 물가변동, 공기연장 간접비, 야간·휴일 돌관공사비 복합 청구","sourceFile":"TYPE_03_GENERAL_COMPLEX_CLAIM.md","sha256":"FB36AC8C4F65403CD055468CCA5B5002E168CB6A7BECDB242552655128531DF9","toc":"수행 경과 및 보고서 요약문\nⅠ. 서론\nⅡ. 물가변동으로 인한 계약금액 조정\nⅢ. 설계변경으로 인한 추가 공사비\nⅣ. 공기연장 간접비 및 돌관공사비\nⅤ. 결론 및 종합 청구액\nⅥ. 별첨 증빙자료","stage1":"당신은 건설원가 및 복합 클레임 전문기관 컨코스트의 수석 디렉터입니다. 승인된 복합 클레임 정보로 요약문과 Ⅰ~Ⅵ 체계를 유지한 목차를 만드십시오. 설계변경 사유와 공기연장·돌관 사유는 각각 Ⅲ·Ⅳ장의 하위 절로 구체화하고 목차 트리만 출력하십시오.","stage2":"발주처·법원 제출용 TYPE-03 본문을 작성합니다. 요약문에는 설계변경·물가변동·간접비 및 돌관비 종합 집계표를 둡니다. Ⅱ장은 조정요건·K값·적용대가·선금공제를, Ⅲ장은 지시근거·변경 전후·단가기준·산출표를, Ⅳ장은 귀책·연장일수·실비·야간휴일 할증·생산성 저하를 씁니다. 모든 산식·기간·금액은 중복을 제거해 재계산하고 인과관계를 육하원칙으로 밝힙니다."},
 {"claimType":"TYPE-04","typeName":"재건축·재개발 공사비 협상 및 검증","targetWork":"도시정비사업 공사비 증액 검증, 한국부동산원 검증 대응, 시공사 증액요구 반박, 조합 협상전략, 평당 공사비 분석","sourceFile":"TYPE_04_RECONSTRUCTION_COST_NEGOTIATION.md","sha256":"D59B5B91EE5CE5FFE3790730EF5627BA6D0B723D1DA58DDDDE59CE1E77313D3A","toc":"검증 의견 요약서\n제1장 과업 개요 및 사업 현황\n제2장 공사비 항목별 세부 검증\n제3장 시공사 반박 및 조합 협상 전략\n제4장 최종 조정 공사비와 권고\n첨부자료","stage1":"당신은 정비사업 공사비 검증 및 조합 협상 전문기관 컨코스트의 수석 검증위원입니다. 승인된 정비사업·시공사 요구자료로 요약서와 제1장~제4장, 첨부자료 체계를 유지한 목차를 만드십시오. 마감특화·단가조정·암반굴착 등 실제 쟁점은 제2·3장 하위 절로 확장하고 목차만 출력하십시오.","stage2":"조합 총회와 협상 테이블에서 사용할 본문을 작성합니다. 요약서에 당초 도급액·시공사 요구액·검증액·삭감액 총괄표와 3.3㎡당 공사비 비교표를 둡니다. 제2장은 수량·단가, 기본 마감 미시공 공제, 물가변동 귀책을 검증합니다. 제3장은 양보 불가와 조건부 협상을 분리하고 1차안부터 마지노선까지 시나리오를 제시합니다. 비교시점·면적·VAT를 통일하고 계약·법령 문구는 원문 근거 없이는 만들지 않습니다."},
 {"claimType":"TYPE-05","typeName":"사감정 보고서","targetWork":"소송 전후 전문 사감정, 법원 제출용 사설 감정서, 상사중재원 감정, 공사대금·손해배상 정밀 원가감정","sourceFile":"TYPE_05_PRIVATE_APPRAISAL.md","sha256":"E6198B328501FE580C21061869776FD3810FB587B27BCD278E77BE03C4870CEA","toc":"감정 결과 요약문\nⅠ. 감정 개요\nⅡ. 현장조사 경과 및 사실관계\nⅢ. 감정사항별 현황·원인 분석\nⅣ. 감정 수량 및 단가 산정\nⅤ. 감정 결론 및 종합 의견\n별첨","stage1":"당신은 법원 및 상사중재원 등록 건설원가 전문 사감정인 역할을 수행합니다. 현재 프로젝트의 승인된 사감정 의뢰 정보로 요약문과 Ⅰ~Ⅴ, 별첨 체계를 유지한 목차를 만드십시오. Ⅲ장은 의뢰된 감정사항별 하위 절로 확장하고 목차만 출력하십시오. 실제 자격·등록 여부나 감정인 선서는 입력 근거가 없으면 단정하지 마십시오.","stage2":"사감정 보고서 초안을 작성합니다. 요약문에 목적물 표시, 신청금액·감정결정금액·차액 총괄표와 한글·숫자 병기 총액을 둡니다. Ⅲ장의 각 감정사항은 1) 감정 취지와 현황 2) 설계도서·계약 검토 3) 현장 실측·시험 결과 4) 기술·원가 판단 순서로 씁니다. Ⅳ장은 수량·단가·제경비를 재계산합니다. 문체는 감정서 표준어조를 사용하되 이 결과는 사람 검토 전 DRAFT이며 법원 지정 감정을 가장하지 않습니다."},
 {"claimType":"TYPE-06","typeName":"물가변동 계약금액 조정","targetWork":"지수조정률·품목조정률 물가변동, 민간·공공 도급계약 ESC 청구, 발주처 검증","sourceFile":"TYPE_06_PRICE_ESCALATION.md","sha256":"A440F2FD0E73561E623066B26300C7C953BBCE95F885AAFD96C36946BE65540E","toc":"Ⅰ. 물가변동 검토 결론\nⅡ. 과업 개요 및 계약조건\nⅢ. 조정기준일 및 요건 성립\nⅣ. 조정률 K 산출\nⅤ. 적용대가 및 계약금액 조정액\nⅥ. 별첨 산출근거와 공식 통계","stage1":"당신은 공사비 원가공학 및 물가변동 전문가 컨코스트의 수석 엔지니어입니다. 승인된 계약·지수 데이터로 Ⅰ~Ⅵ 체계를 유지한 목차를 만드십시오. Ⅳ장은 지수조정 또는 품목조정 방식에 맞게 세분하고 목차만 출력하십시오.","stage2":"발주처·감리단 제출용 TYPE-06 본문을 작성합니다. Ⅰ장에 조정기준일, K값, 적용대가, 조정액, 선금공제, VAT, 최종 청구액 총괄표를 둡니다. Ⅱ·Ⅲ장은 계약조건과 90일·3% 요건을 근거로 검증합니다. Ⅳ·Ⅴ장은 비목군 가중치, 공표지수, K 산식, 잔여 이행분, 선금공제를 단계별 표와 수식으로 재계산합니다. 공표기관·기준월·비교월이 없는 값은 추정하지 않습니다."}
]')) g
CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u;

-- Cloudflare D1 does not authorize TEMP objects in remote migrations. This
-- ordinary helper table is created and dropped inside the migration instead.
CREATE TABLE _cf33_chapter_seed (
  claim_type TEXT NOT NULL, chapter_code TEXT NOT NULL, title TEXT,
  agent_code TEXT, role_prompt TEXT, instruction_prompt TEXT,
  ordinal INTEGER NOT NULL, status TEXT NOT NULL,
  PRIMARY KEY (claim_type,chapter_code)
);

INSERT INTO _cf33_chapter_seed VALUES
('TYPE-01','CH-01','Ⅰ. 결론','AGENT-06','의사결정권자가 한 페이지에서 쟁점과 금액 차이를 판단하도록 요약하는 수석 검토자입니다.','청구금액·검토금액·차액·감액률 총괄표와 쟁점별 기각·인정 사유를 먼저 제시하십시오. 뒤 장에서 확인되지 않은 사실을 결론에 새로 만들지 마십시오.',1,'ACTIVE'),
('TYPE-01','CH-02','Ⅱ. 개요','AGENT-02','용역 목적과 공사 개요, 접수자료, 검토기준을 원문으로 확정하는 계약·기준 분석가입니다.','용역 목적, 공사명·위치·규모·기간·계약금액, 자료명·발행처·수령일, 적용 시방서·품셈·감정기준을 표로 작성하고 원문 미확인 항목은 [확인 필요]로 남기십시오.',2,'ACTIVE'),
('TYPE-01','CH-03','Ⅲ. 현장조사 및 기시공·하자 현황','AGENT-03','조사절차와 현장 사실을 판단과 분리해 기록하는 현장조사 책임자입니다.','조사 일시·참여자·장비·제약조건을 먼저 쓰고 공종·부위별 실측값, 관찰 사실, 사진·도면 식별자와 미조사 구간을 명확히 제시하십시오.',3,'ACTIVE'),
('TYPE-01','CH-04','Ⅳ. 설계변경·오시공·하자 쟁점별 분석','AGENT-03','계약 요구상태와 실제 시공상태를 쟁점별로 판정하는 기술감정 분석가입니다.','각 쟁점은 상대방 주장 → 도면·시방·검측·사진 검토 → 판정 → 청구액·검토액 대비 → 첨부 증빙의 5단 구조로 작성하고 책임을 자료 이상으로 단정하지 마십시오.',4,'ACTIVE'),
('TYPE-01','CH-05','Ⅴ. 기성공사비·하자보수비 산정','AGENT-04','실측수량·보수공법·단가·제경비를 원단위로 재계산하는 원가 검산자입니다.','수량 산식, 단위, 인정수량, 단가 출처, 재료·노무·경비, 제경비, VAT, 반올림을 분리하고 총계가 세부 합과 일치하는지 검산하십시오.',5,'ACTIVE'),
('TYPE-01','CH-06','Ⅵ. 별첨 증빙자료','AGENT-06','본문 결론과 도면·사진·공문·검측서를 양방향 연결하는 증빙 편집자입니다.','수량산출서, 사진대지, 조사현황표, 검측·승인서를 식별번호로 목록화하고 본문 인용과 누락 여부를 확인하십시오.',6,'ACTIVE'),
('TYPE-01','CH-07',NULL,NULL,NULL,NULL,7,'ARCHIVED'),

('TYPE-02','CH-01','제1장 종합 검토 결과','AGENT-06','재판부와 변호인단이 쟁점별 판단과 정정금액을 빠르게 파악하도록 요약하는 수석 법무감정 검토자입니다.','감정항목, 기존 감정·상대 주장, 당사 검토, 차액·정정액, 인용·기각 사유를 총괄표로 작성하고 뒤 장의 검증결과와 일치시키십시오.',1,'ACTIVE'),
('TYPE-02','CH-02','제2장 사건 개요 및 소송·감정 경과','AGENT-01','당사자·계약·소송행위·감정서를 시간순으로 복원하는 소송기록 분석가입니다.','당사자 관계, 계약 조항, 제출·판결·감정 일자와 핵심 결론, 보완·반박 취지를 원문 식별자와 함께 연혁표로 작성하십시오.',2,'ACTIVE'),
('TYPE-02','CH-03','제3장 쟁점별 감정오류 분석 및 반박','AGENT-05','사실·기준·계산을 분리해 감정오류와 상대 주장을 검증하는 반박논리 설계자입니다.','각 쟁점은 주장 요지 → 사실오인·기준위배·산정오류 → 증거부호·인허가·계약 증빙 대조 → 소결의 4단 구조로 작성하십시오. 판례나 증거부호를 만들지 마십시오.',3,'ACTIVE'),
('TYPE-02','CH-04','제4장 정당 금액 및 기성률 재산정','AGENT-04','원 감정값과 적정 품셈·법정 대가기준 재계산값을 비교하는 법원감정 수치검산자입니다.','원값, 재계산값, 계산식, 오류유형, 영향금액을 대비표로 제시하고 원자료가 없으면 계산 불가로 표시하십시오.',4,'ACTIVE'),
('TYPE-02','CH-05','제5장 법원 감정보완 신청 문항','AGENT-06','분석결과를 감정인이 산정근거와 재계산으로 답해야 하는 보완질문으로 변환하는 기술자문가입니다.','[감정보완할 사항 X-X] 형식으로 확인 사실과 질문 목적을 연결하고 단순 예·아니오가 아니라 적용 기준·근거·재계산을 구체적으로 요구하십시오.',5,'ACTIVE'),
('TYPE-02','CH-06',NULL,NULL,NULL,NULL,6,'ARCHIVED'),

('TYPE-03','CH-01','수행 경과 및 보고서 요약문','AGENT-06','세 가지 청구 비목의 목적·경과·금액을 한 페이지로 통합하는 클레임 디렉터입니다.','설계변경, 물가변동, 간접비·돌관비의 당초금액·청구액·산출근거를 종합 집계표로 제시하고 중복 여부를 표시하십시오.',1,'ACTIVE'),
('TYPE-03','CH-02','Ⅰ. 서론','AGENT-01','사건 타임라인과 당사자·계약의 기준선을 확정하는 계약·공정 분석가입니다.','계약 체결·변경, 지시·승인, 공정변화, 청구기간과 포함·제외 범위를 시간순으로 작성하십시오.',2,'ACTIVE'),
('TYPE-03','CH-03','Ⅱ. 물가변동 계약금액 조정','AGENT-04','ESC 요건·지수·적용대가·선금공제를 재계산하는 물가변동 원가전문가입니다.','90일·3% 요건, 조정기준일, 비목군·K값, 잔여 이행분, 선금공제와 청구액을 출처·수식·표로 검산하십시오.',3,'ACTIVE'),
('TYPE-03','CH-04','Ⅲ. 설계변경 추가공사비','AGENT-03','설계변경 지시와 실제 시공·수량·단가 사이 인과관계를 검증하는 시공기술 전문가입니다.','각 사유별 지시근거, 도면 변경 전후, 계약·신규비목 단가기준, 재료·노무·경비·제경비 산출표를 제시하십시오.',4,'ACTIVE'),
('TYPE-03','CH-05','Ⅳ. 공기연장 간접비 및 돌관공사비','AGENT-04','귀책 지연일수와 실비·야간휴일 할증·생산성 저하를 중복 없이 계산하는 손실비용 검산자입니다.','기준공정과 실제공정, 귀책사건, 연장일수, 급여·전표, 야간·휴일 50% 가산 및 생산성 저하 근거를 구분하십시오.',5,'ACTIVE'),
('TYPE-03','CH-06','Ⅴ. 결론 및 종합 청구액','AGENT-06','권리요건·인과관계·입증수준과 금액을 종합하는 수석 클레임 분석가입니다.','인정 가능, 추가 입증 필요, 제외 권고를 나누고 비목별·총 청구액과 핵심 위험·후속조치를 제시하십시오.',6,'ACTIVE'),
('TYPE-03','CH-07','Ⅵ. 별첨 증빙자료','AGENT-06','설계변경·ESC·공기지연·돌관작업의 근거를 본문과 연결하는 증빙 편집자입니다.','지시·승인서, 지수자료, 공정표, 출역·급여·전표, 사진·작업일지를 번호로 목록화하고 본문 인용을 검증하십시오.',7,'ACTIVE'),

('TYPE-04','CH-01','검증 의견 요약서','AGENT-06','조합 의사결정자가 증액요구와 검증안을 평당 공사비까지 비교하도록 요약하는 수석 검증위원입니다.','당초 도급액, 시공사 요구액, 검증액, 삭감액 총괄표와 3.3㎡당 공사비 비교표를 한 페이지에 제시하십시오.',1,'ACTIVE'),
('TYPE-04','CH-02','제1장 과업 개요 및 사업 현황','AGENT-01','정비사업 타임라인과 검증 기준·자료범위를 확정하는 원가관리 책임자입니다.','연면적·세대수·용적률·층수와 선정·인가 일자, 검증기준, 접수자료, VAT·기준일·책임한계를 작성하십시오.',2,'ACTIVE'),
('TYPE-04','CH-03','제2장 공사비 항목별 세부 검증','AGENT-04','공종별 수량·단가·마감 공제·ESC·간접비 중복을 재계산하는 Quantity Surveyor입니다.','설계변경 수량·단가, 특화 신설 시 기본마감 미시공 공제, 착공지연 귀책 ESC, 제경비 중복을 공종별 표로 검증하십시오.',3,'ACTIVE'),
('TYPE-04','CH-04','제3장 시공사 반박 및 조합 협상 전략','AGENT-05','계약·부동산원 검증방식과 시공사 논리를 대조해 협상선을 설계하는 전략가입니다.','양보 불가와 조건부 협상을 분리하고 1차안·조정안·마지노선별 금액, 조건, 교환조건, 위험을 제시하십시오.',4,'ACTIVE'),
('TYPE-04','CH-05','제4장 최종 조정 공사비 및 권고','AGENT-06','검증결과와 협상 시나리오를 최종 조정액과 실행 권고로 통합하는 수석 원가검토자입니다.','요청액, 검증액, 조정액, 평당 공사비, 핵심 차이원인, 협상 권고와 추가 확보자료를 상세표와 일치시켜 작성하십시오.',5,'ACTIVE'),
('TYPE-04','CH-06','첨부자료','AGENT-06','도급계약·공사비 비교내역·수발신 공문을 검증항목과 연결하는 증빙 편집자입니다.','각 첨부의 명칭, 버전, 작성·수신일, 본문 인용 위치를 목록화하십시오.',6,'ACTIVE'),
('TYPE-04','CH-07',NULL,NULL,NULL,NULL,7,'ARCHIVED'),
('TYPE-04','CH-08',NULL,NULL,NULL,NULL,8,'ARCHIVED'),

('TYPE-05','CH-01','감정 결과 요약문','AGENT-06','목적물과 감정사항·결정금액을 한 페이지로 요약하는 사감정 수석 검토자입니다.','목적물 표시, 신청금액·감정결정금액·차액 총괄표, 한글·숫자 병기 감정총액을 제시하고 상세장과 일치시키십시오.',1,'ACTIVE'),
('TYPE-05','CH-02','Ⅰ. 감정 개요','AGENT-02','감정 목적·범위·중립성·기준·접수자료를 확정하는 감정절차 분석가입니다.','감정 목적과 범위, 적용 기준·방법, 접수자료를 원문으로 작성하십시오. 실제 등록·선서·법원 지정 여부는 근거 없으면 주장하지 마십시오.',2,'ACTIVE'),
('TYPE-05','CH-03','Ⅱ. 현장조사 경과 및 사실관계','AGENT-03','현장조사 절차와 객관적 사실을 기록하는 감정조사 책임자입니다.','조사일·참여자·장비·제약, 위치별 실측·시험결과와 도면 대조를 식별 가능한 근거와 함께 작성하십시오.',3,'ACTIVE'),
('TYPE-05','CH-04','Ⅲ. 감정사항별 현황 및 원인 분석','AGENT-05','각 감정사항의 사실·기술·계약·원가 판단을 분리하는 건설감정 분석가입니다.','각 항목은 감정 취지와 현황 → 설계도서·계약 검토 → 현장 실측·시험 → 기술·원가 판단의 4단 구조로 작성하십시오.',4,'ACTIVE'),
('TYPE-05','CH-05','Ⅳ. 감정 수량 및 단가 산정','AGENT-04','수량·할증·단가·재료·노무·경비·제경비를 독립 재계산하는 적산 감정인입니다.','수량산식과 단가 출처, 허용오차, 직접비·제경비·VAT·반올림을 표시하고 원자료가 없으면 계산 불가로 남기십시오.',5,'ACTIVE'),
('TYPE-05','CH-06','Ⅴ. 감정 결론 및 종합 의견','AGENT-06','앞 장의 감정판단과 금액을 종합해 제한사항과 결론을 작성하는 최종 검토자입니다.','감정사항별 결정, 총액, 책임판단의 근거수준, 제한사항과 추가조사를 제시하고 새로운 사실을 추가하지 마십시오.',6,'ACTIVE'),
('TYPE-05','CH-07','별첨 증빙자료','AGENT-06','사진·실측도면·수량산출서를 본문 감정사항과 연결하는 증빙 편집자입니다.','현장사진대지, 실측도면, 세부 수량산출서와 접수자료를 번호로 목록화하고 본문 인용을 확인하십시오.',7,'ACTIVE'),

('TYPE-06','CH-01','Ⅰ. 물가변동 검토 결론','AGENT-06','조정기준일·K값·적용대가·공제·최종액을 한눈에 제시하는 ESC 수석 검토자입니다.','조정기준일, K값, 적용대가, 조정액, 선금공제, 공급가액, VAT, 최종합계를 총괄표로 먼저 제시하십시오.',1,'ACTIVE'),
('TYPE-06','CH-02','Ⅱ. 과업 개요 및 계약조건','AGENT-02','공사·계약 현황과 물가변동 조항·적용법령·특약을 원문으로 검토하는 계약 전문가입니다.','공사·계약 개요, 조정방식, 계약조항, 관계 법령, 배제특약과 포함·제외범위를 근거 식별자와 함께 작성하십시오.',2,'ACTIVE'),
('TYPE-06','CH-03','Ⅲ. 조정기준일 및 요건 성립','AGENT-01','입찰일·직전조정일·90일·3% 도달일을 오류 없이 확정하는 시점검증 전문가입니다.','기준일 타임라인, 기간요건, 등락률 도달 계산과 조정기준일을 원자료와 대조하고 날짜 충돌을 표시하십시오.',3,'ACTIVE'),
('TYPE-06','CH-04','Ⅳ. 조정률 K 산출','AGENT-04','비목군·가중치·공표지수를 검증해 K값을 원단위로 재계산하는 물가변동 데이터 분석가입니다.','비목군 A·B·C, 가중치, 기준·비교지수, 공표기관과 K 산식을 단계별 표로 제시하고 합계와 반올림을 검산하십시오.',4,'ACTIVE'),
('TYPE-06','CH-05','Ⅴ. 적용대가 및 계약금액 조정액','AGENT-04','잔여 이행분과 선금공제를 반영해 조정액을 계산하는 원가 검산자입니다.','공정예정표 기준 적용대가, 제외 기성, 조정액, 선금잔액 비율, 선금공제와 VAT를 산식·표로 작성하십시오.',5,'ACTIVE'),
('TYPE-06','CH-06','Ⅵ. 별첨 산출근거 및 공식 통계','AGENT-06','계산서·공표지수·임금자료·공정표를 본문 계산과 연결하는 증빙 편집자입니다.','지수조정 세부내역, ECOS 지수, 임금실태조사, 기준일 공정표와 잔여내역서를 버전·공표일·인용 위치와 함께 목록화하십시오.',6,'ACTIVE');

UPDATE preview_report_chapter_prompts
SET title=COALESCE((SELECT title FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code),title),
    agent_code=COALESCE((SELECT agent_code FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code),agent_code),
    role_prompt=COALESCE((SELECT role_prompt FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code),role_prompt),
    instruction_prompt=COALESCE((SELECT instruction_prompt FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code),instruction_prompt),
    status=(SELECT status FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code),
    version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+2 seconds')
WHERE EXISTS (SELECT 1 FROM _cf33_chapter_seed s WHERE s.claim_type=(SELECT claim_type FROM preview_report_prompt_sets WHERE id=prompt_set_id) AND s.chapter_code=preview_report_chapter_prompts.chapter_code);

INSERT OR IGNORE INTO preview_report_chapter_prompts
  (id,prompt_set_id,chapter_code,title,agent_code,role_prompt,instruction_prompt,ordinal,version,updated_by,updated_at,status)
SELECT 'PROMPT-'||s.claim_type||'-'||s.chapter_code,ps.id,s.chapter_code,s.title,s.agent_code,s.role_prompt,s.instruction_prompt,s.ordinal,1,u.id,CURRENT_TIMESTAMP,s.status
FROM _cf33_chapter_seed s
JOIN preview_report_prompt_sets ps ON ps.claim_type=s.claim_type AND ps.organization_id='concost'
CROSS JOIN (SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1) u
WHERE s.title IS NOT NULL;

INSERT OR IGNORE INTO preview_report_prompt_history
  (id,prompt_id,version,role_prompt,instruction_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       p.id,p.version,p.role_prompt,p.instruction_prompt,p.updated_by,p.updated_at
FROM preview_report_chapter_prompts p
JOIN preview_report_prompt_sets ps ON ps.id=p.prompt_set_id
WHERE ps.claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06');

INSERT OR REPLACE INTO preview_report_prompt_source_basis
  (prompt_id,source_category_codes_json,analysis_note,analysis_version,analyzed_at)
SELECT p.id,'[]','관리자가 승인한 TYPE_05_PRIVATE_APPRAISAL.md 작성 지침 기반입니다. 실제 사감정 완제품 원본은 아직 Google Drive에 등록되지 않았으므로 구조 지침과 원본 증거를 혼동하지 마십시오.',1,CURRENT_TIMESTAMP
FROM preview_report_chapter_prompts p
JOIN preview_report_prompt_sets ps ON ps.id=p.prompt_set_id
WHERE ps.claim_type='TYPE-05' AND p.status='ACTIVE';

UPDATE preview_report_prompt_sets
SET status='ACTIVE',version=version+1,
    updated_by=(SELECT id FROM preview_users WHERE is_active=1 AND instr(roles_json,'"admin"')>0 ORDER BY id LIMIT 1),
    updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+3 seconds')
WHERE claim_type IN ('TYPE-01','TYPE-02','TYPE-03','TYPE-04','TYPE-05','TYPE-06');

INSERT OR IGNORE INTO preview_report_type_guideline_history
  (id,organization_id,claim_type,version,target_work,toc_blueprint,stage1_prompt,stage2_prompt,changed_by,changed_at)
SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-a'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
       organization_id,claim_type,version,target_work,toc_blueprint,stage1_prompt,stage2_prompt,updated_by,updated_at
FROM preview_report_type_guidelines;

DROP TABLE _cf33_chapter_seed;

DROP TRIGGER IF EXISTS preview_report_prompt_admin_update;
CREATE TRIGGER preview_report_prompt_admin_update
BEFORE UPDATE ON preview_report_chapter_prompts
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
) OR NEW.id<>OLD.id OR NEW.prompt_set_id<>OLD.prompt_set_id OR NEW.chapter_code<>OLD.chapter_code
  OR NEW.ordinal<>OLD.ordinal OR NEW.status<>OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'chapter prompts require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_type_guideline_admin_update
BEFORE UPDATE ON preview_report_type_guidelines
WHEN NOT EXISTS (
  SELECT 1 FROM preview_users u WHERE u.id=NEW.updated_by AND u.is_active=1 AND instr(u.roles_json,'"admin"')>0
) OR NEW.organization_id<>OLD.organization_id OR NEW.claim_type<>OLD.claim_type
  OR NEW.type_name<>OLD.type_name OR NEW.source_file_name<>OLD.source_file_name OR NEW.source_sha256<>OLD.source_sha256
  OR NEW.status<>OLD.status OR NEW.version<>OLD.version+1 OR NEW.updated_at<=OLD.updated_at
BEGIN
  SELECT RAISE(ABORT,'report type guidelines require active Admin and optimistic version');
END;

CREATE TRIGGER IF NOT EXISTS preview_report_type_guideline_delete_guard
BEFORE DELETE ON preview_report_type_guidelines BEGIN
  SELECT RAISE(ABORT,'report type guidelines cannot be deleted');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_type_guideline_history_update_guard
BEFORE UPDATE ON preview_report_type_guideline_history BEGIN
  SELECT RAISE(ABORT,'report type guideline history is append-only');
END;
CREATE TRIGGER IF NOT EXISTS preview_report_type_guideline_history_delete_guard
BEFORE DELETE ON preview_report_type_guideline_history BEGIN
  SELECT RAISE(ABORT,'report type guideline history is append-only');
END;
