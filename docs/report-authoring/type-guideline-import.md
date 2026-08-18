# CF33 유형별 보고서 작성 지침 반영 기록

관리자가 제공한 `docs/prompts` 명세는 보고서 원본 완제품이 아니라 **작성 정책 원본**으로 취급한다. 원본 보고서 파일의 존재·내용을 증명하는 CF32 Google Drive 라이브러리와 혼동하지 않는다.

## 적용 계약

1. Stage 1은 현재 프로젝트 근거로 승인 목차 블루프린트에 맞춘 챕터별 작성계획을 생성한다.
2. 사용자가 목차 작성계획을 확인하고 확정한다.
3. Stage 2는 확정 목차, 유형별 공통 지침, 챕터별 역할·지침, 현재 프로젝트 근거만 사용해 한 챕터씩 작성한다.
4. 관리자만 유형별·챕터별 지침의 새 버전을 저장한다. 모든 이전 버전은 D1 append-only 이력에 남는다.
5. 실제 근거가 없으면 `[확인 필요]`, 충돌하면 `[근거 충돌]`로 남긴다. 예시 수치·사건명·증거부호를 현재 프로젝트 사실로 복제하지 않는다.

## 승인된 입력 파일

| 유형 | 파일 | SHA-256 |
|---|---|---|
| TYPE-01 | `TYPE_01_FIELD_SURVEY_QUANTITY.md` | `4fe91898163a1371099a6a21ac49bd8b1180e2c427fdd44d27c46516f848a82c` |
| TYPE-02 | `TYPE_02_ANALYSIS_REBUTTAL.md` | `c6396b1777d0dad4786057922f132c8b6067cb0bf25d9a197df4cf2cd2d218ac` |
| TYPE-03 | `TYPE_03_GENERAL_COMPLEX_CLAIM.md` | `fb36ac8c4f65403cd055468cca5b5002e168cb6a7becdb242552655128531df9` |
| TYPE-04 | `TYPE_04_RECONSTRUCTION_COST_NEGOTIATION.md` | `d59b5b91ee5ce5ffe3790730ef5627ba6d0b723d1da58dddde59ce1e77313d3a` |
| TYPE-05 | `TYPE_05_PRIVATE_APPRAISAL.md` | `e6198b328501fe580c21061869776fd3810fb587b27bcd278e77be03c4870cea` |
| TYPE-06 | `TYPE_06_PRICE_ESCALATION.md` | `a440f2fd0e73561e623066b26300c7c953bbce95f885aafd96c36946be65540e` |

마스터 가이드 `README.md`의 SHA-256은 `18615d982bcbc50cf50b832518002825f22429e3e35f591cf8bb2151c8a9751d`이다.

TYPE-05는 이 관리자 작성 지침으로 챕터 작성 기능을 사용할 수 있지만, 실제 사감정 완제품 원본은 별도로 Google Drive에 등록·검증되기 전까지 “원본 미등록” 상태를 유지한다.
