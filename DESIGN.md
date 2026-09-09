---
name: "Claim Center Studio — ES Workbench"
description: "CF130 ES 전용 업무 화면의 구현 기반 시각 규칙; 전역 브랜드 변경 아님"
colors:
  es-accent: "#236c9a"
  es-accent-hover: "#1b567d"
  selected-row: "#e6f1fc"
  selected-ink: "#173c63"
  manual-entry: "#fff5cc"
  manual-ink: "#183049"
  paper: "#ffffff"
  raised-light: "#fafcfe"
  muted-light: "#f0f4f8"
  raised-dark: "#111a2e"
  muted-dark: "#0b1222"
  workbench-line: "#c8d6e5"
  focus-ring: "#70a9de"
  draft-surface: "#fff7e8"
  draft-ink: "#80511d"
typography:
  title:
    fontFamily: "inherit"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "-.018em"
  headline:
    fontFamily: "inherit"
    fontSize: "18px"
    fontWeight: 700
    lineHeight: 1.45
  body:
    fontFamily: "inherit"
    fontSize: "14px"
    lineHeight: 1.45
  label:
    fontFamily: "inherit"
    fontSize: "12px"
    fontWeight: 600
  caption:
    fontFamily: "inherit"
    fontSize: "11px"
  print:
    fontFamily: "\"Malgun Gothic\", \"맑은 고딕\", sans-serif"
    fontSize: "9pt"
    lineHeight: 1.5
rounded:
  square: "0"
  field: "5px"
  button: "6px"
  table: "7px"
  dialog: "10px"
spacing:
  compact: "6px"
  small: "8px"
  control: "10px"
  panel: "12px"
  inspector: "14px"
  heading: "16px"
  ledger: "18px"
components:
  button-primary:
    backgroundColor: "{colors.es-accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "6px 12px"
  button-primary-hover:
    backgroundColor: "{colors.es-accent-hover}"
    textColor: "{colors.paper}"
  button-secondary:
    backgroundColor: "{colors.raised-light}"
    rounded: "{rounded.button}"
    padding: "6px 12px"
  input-manual:
    backgroundColor: "{colors.manual-entry}"
    rounded: "{rounded.field}"
    padding: "7px 9px"
  input-lookup:
    backgroundColor: "{colors.raised-light}"
    rounded: "{rounded.field}"
    padding: "7px 9px"
  step-selected:
    backgroundColor: "{colors.es-accent}"
    textColor: "{colors.paper}"
    rounded: "{rounded.button}"
    padding: "8px 10px"
  draft-label:
    backgroundColor: "{colors.draft-surface}"
    textColor: "{colors.draft-ink}"
    padding: "5px 8px"
  inspector:
    backgroundColor: "{colors.muted-light}"
    rounded: "{rounded.square}"
    padding: "{spacing.inspector}"
  sheet-selected:
    backgroundColor: "{colors.selected-row}"
    textColor: "{colors.selected-ink}"
    rounded: "{rounded.square}"
    padding: "7px"
---

# Design System: Claim Center Studio — ES Workbench

## Overview

**Creative North Star: "desktop 업무 프로그램"**

이 문서는 CF130 ES 산출서 작업 화면과 그 출력 미리보기만 기록한다. 클레임센터 전체의 브랜드, 다른 편집기, 공용 디자인 토큰을 교체하는 문서가 아니다. 사용자가 승인한 desktop 업무 프로그램의 조밀한 표, 차분한 구분선, 노란 수동입력, 파란 선택·주요동작을 현재 구현에서 추출했다.

작업표와 선택 비목의 근거를 같은 공간에서 읽고, 수정 중인 입력과 저장·계산본을 구분한다. 추가 장식이나 새 브랜드 자산 없이 기존 클레임센터 메뉴·테마·사용자 글꼴 설정 안에서 동작한다.

**Key Characteristics:**

- 조밀한 작업표와 선택 비목 근거의 연동
- 노란 수동입력과 중립색 조회·선택 컨트롤의 구분
- 현재 입력·저장 revision·검토용 초안의 명시
- 기존 앱 메뉴와 밝은/어두운 테마의 보존

## Colors

파란 업무 동작과 연한 노란 입력면을 중립 작업표 위에 배치한다. 앞의 토큰 값은 현재 CSS에서 추출한 값이며, 아래 설명은 적용 맥락이다.

