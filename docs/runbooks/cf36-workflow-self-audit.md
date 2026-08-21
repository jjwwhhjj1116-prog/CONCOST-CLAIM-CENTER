# CF36 업무 흐름·연동 자가검수

## 1. 프로젝트 카테고리 연결

프로젝트 일정표는 화면용 샘플 배열을 사용하지 않는다. `GET /api/project-workflow/schedule`이 배정된 사건을 기준으로 아래 D1 기록을 함께 읽어 6단계 상태와 진행률을 계산한다.

| 사용자 화면 | D1 기준 기록 | 일정표 단계 |
| --- | --- | --- |
| 프로젝트 의뢰 | `preview_cases`, `preview_case_parties` | 프로젝트 생성·법적 지위 |
| 제안서 작성 | `preview_proposals`, `preview_proposal_versions` | 1. 제안서 연동 |
| 프로젝트 접수·수주 | `preview_project_awards` | 2. 수주 확정 |
| 착수회의 | `preview_project_kickoffs`, `preview_meeting_minutes` | 3. 착수회의 |
| 현장조사 | `preview_site_survey_plans`, 사건 자료 | 4. 현장조사 |
| 물량산출·내역 | `preview_team_allocations`, `preview_evidence`, `preview_case_evidence` | 5. 수량산출·내역작성 |
| 보고서 작성 | `preview_report_drafts`, `preview_report_reviews`, `preview_report_finalizations` | 6. 보고서 작성 |

테스트: `scripts/cf36-workflow-integrity-test.ts`는 실제 D1 행을 생성하고 API 일정표가 동일 사건·단계로 조합되는지 검증한다.

## 2. Google Drive 자료 저장

`POST /api/cases/:caseId/evidence`와 `POST /api/cases/:caseId/intake-audio`는 브라우저 파일을 Worker가 검증한 뒤 연결된 회사 Google Drive에 먼저 저장한다. 저장 성공 응답의 실제 `fileId`와 `folderId`, SHA-256, 업로더, 시각만 D1 원장에 기록한다.

- 일반 자료: `프로젝트/자료구분/YYYY-MM`
- 의뢰 녹음: `프로젝트/프로젝트 의뢰 녹음/YYYY-MM`
- Drive 연결이 없거나 Google 응답이 모호하면 D1에 성공 자료로 기록하지 않는다.
- 외부 저장은 Google Drive이며 R2는 사용하지 않는다.

계약 테스트: `scripts/cf05-google-drive-test.ts`, `scripts/cf16-case-evidence-library-test.ts`, `scripts/cf30-settings-template-preview-test.ts`.

## 3. 법원자료·소송일정의 현재 방식

현재 화면은 법원 사이트를 자동 크롤링하는 시스템이 아니다. 사용자가 사건번호·법원·당사자·공식 출처 URL을 D1에 등록하고, 검증 상태가 `VERIFIED`인 사건과 이벤트만 보고서 근거 및 프로젝트 법원 일정으로 연결하는 내부 검증 원장이다.

- 사건: `preview_litigation_cases`
- 소송 이벤트: `preview_litigation_events` (append-only)
- 프로젝트 일정 반영: 검증된 이벤트만 `preview_case_schedules`의 `COURT` 일정으로 생성
- API는 `officialLookupAutomated: false`를 반환하여 자동 조회처럼 오인시키지 않는다.

전자소송/법원 API 또는 허가된 데이터 공급자와의 자동 검색은 별도 공식 연동 계약이 필요하다.

## 4. 첫 로그인 튜토리얼

`CF36_V1` 튜토리얼은 계정별로 1회 열린다. 사용자는 13개 업무 화면을 실제로 방문해야 다음 설명으로 갈 수 있고, `COMPLETED` 또는 `SKIPPED` 결과가 D1에 저장된다. 이후 상단 도움말에서 전체 튜토리얼을 다시 열 수 있다.

브라우저 검수: `scripts/cf35-guided-workspace-e2e.ts`.

## 5. 검토·승인·납품 알림

검토자는 수정 요청을 할 수 있지만 최종 승인은 CEO/DIRECTOR 역할인 현동명 대표 또는 이원희 부사장만 가능하다. 승인 트랜잭션 안에서 프로젝트 PM의 앱 알림과 이메일 outbox가 함께 생성된다.

- 앱 알림: `preview_notifications`
- 메일 대기열: `preview_email_outbox`
- 외부 메일 브리지가 설정되면 `PM_NOTIFICATION_WEBHOOK_URL`로 HTTPS 발송
- 브리지가 없으면 `CONFIG_REQUIRED`로 표시하며 발송 완료라고 거짓 표시하지 않는다.

## 6. 프로젝트 의뢰의 법적 지위·녹음 요약

신규 의뢰에는 클라이언트 법적 지위와 구체 설명을 필수로 저장한다. 녹음 파일을 추가하면 Gemini 2.5 Flash가 클라이언트 입장에서 사실·주장·상대방 주장·일정·확인 필요 항목을 구조화한다. 원본 녹음은 Google Drive, 요약과 출처 ID는 D1에 보존되며 보고서 작성 컨텍스트에 함께 포함된다.
