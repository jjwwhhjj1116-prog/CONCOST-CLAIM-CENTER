PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS preview_proposal_company_assets (
  asset_key TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  chapter_number INTEGER NOT NULL CHECK (chapter_number BETWEEN 4 AND 10),
  display_order INTEGER NOT NULL CHECK (display_order BETWEEN 1 AND 99),
  title TEXT NOT NULL,
  alt_text TEXT NOT NULL,
  mime_type TEXT,
  file_name TEXT,
  file_data BLOB,
  file_sha256 TEXT,
  width INTEGER,
  height INTEGER,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT,
  updated_at TEXT,
  FOREIGN KEY (updated_by) REFERENCES preview_users(id)
);

CREATE INDEX IF NOT EXISTS idx_preview_proposal_company_assets_chapter
  ON preview_proposal_company_assets (chapter_number, display_order);

INSERT OR IGNORE INTO preview_proposal_company_assets
  (asset_key, organization_id, chapter_number, display_order, title, alt_text, is_active, version)
VALUES
  ('CH04_EXPERT_PROFILE', 'concost', 4, 1, '현동명 원장 전문가 프로필', '현동명 원장의 학력·경력·논문·저서 소개', 1, 1),
  ('CH06_ORG_CHART', 'concost', 6, 1, '컨코스트 조직도', '경영진·컨코스트 본사·클레임센터·베트남 지사의 조직 구성', 1, 1),
  ('CH06_BUSINESS_AREAS', 'concost', 6, 2, '업무 영역과 수행 역량', '개산견적·수량산출·현장검증·클레임·공사비검증 등 업무 영역', 1, 1),
  ('CH10_DEGREE', 'concost', 10, 1, '박사학위 수여증명서', '건설법무학 박사학위 수여 증명자료', 1, 1),
  ('CH10_APPRAISER', 'concost', 10, 2, '건설감정사 자격증', '한국건설법무학회의 건설감정사 자격 증명자료', 1, 1),
  ('CH10_PUBLICATIONS', 'concost', 10, 3, '논문·저서 실물 자료', '건축견적이야기·박사학위 논문·건축시공이야기 표지', 1, 1),
  ('BRAND_LOGO', 'concost', 4, 99, 'CONCOST 로고', '주식회사 컨코스트 로고', 0, 1);
