# 구글 스티치 20개 필수 화면 명세 및 3단 보고서 스튜디오 레이아웃 (Stitch Screen Specifications)

## 1. 개요 및 화면 카탈로그
본 명세서는 클레임센터 보고서 스튜디오의 20개 필수 화면에 대한 Google Stitch 프로젝트 화면 명정 카탈로그입니다.
모든 화면은 공식 Google Stitch URL (`https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/`) 및 Export Artifacts (`docs/stitch/artifacts/{ScreenID}/screen.html`)와 1:1 바인딩됩니다.

## 2. 20개 화면별 Google Stitch 메타데이터 및 카탈로그

| 화면 ID | 화면 명칭 | 공식 Google Stitch URL | Export HTML Artifacts 경로 |
| :--- | :--- | :--- | :--- |
| `AUTH-01` | 로그인 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_auth_01` | `docs/stitch/artifacts/AUTH-01/screen.html` |
| `DASH-01` | 메인 대시보드 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_dash_01` | `docs/stitch/artifacts/DASH-01/screen.html` |
| `CASE-01` | 사건 목록 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_01` | `docs/stitch/artifacts/CASE-01/screen.html` |
| `CASE-02` | 새 사건 등록 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_02` | `docs/stitch/artifacts/CASE-02/screen.html` |
| `CASE-03` | 사건 상세 개요 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_03` | `docs/stitch/artifacts/CASE-03/screen.html` |
| `CASE-04` | 사건 상세 일정 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_04` | `docs/stitch/artifacts/CASE-04/screen.html` |
| `CASE-05` | 사건 상세 관계자 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_05` | `docs/stitch/artifacts/CASE-05/screen.html` |
| `CASE-06` | 사건 상세 자료실 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_case_06` | `docs/stitch/artifacts/CASE-06/screen.html` |
| `MEET-01` | 회의록 관리 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_meet_01` | `docs/stitch/artifacts/MEET-01/screen.html` |
| `PROP-01` | 제안서 템플릿 선택| `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_prop_01` | `docs/stitch/artifacts/PROP-01/screen.html` |
| `PROP-02` | 제안서 단계형 작성| `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_prop_02` | `docs/stitch/artifacts/PROP-02/screen.html` |
| `REPO-01` | 보고서 목록 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_repo_01` | `docs/stitch/artifacts/REPO-01/screen.html` |
| `REPO-02` | 보고서 스튜디오 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_repo_02` | `docs/stitch/artifacts/REPO-02/screen.html` |
| `APPR-01` | 검토 및 승인함 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_appr_01` | `docs/stitch/artifacts/APPR-01/screen.html` |
| `FEE-01`  | 성공보수 정산 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_fee_01` | `docs/stitch/artifacts/FEE-01/screen.html` |
| `TPL-01`  | 양식 템플릿 관리 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_tpl_01` | `docs/stitch/artifacts/TPL-01/screen.html` |
| `AI-01`   | AI 공급자 및 비용 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_ai_01` | `docs/stitch/artifacts/AI-01/screen.html` |
| `USER-01` | 사용자 및 권한 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_user_01` | `docs/stitch/artifacts/USER-01/screen.html` |
| `AUD-01`  | 감사로그 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_aud_01` | `docs/stitch/artifacts/AUD-01/screen.html` |
| `RESP-01` | 태블릿 축약 | `https://stitch.withgoogle.com/projects/proj_claim_studio_v1/screens/screen_resp_01` | `docs/stitch/artifacts/RESP-01/screen.html` |

## 3. 핵심 3단 보고서 스튜디오 (REPO-02) 레이아웃 규정
1. **좌측 목차 패널 (260px Fixed)**: 7대 표준 장(Section) 목차 트리, 7대 장 상태 배지 (⚪ 미작성, 🔵 작성중, 🟣 AI초안, 🟡 담당자검토, 🟠 수정요청, 🟢 승인, 💎 최종확정).
2. **중앙 리치 에디터 패널 (Flex 1)**: 문단별 에디터, 증거 하이라이트, 버전 비교.
3. **우측 AI 지원 패널 (320px Fixed)**: 증거 선택, AI 모델 드롭다운, [AI 초안 생성] 그라데이션 버튼.
