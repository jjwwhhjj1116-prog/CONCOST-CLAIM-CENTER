# P07 Codex 보정·검수 증거 노트

## 판정

- 최종 판정: `PASS_WITH_NOTES`
- 최종 E 저장소 검수 커밋: `b9fb97eef4961a5a309d731f122b61b831802863`
- 깨끗한 검증 source 커밋: `186449b120953f39fa0941761f2c24e3e89d908a` (동일 tree)
- 다음 단계: `P08 진입 허용`

## Antigravity 제출 상태에서 확인한 결함

- P07 구현·상태 커밋, 증거 패키지, 검수 요청서가 없었고 상태가 `IN_PROGRESS`였다.
- 실제 `pnpm test`가 실패했는데도 통과로 보고됐다.
- P06의 파일명·MIME·저장·SHA·원자성 방어와 기존 하네스 반례가 퇴행했다.
- 제안서 5개 필수 입력, 작성/승인 권한 분리, 자기 승인 차단, 낙관적 잠금, 승인 버전 전용 출력, DB 불변조건이 불완전했다.
- `test:e2e`가 P06만 실행했고 P07 실제 브라우저 흐름이 없었다.
- DOCX/PDF 검증이 실제 컨테이너·xref·텍스트 무결성을 충분히 증명하지 못했다.

## Codex 직접 보정

- P06 PASS 구현을 복원한 뒤 P07을 그 보안 경계 위에 재통합했다.
- ProposalTemplate/Proposal/ProposalVersion/ProposalReview와 additive migration, snapshot·상태 전이·자기 승인·review/output 불변 DB 트리거를 구현했다.
- 5개 필수 입력, TYPE-01~06, 사건/근거 IDOR, Origin/CSRF/RBAC, stale 409, 결정적 local fake AI, AI_DRAFT→사람 수동 버전 경계를 서버에서 강제했다.
- 승인된 버전만 P06 Document/DocumentVersion 저장 경계로 출력하고 AuditLog 실패 시 DB·디스크를 함께 롤백했다.
- 실제 OOXML ZIP DOCX와 Unicode CJK PDF를 생성하고 CRC/xref/offset/메타데이터/한글 round-trip 및 변조 거부를 검증했다.
- PROP-01/PROP-02 실제 UI와 P07 Chrome E2E를 추가하고 P06 E2E 및 P04~P06 보안 회귀를 보존했다.

## 독립 재현 결과

- 새 클론, 설치 전 `node_modules` 없음, source 구현 커밋 `186449b` 고정. E 통합 커밋 `b9fb97e`와 26개 파일 내용 동일
- 11개 게이트 전부 통과
- 일반 테스트 `71/71`, 보안 테스트 `30/30`
- 실제 Chrome P06+P07 E2E 통과
- high 이상 알려진 취약점 `0`
- 추적 키·토큰·민감 파일·실고객 자료 `0`

## 낮은 위험 메모

- PDF는 `UniKS-UCS2-H`와 한국어 CID font 이름을 사용하는 유효한 CJK PDF이나 글꼴을 파일에 포함하지 않는다. 현재 Windows/Chrome 환경의 렌더링과 자체 파서 한글 round-trip은 통과했다. 장기적으로 배포 라이선스를 확인한 한국어 글꼴 부분 임베딩을 적용하면 뷰어 간 모양 일관성이 더 높아진다.
- 실패를 의도적으로 주입하는 AuditLog 롤백 테스트의 Prisma 오류는 stderr에 출력된다. 테스트가 실패한 것이 아니라 500 응답, 트랜잭션 롤백, orphan 0을 확인한 공격 증거다.