### Primary

- **업무 청색**: es-accent는 주요 실행 버튼·현재 단계·최종 조정금액에 사용한다. es-accent-hover는 주요 도구 모음 버튼과 현재 단계의 hover다.
- **선택 청백색 / 선택 잉크**: selected-row와 selected-ink는 선택 비목 행·선택 시트의 배경과 텍스트다. 버튼의 강한 현재 단계와 표의 연한 행 선택은 서로 다른 상태다.
- **포커스 청색**: focus-ring은 키보드 포커스 외곽선이다.

### Secondary

- **수동입력 연노랑**: manual-entry는 원본 수동입력·비목 금액·기간 원자료·공제 데이터의 입력면이다. 기본입력에서 data-es-manual로 표시한 19칸과 추가 계약정보의 구분을 보존한다.
- **초안 크림색 / 초안 갈색**: draft-surface와 draft-ink는 단계 제목 옆 검토용 초안 표시다. 검증 완료의 의미가 아니다.

### Neutral

- **테마 작업면**: raised-light/raised-dark는 상위 --surface-raised, muted-light/muted-dark는 --surface-soft의 현재 값이다. ES는 --surface와 --surface-muted로 이 값을 참조한다. 밝은 테마의 흰 계열 조회 입력을 어두운 테마에서 강제 흰색으로 바꾸지 않는다.
- **종이 백색**: paper는 A4 문서와 주요 버튼 텍스트에 사용한다. A4 종이는 앱 테마와 무관하게 백색이다.
- **작업 구분선**: workbench-line은 ES의 --es-line 값이다.
- **수동입력 잉크**: manual-ink는 ES 입력의 지역 CSS 값이다. 실제 밝은 테마는 공용 !important 텍스트·테두리 규칙을 적용하므로 --text-primary와 --border-strong가 우선한다.

**The Input Role Rule.** 노란색은 수동 업무 데이터에 사용한다. 검색·기간 선택·인쇄 설정은 테마의 중립 작업면을 사용하며, 밝은 테마에서는 흰 계열로 보인다.

## Typography

**Body Font:** 상위 앱의 사용자 글꼴 설정을 상속

**Character:** 별도 전시용 서체나 독립적인 배율을 추가하지 않는다. theme-system.css는 Noto Sans KR / Manrope / system-ui 기본 스택과 Pretendard·Noto Sans KR·system 사용자 선택을 제공한다. ES의 inherit는 이 선택을 보존한다. 인쇄 iframe은 맑은 고딕 계열을 별도로 사용한다.

### Hierarchy

- **Title** (700, 20px, line-height 1.45): 작업영역 제목. 600px 이하에서는 17px.
- **Headline** (700, 18px, line-height 1.45): 현재 단계 제목.
- **Body** (14px, line-height 1.45): 작업영역 기본.
- **Label** (600, 12px): 기본입력 필드·보조 조작. 단계 메뉴는 넓은 화면에서 13px.
- **Caption** (11px): 단계 설명·정보 띠·저장 및 출력 보조 정보.
- **Print** (9pt, line-height 1.5): 일반 A4 표 렌더러. 원본 템플릿의 셀별 서식은 별도 출력 코드의 실제 값을 따른다.

**The Number Meaning Rule.** 금액은 원 단위 쉼표와 우측 정렬, 표 숫자는 tabular-nums를 사용한다. 자료 없음의 —를 숫자 0으로 바꾸지 않는다.

## Layout

전용 section이 기존 앱 본문에 들어간다. 외부 편집 모달이 아니다. 상단 제목 → 6단계 메뉴 → 산출서 정보 띠 → 저장 도구 모음과 하단 계산 요약은 데스크톱 작업영역의 고정 chrome이고, 중앙 작업 부분이 스크롤된다. 단계 버튼은 React 로컬 상태 전환이며 클릭 자체는 저장·계산이나 페이지 이동이 아니다. 작업영역 높이는 실제 상단 위치를 측정해 맞추며 하한은 520px이다. 넓게 보기는 이 ES 화면에서만 기존 사이드바를 숨기고 복구한다.

기본입력은 5개 원본 구역과 적용자료 보조 표의 2열 구조다. 현재 격자는 minmax(0,1.35fr) / minmax(340px,1fr), 간격 18px이다. 검토표는 가변 표 / 250px 선택 비목 상세로 나뉘며 1250px 이하에서 상세 폭이 220px로 줄어든다. 원자료 비교 표는 최소 폭 650px와 내부 가로 스크롤을 유지한다.

출력은 왼쪽 시트 목록(210px), 가운데 A4 미리보기, 오른쪽 인쇄 설정(180px)이다. 두 겹의 grid가 이 3영역을 구성한다. 1100px 이하에서는 왼쪽 목록 폭이 220px이며, 800px 이하에서는 목록·미리보기가 단일 열로 바뀌고 인쇄 설정은 A4 위로 이동한다. A4는 실제 210mm × 297mm이고 화면 확대만 별도로 적용한다.

반응형 기준은 기존 CSS를 따른다. 1250px 이하에서는 단계 설명을 숨기고 메뉴를 압축한다. 1100px 이하에서는 기본입력을 단일 열로 배치한다. 800px 이하에서 단계 메뉴는 3열 × 2행, 상세 패널은 표 아래, 시트 선택은 2열이 된다. 600px 이하에서는 문서 전체 흐름으로 스크롤하고 단계 메뉴는 상단 sticky, 요약 띠는 하단 sticky가 된다. 기본입력 container query는 1150px / 650px / 380px에서 필드 열 수·레이블 배치를 조정한다. coarse pointer에서는 일반 버튼·입력·select에 최소 높이 44px를 적용한다.

## Elevation & Depth

주 작업영역은 평평하다. 테마의 중립 바탕색과 1px 구분선으로 정보 영역을 나누고, 사용 중인 단계·행은 배경색으로 표시한다. 일반 카드의 공용 그림자 규칙을 이 ES 작업영역에 이식하지 않는다.

### Shadow Vocabulary

- **확인 대화상자** (`box-shadow: 0 18px 60px #12253c55`): Excel 가져오기와 원자료 적용 전 확인용 native dialog. 배경막은 `#12253c99`이다.

**The Flat Workbench Rule.** 주 작업영역과 도구 모음은 그림자 없이 구분선·바탕색으로 나눈다. 확인용 native dialog의 부유 그림자를 주 작업영역에 복제하지 않는다.

## Shapes

주 작업영역·도구 모음·선택 비목 상세·출력 시트 행은 각진 업무면이다. 버튼은 6px, 입력은 5px, 표 외곽은 7px, 확인 대화상자는 10px의 작은 곡률을 사용한다. 표 내부는 collapse된 선으로 이어진다. 메뉴 아이콘은 24 × 24 viewBox의 단색 선형 SVG이며 일반 크기 22px, 넓은 화면 제목 아이콘은 30px다. 새 아이콘 폰트나 이미지 장식은 사용하지 않는다.

## Components

### Buttons

평평하고 명확한 실행 도구. 기본 padding은 6px 12px, 최소 높이는 36px이며 주요 도구 모음은 12px 글자다. 주요 동작은 업무 청색, 보조 동작은 테마 작업면과 얇은 경계다. 도구 모음·제목·다음 동작의 보조 hover는 선택 청백색과 청색 테두리, 주요 도구 모음 hover는 짙은 업무 청색이다. disabled는 opacity .55와 not-allowed cursor다. 키보드 focus-visible은 3px 청색 outline, offset 2px다.

### Inputs / Fields

수동 데이터와 조회·선택 조작을 구분한다. 기본 필드는 7px 9px padding, 최소 높이 36px, 1px 테두리다. 금액은 우측 정렬하고 수정 전후 쉼표 표시를 유지한다. 일반 textarea는 최소 높이 80px, 기간 원자료 메모는 66px다. 기본입력의 추가 계약정보, 검색·검토기간 선택·인쇄 페이지와 확대 설정은 중립 작업면이다. readonly/disabled 데이터 필드는 중립 보조면이다. --field-bg가 공용 테마의 !important 규칙을 통과하는 실제 연결점이므로 단순 background 선언으로 역할 색을 덮어쓰지 않는다.

### Navigation

기본입력 → 비목·적용대가 → 지수·요율 → 선금·공제 → 계산검토 → 출력물의 6개 버튼이다. 각 단계는 SVG·번호·이름과 넓은 화면의 한 줄 설명을 갖는다. aria-current=page가 현재 로컬 단계를 표시한다. 데스크톱 기본 최소 높이 62px, padding 8px 10px이며 화면이 좁아지면 축약된다. URL 이동이나 완료 단계 배지는 아니다.

### Chips / Status

단계 제목의 초안 표시는 각진 작은 레이블이며 5px 8px padding이다. 저장 상태는 별도 텍스트로 저장되지 않은 변경·처리 중·저장됨 vN을 구분한다. 상태 색만으로 저장 완료나 공식 검수를 증명하지 않는다.

### Cards / Containers

일반적인 카드 묶음이 아니라 중립 보조 작업면이다. 선택 비목 상세는 14px padding, 상단 12px sticky 위치, 구분선과 이름·원본 셀·금액·계산 근거를 갖는다. 800px 이하에서는 sticky를 해제한다. 금액 수정은 해당 비목의 입력으로 돌아가며, 기간 메모는 접힌 상세에서 확인한다.

### Sheet selection and A4 preview

시트 선택은 체크박스·시트명·설명의 행으로 표현하며 선택 행은 연한 청색이다. 17개 시트 선택과 실제 페이지 지정은 서로 다르다. 미리보기는 저장·계산본 revision이 현재 저장본과 일치하고 수정 사항이 없을 때 열리며, 페이지 확인 후 인쇄/PDF 버튼을 사용할 수 있다. 화면 확대는 fit / 100% / 125% / 150%다. 인쇄창 종료 메시지는 인쇄 성공 확인이 아니다. 미리보기 페이지의 초안·revision 표시는 보존한다.

### Confirmation dialogs

Excel 가져오기와 원자료 조회 적용은 기존 native dialog를 사용한다. 취소는 기존 입력을 유지한다. Excel 확인은 저장으로 이어지고, 원자료 확인은 입력에 적용된 뒤 사용자가 저장·계산한다. 이 제한된 확인 흐름을 전체 ES 편집 모달로 확대하지 않는다.

## Do's and Don'ts

### Do:

- Do ES 전용 작업영역 안에서만 이 문서의 밀도·색·배치를 적용한다.
- Do 원본 셀 좌표, 숫자 단위, 선택 상태, 저장 상태를 함께 읽을 수 있게 유지한다.
- Do 조회·가져오기는 적용 전 확인과 취소 시 기존 입력 유지 동작을 보존한다.
- Do 키보드 포커스, disabled 상태, 작은 화면의 내부 표 스크롤을 확인한다.

### Don't:

- Don't 6단계 전환을 새 URL 이동이나 자동저장 완료 표시로 해석하지 않는다.
- Don't 화면 계산값을 저장·계산본 또는 공식 제출 승인 결과로 표시하지 않는다.
- Don't 기간 출처 메모를 각 비목의 검증된 공식 인용으로 격상하지 않는다.
- Don't 건강보험 외 노임·재료 자동수집이나 미지원 차수·신규비목을 연결 완료로 표시하지 않는다.
- Don't 미리보기 확대율을 실제 A4 인쇄 배율이나 인쇄 성공 확인으로 취급하지 않는다.

출처: apps/web/src/es/EsStudio.tsx, EsStudio.css, EsPrintPreview.tsx 및 apps/web/src/theme-system.css. 공용 packages/ui/src/tokens.ts와 docs/stitch/design-tokens.json은 상위 시스템 자료이며 ES의 최종 CSS override를 대체하지 않는다. 승인 범위는 PRODUCT.md와 docs/CF130_ES_WORKBENCH.md를 따른다. 초기 최종 스크린샷에서 발견된 조회·인쇄 설정의 입력색은 마지막 --field-bg 수정 기준으로 기록했다. 배포·실프린터 성공 여부는 이 디자인 추출 문서의 검증 범위가 아니다.

.impeccable/design.json의 tonalRamp는 패널 표시용으로 합성한 색 견본이며 구현에 새로 도입한 색 토큰이 아니다. 컴포넌트 HTML/CSS는 현재 구현의 외형·상태를 재현하는 독립 예제이며 앱 API·계산·저장 이벤트를 구현하지 않는다.
