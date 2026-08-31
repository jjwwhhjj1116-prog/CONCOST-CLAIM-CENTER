from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "클레임센터_스튜디오_가오픈_이용안내_2026-08-31.pdf"

NAVY = colors.HexColor("#102A43")
BLUE = colors.HexColor("#1F6FEB")
CYAN = colors.HexColor("#E8F4FF")
TEAL = colors.HexColor("#0F8B7B")
MINT = colors.HexColor("#E9F8F4")
ORANGE = colors.HexColor("#E66A2C")
PEACH = colors.HexColor("#FFF2E8")
INK = colors.HexColor("#172B4D")
MUTED = colors.HexColor("#526777")
LINE = colors.HexColor("#D8E2EC")
PAPER = colors.HexColor("#F7FAFC")
WHITE = colors.white


def register_fonts() -> None:
    regular = Path(r"C:\Windows\Fonts\malgun.ttf")
    bold = Path(r"C:\Windows\Fonts\malgunbd.ttf")
    if not regular.exists() or not bold.exists():
        raise FileNotFoundError("Malgun Gothic fonts are required")
    pdfmetrics.registerFont(TTFont("Malgun", str(regular)))
    pdfmetrics.registerFont(TTFont("MalgunBold", str(bold)))
    pdfmetrics.registerFontFamily("Malgun", normal="Malgun", bold="MalgunBold")


register_fonts()
BASE = getSampleStyleSheet()

styles = {
    "cover_kicker": ParagraphStyle(
        "cover_kicker", parent=BASE["Normal"], fontName="MalgunBold", fontSize=10,
        leading=15, textColor=BLUE, spaceAfter=12, letterSpacing=1.2,
    ),
    "cover_title": ParagraphStyle(
        "cover_title", parent=BASE["Title"], fontName="MalgunBold", fontSize=29,
        leading=39, textColor=NAVY, spaceAfter=14,
    ),
    "cover_subtitle": ParagraphStyle(
        "cover_subtitle", parent=BASE["Normal"], fontName="Malgun", fontSize=12,
        leading=20, textColor=MUTED, spaceAfter=22,
    ),
    "h1": ParagraphStyle(
        "h1", parent=BASE["Heading1"], fontName="MalgunBold", fontSize=20,
        leading=28, textColor=NAVY, spaceAfter=12,
    ),
    "h2": ParagraphStyle(
        "h2", parent=BASE["Heading2"], fontName="MalgunBold", fontSize=13,
        leading=19, textColor=NAVY, spaceBefore=5, spaceAfter=8,
    ),
    "body": ParagraphStyle(
        "body", parent=BASE["BodyText"], fontName="Malgun", fontSize=9.2,
        leading=15.5, textColor=INK, spaceAfter=7,
    ),
    "small": ParagraphStyle(
        "small", parent=BASE["BodyText"], fontName="Malgun", fontSize=8,
        leading=13, textColor=MUTED,
    ),
    "table_head": ParagraphStyle(
        "table_head", parent=BASE["Normal"], fontName="MalgunBold", fontSize=8.5,
        leading=13, textColor=WHITE, alignment=TA_CENTER,
    ),
    "table_body": ParagraphStyle(
        "table_body", parent=BASE["Normal"], fontName="Malgun", fontSize=8.1,
        leading=13, textColor=INK,
    ),
    "card_title": ParagraphStyle(
        "card_title", parent=BASE["Normal"], fontName="MalgunBold", fontSize=10.5,
        leading=16, textColor=NAVY, spaceAfter=4,
    ),
    "card_body": ParagraphStyle(
        "card_body", parent=BASE["Normal"], fontName="Malgun", fontSize=8.5,
        leading=14, textColor=INK,
    ),
    "callout_title": ParagraphStyle(
        "callout_title", parent=BASE["Normal"], fontName="MalgunBold", fontSize=10,
        leading=15, textColor=NAVY, spaceAfter=4,
    ),
    "callout_body": ParagraphStyle(
        "callout_body", parent=BASE["Normal"], fontName="Malgun", fontSize=8.7,
        leading=14, textColor=INK,
    ),
    "center": ParagraphStyle(
        "center", parent=BASE["Normal"], fontName="Malgun", fontSize=9,
        leading=15, textColor=MUTED, alignment=TA_CENTER,
    ),
}


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, styles[style])


def bullet(text: str, tone: colors.Color = BLUE) -> Table:
    marker = Paragraph("■", ParagraphStyle("bulletmark", fontName="MalgunBold", fontSize=6.5, leading=13, textColor=tone))
    table = Table([[marker, p(text, "body")]], colWidths=[5 * mm, 165 * mm])
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))
    return table


def callout(title: str, body: str, background: colors.Color = CYAN, accent: colors.Color = BLUE) -> Table:
    content = [p(title, "callout_title"), p(body, "callout_body")]
    table = Table([[content]], colWidths=[170 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.8, accent),
        ("LINEBEFORE", (0, 0), (0, 0), 4, accent),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    return table


def card(title: str, body: str, background: colors.Color = WHITE) -> Table:
    table = Table([[[p(title, "card_title"), p(body, "card_body")]]], colWidths=[82 * mm])
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background),
        ("BOX", (0, 0), (-1, -1), 0.7, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return table


def two_cards(left: Table, right: Table) -> Table:
    table = Table([[left, right]], colWidths=[85 * mm, 85 * mm], hAlign="LEFT")
    table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (0, 0), 0),
        ("RIGHTPADDING", (0, 0), (0, 0), 3),
        ("LEFTPADDING", (1, 0), (1, 0), 3),
        ("RIGHTPADDING", (1, 0), (1, 0), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    return table


def data_table(headers: list[str], rows: list[list[str]], widths: list[float]) -> Table:
    body = [[p(item, "table_head") for item in headers]]
    body.extend([[p(item, "table_body") for item in row] for row in rows])
    table = Table(body, colWidths=[value * mm for value in widths], repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 7),
        ("RIGHTPADDING", (0, 0), (-1, -1), 7),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]
    for index in range(1, len(body)):
        if index % 2 == 0:
            style.append(("BACKGROUND", (0, index), (-1, index), PAPER))
    table.setStyle(TableStyle(style))
    return table


def page_header_footer(canvas, doc) -> None:
    canvas.saveState()
    width, height = A4
    if doc.page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(20 * mm, height - 15 * mm, width - 20 * mm, height - 15 * mm)
        canvas.setFont("MalgunBold", 7.5)
        canvas.setFillColor(NAVY)
        canvas.drawString(20 * mm, height - 11 * mm, "CLAIM CENTER STUDIO · 가오픈 회원 안내")
        canvas.setFont("Malgun", 7)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(width - 20 * mm, height - 11 * mm, "2026-08-31")
    canvas.setStrokeColor(LINE)
    canvas.line(20 * mm, 14 * mm, width - 20 * mm, 14 * mm)
    canvas.setFont("Malgun", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(20 * mm, 9 * mm, "가오픈 안내 · AI 결과와 최종 산출물은 반드시 담당자가 검수합니다.")
    canvas.drawRightString(width - 20 * mm, 9 * mm, f"{doc.page}")
    canvas.restoreState()


story = []

# Cover
story.extend([
    Spacer(1, 18 * mm),
    p("CONCOST · CLAIM INTELLIGENCE WORKSPACE", "cover_kicker"),
    p("클레임센터 스튜디오<br/>가오픈 이용 안내", "cover_title"),
    p("프로젝트 의뢰부터 제안·접수, 일정, 회의, 산출, 보고서 협업, 납품 자료와 인맥관리까지 연결하는 클레임 업무 워크스페이스입니다.", "cover_subtitle"),
    callout(
        "가오픈 운영 기준",
        "2026년 8월 31일까지 확정한 기능을 가오픈 서버와 테스트 서버에 동일하게 반영합니다. 2026년 9월 1일부터 신규 수정은 테스트 서버에서 먼저 검증한 뒤 정식 반영합니다.",
        MINT, TEAL,
    ),
    Spacer(1, 10 * mm),
    two_cards(
        card("현재 서비스", "Cloudflare 기반 가오픈 환경에서 회원이 실제 업무 흐름을 사용하고 의견을 전달합니다.", CYAN),
        card("업데이트 주기", "가오픈 기간에는 수정사항을 모아 주 1회 안내합니다. 긴급 보안·데이터 오류는 별도 공지 후 우선 대응합니다.", PEACH),
    ),
    Spacer(1, 25 * mm),
    p("배포 기준일  2026.08.31", "center"),
    p("문서 버전  GAOPEN GUIDE V1.0", "center"),
    PageBreak(),
])

# Page 2
story.extend([
    p("1. 처음 보는 업무 흐름", "h1"),
    p("승인된 회원은 조직의 같은 프로젝트 원장을 보며 아래 순서로 업무를 이어갑니다. 프로젝트를 선택한 뒤 각 단계의 저장 상태와 다음 할 일을 확인해 주세요."),
    data_table(
        ["단계", "회원이 하는 일", "남는 결과"],
        [
            ["1 · 의뢰", "클라이언트 지위, 사건 설명, 원본 자료를 등록하고 AI 정리 결과를 검수", "조직 공용 프로젝트 의뢰"],
            ["2 · 제안", "템플릿과 근거를 선택해 제안서 초안을 만들고 담당자가 편집·확정", "프로젝트별 제안서 버전"],
            ["3 · 수주·접수", "수주 확정, 수정 또는 취소를 기록하고 실제 수행 프로젝트로 전환", "접수 이력과 수행 기간"],
            ["4 · 일정·착수", "담당 PM과 1~6단계 일정을 저장하고 착수회의를 정리", "통합 일정과 회의록"],
            ["5 · 현장·산출", "현장 사진·녹음·문서와 산출서·내역서를 프로젝트에 연결", "Drive 원본과 산출 근거"],
            ["6 · 보고서", "PM 초안, 챕터 담당 배정, 담당자 검수, PM 반영, 최종 승인", "검수 이력이 있는 최종 보고서"],
            ["7 · 납품·보관", "최종 납품본과 Drive 저장 상태를 확인하고 완료 프로젝트를 보관", "납품완료 표시와 감사 이력"],
        ],
        [25, 90, 55],
    ),
    Spacer(1, 7 * mm),
    callout(
        "공유 원칙",
        "프로젝트 의뢰, 제안서, 수주·접수 목록과 활성 프로젝트 일정은 승인 회원 모두가 같은 조직 기준으로 조회합니다. 조회가 공유되어도 일정 수정, 챕터 배정, 완료 프로젝트 보관 같은 중요 변경 권한은 담당 PM 또는 관리자에게만 주어집니다.",
    ),
    PageBreak(),
])

# Page 3
story.extend([
    p("2. 현재 제공하는 주요 기능", "h1"),
    two_cards(
        card("프로젝트 의뢰·제안·접수", "전 회원 공용 목록, 의뢰 원문과 첨부자료 연결, 제안서 단계별 작성, 수주 확정·수정·취소 이력, DB 관리 원장을 제공합니다."),
        card("통합 일정표", "월 표시와 하단 가로 스크롤로 완료월까지 확인합니다. 토요일은 하늘색, 일요일은 분홍색으로 구분하고 한국·베트남 휴일을 함께 표시합니다."),
    ),
    Spacer(1, 5 * mm),
    two_cards(
        card("착수회의·현장조사", "회사 회의록 양식 또는 원문을 가져오고, 수동 메모를 저장한 뒤 Gemini 정리 결과를 우측 최종본에서 검수합니다. 현장조사도 동일한 원칙으로 기록합니다."),
        card("물량산출·내역", "산출 범위, 기준, 투입 팀 일정을 저장하고 Excel 산출서·내역서와 프로젝트 자료를 보고서 근거로 연결합니다."),
    ),
    Spacer(1, 5 * mm),
    two_cards(
        card("보고서 작성", "템플릿·목차·챕터 초안·담당자 검수·최종 편집 순서입니다. Ctrl+S, 자동저장, Ctrl+Z로 편집본을 보호하고 HWP·DOCX·PDF 산출물을 제공합니다."),
        card("검토·납품·품질", "작성자와 다른 검토자의 의견, 최종 승인, 납품본, 결과와 감사 이력을 연결합니다. 납품완료 프로젝트는 일정표에서 명확히 표시합니다."),
    ),
    Spacer(1, 7 * mm),
    p("자료 저장 방식", "h2"),
    bullet("원본 파일은 회사 Google Drive의 클레임센터 전용 구조에 저장합니다."),
    bullet("D1 데이터베이스에는 검색 정보, 파일 ID, SHA-256 해시, 업로더, 저장 시각과 변경 이력을 남깁니다."),
    bullet("자료실에는 접수되어 프로젝트 워크로 전환된 활성 프로젝트만 표시합니다."),
    bullet("DB관리의 삭제는 기록을 바로 없애는 물리 삭제가 아니라 보관·감사 이력을 남기는 방식이 기본입니다."),
    PageBreak(),
])

# Page 4
story.extend([
    p("3. 보고서 협업은 이렇게 사용합니다", "h1"),
    p("전체 초안의 책임과 챕터 협업을 분리해, 여러 회원이 동시에 참여해도 최종 본문이 임의로 덮어써지지 않도록 구성했습니다."),
    data_table(
        ["역할", "가능한 작업", "제한"],
        [
            ["담당 PM", "템플릿·목차 확인, 전체 초안 작성, 챕터별 담당 지정·수정, 검수 완료 챕터 반영", "프로젝트 전체 품질과 최신본 책임"],
            ["챕터 담당자", "배정받은 챕터 작성·저장, 내용 검수, 검수 완료 표시", "배정받지 않은 챕터와 전체 본문은 수정 불가"],
            ["관리자", "PM과 동일한 관리, 권한·감사 확인", "업무 책임자를 대신하는 일상 편집은 최소화"],
            ["최종 검토자", "제출 버전과 근거 확인, 수정 요청 또는 승인", "작성자와 분리된 검토 원칙"],
        ],
        [28, 92, 50],
    ),
    Spacer(1, 7 * mm),
    p("권장 순서", "h2"),
    bullet("1. PM이 프로젝트 자료와 템플릿을 확인하고 목차와 초안을 준비합니다.", TEAL),
    bullet("2. PM이 각 챕터의 담당 회원을 지정합니다. 지정된 회원은 프로젝트 접근 권한을 함께 받습니다.", TEAL),
    bullet("3. 담당자는 자기 챕터를 저장하고 검수 완료로 제출합니다.", TEAL),
    bullet("4. PM은 검수 완료 챕터의 최신 버전을 전체 보고서에 반영합니다.", TEAL),
    bullet("5. 전체본을 저장하고 담당자 검수·최종 승인 후 문서로 출력합니다.", TEAL),
    Spacer(1, 6 * mm),
    callout(
        "충돌 안내가 보이면",
        "다른 화면에서 먼저 저장된 최신 데이터가 있다는 뜻입니다. 기존 내용을 억지로 덮어쓰지 말고 최신본을 다시 불러온 뒤 본인의 수정 내용을 재확인해 저장하세요.",
        PEACH, ORANGE,
    ),
    PageBreak(),
])

# Page 5
story.extend([
    p("4. 인맥관리·명함등록", "h1"),
    p("명함 자동등록은 단순 OCR 결과를 바로 저장하지 않습니다. Gemini 멀티모달 인식과 사람 확인을 결합해 업무에 쓸 수 있는 연락처로 등록합니다."),
    data_table(
        ["순서", "처리 내용", "확인할 점"],
        [
            ["1 · 촬영·선택", "모바일 카메라 또는 JPG·PNG·WEBP 이미지 선택", "반사, 심한 기울어짐, 잘린 글자 확인"],
            ["2 · Gemini 인식", "이름, 회사, 부서, 직함, 휴대전화, 전화, 팩스, 이메일, 주소, 웹사이트를 구조화", "AI 인식 정확도는 이미지 상태와 글꼴에 따라 달라짐"],
            ["3 · 사람 확인", "인식값을 원본 명함과 대조하고 직접 수정", "이메일과 숫자는 한 글자씩 확인"],
            ["4 · 등록", "원본 이미지는 회사 Drive에 저장하고 검색 정보와 감사 이력은 D1에 등록", "등록 버튼은 확인 후 실행"],
            ["5 · 검색·관리", "이름·회사·부서·직함·전화·이메일·태그 검색", "명함 DB관리의 보관·복원은 관리자만 가능"],
        ],
        [25, 95, 50],
    ),
    Spacer(1, 7 * mm),
    callout(
        "중요: AI 결과는 보조 초안입니다",
        "특수 글꼴, 작은 문자, 빛 반사와 외국어 표기에서 오류가 생길 수 있습니다. 인식률을 고정 수치로 보장하지 않으며, 사람 확인 없이 연락처를 확정하지 않습니다.",
        PEACH, ORANGE,
    ),
    Spacer(1, 7 * mm),
    two_cards(
        card("일반 회원", "명함등록, 인식값 수정, 인맥 목록 검색과 Drive 원본 확인"),
        card("관리자", "일반 회원 기능과 함께 명함 DB관리, 보관·복원, 감사 이력 확인"),
    ),
    PageBreak(),
])

# Page 6
story.extend([
    p("5. 가오픈 이용 시 주의사항", "h1"),
    callout(
        "가오픈은 실제 이용과 검증을 함께 진행하는 기간입니다",
        "업무 데이터는 저장되지만 모든 예외 환경과 외부 서비스 조합이 검증된 것은 아닙니다. 중요한 원본과 최종 납품본은 Drive 저장 여부를 함께 확인해 주세요.",
        PEACH, ORANGE,
    ),
    Spacer(1, 7 * mm),
    data_table(
        ["영역", "현재 주의할 점", "권장 행동"],
        [
            ["AI 작성", "사실·수치·법률 판단을 자동 확정하지 않음", "원문 근거와 대조하고 담당자가 최종 검수"],
            ["HWP·DOCX", "PC 프로그램·뷰어 버전에 따라 표·글꼴·페이지 배치 차이가 생길 수 있음", "다운로드 후 실제 프로그램에서 내용과 페이지 확인"],
            ["Google Drive", "OAuth, 회사 계정, API 연결이 끊기면 업로드가 완료되지 않음", "화면의 Drive 저장 표시와 원본 링크 확인"],
            ["동시 작업", "완전한 실시간 공동 커서·병합은 단계적 고도화 중", "저장 전 최신본 확인, 충돌 시 다시 불러오기"],
            ["일정", "월을 넘는 일정은 하단 가로 스크롤로 이동해야 함", "월 제목과 시작·종료일을 함께 확인"],
            ["완료 보관", "납품완료 표시만으로 모든 파일 보관이 끝난 것은 아님", "PM·관리자가 Drive 체크리스트 확인 후 보관"],
        ],
        [27, 86, 57],
    ),
    Spacer(1, 7 * mm),
    p("오류를 발견했을 때 전달할 정보", "h2"),
    bullet("발생 시각, 사용한 계정의 역할, 프로젝트 번호와 현재 화면"),
    bullet("어떤 버튼을 어떤 순서로 눌렀는지와 화면에 표시된 오류 문구"),
    bullet("개인정보·API 키·비밀번호를 가린 스크린샷"),
    bullet("다운로드 오류라면 파일 형식과 사용한 프로그램·뷰어 버전"),
    PageBreak(),
])

# Page 7
story.extend([
    p("6. 향후 개발·고도화 계획", "h1"),
    p("아래 항목은 현재 제공 기능과 구분되는 개발 예정 범위입니다. 외부 기관·메인 서버·상용 API 협의 결과에 따라 순서와 범위가 조정될 수 있습니다."),
    two_cards(
        card("법원 자료 연동", "법원 사건·기일·제출기한을 더 구체적으로 연결하고 공식 출처 검증 절차를 강화합니다.", CYAN),
        card("소송 일정 고도화", "프로젝트 일정과 소송 일정의 연결, 알림, 담당자별 마감 관리와 변경 이력을 구체화합니다.", CYAN),
    ),
    Spacer(1, 5 * mm),
    two_cards(
        card("메인 서버·기억 구조", "메인 서버 연결 후 승인된 근거와 피드백을 단기·장기 기억으로 분리해, 같은 유형 보고서의 일관성과 품질을 높입니다.", MINT),
        card("실시간 공동편집", "Yjs/Hocuspocus 기반 동시편집, 접속자 표시, 충돌 감소, 챕터 단위 공동 작업 경험을 고도화합니다.", MINT),
    ),
    Spacer(1, 5 * mm),
    two_cards(
        card("문서 호환성", "HWP·DOCX 가져오기·내보내기, 표·이미지·페이지 배치의 프로그램별 호환성을 계속 검증합니다.", PEACH),
        card("부서별 Drive 권한", "기술본부, 클레임센터, 경영지원본부, 개발팀 폴더와 접근 정책을 조직 계정 체계에 맞게 확장합니다.", PEACH),
    ),
    Spacer(1, 7 * mm),
    bullet("이메일 발송 서버 연결과 승인·납품 알림 자동화"),
    bullet("사용 기록 기반 품질 측정, 오류 모니터링과 관리자 진단 화면"),
    bullet("모바일 화면과 대용량 자료 업로드 경험 개선"),
    PageBreak(),
])

# Page 8
story.extend([
    p("7. 업데이트·지원 운영", "h1"),
    p("가오픈 기간에는 사용자의 실제 업무 피드백을 모아 안정적으로 반영합니다. 변경사항은 기능 이름만 나열하지 않고 사용자가 무엇을 다시 확인해야 하는지 함께 안내합니다."),
    data_table(
        ["구분", "운영 원칙"],
        [
            ["정기 업데이트", "수정사항을 모아 주 1회 배포·공지"],
            ["검증 순서", "2026년 9월 1일부터 테스트 서버 우선 적용 - 자동 테스트와 브라우저 검수 - 확인 후 가오픈·운영 반영"],
            ["긴급 수정", "로그인, 데이터 유실 위험, 권한 노출, 저장 실패 같은 중대 문제는 정기 주기와 별도로 우선 대응"],
            ["변경 안내", "추가 기능, 수정 오류, 영향 화면, 회원이 확인할 항목을 함께 제공"],
            ["데이터 원칙", "DB 구조 변경은 migration으로 적용하고 기존 D1/SQLite 데이터를 삭제하지 않음"],
        ],
        [35, 135],
    ),
    Spacer(1, 8 * mm),
    callout(
        "회원 여러분께 부탁드립니다",
        "가오픈 중 발견한 문제는 실패가 아니라 정식 운영 품질을 높이기 위한 핵심 검증 자료입니다. 오류가 반복될 수 있는 순서를 구체적으로 알려주시면 더 빠르고 정확하게 수정할 수 있습니다.",
        MINT, TEAL,
    ),
    Spacer(1, 12 * mm),
    p("빠른 확인 체크리스트", "h2"),
    bullet("로그인 후 내 역할과 이름이 맞는지 확인"),
    bullet("의뢰·제안·접수 및 일정 목록이 다른 승인 회원과 같은지 확인"),
    bullet("프로젝트를 선택한 뒤 저장 상태와 Drive 저장 표시 확인"),
    bullet("AI 결과를 원본과 대조하고 최종 출력 파일을 실제 프로그램에서 열어 확인"),
    bullet("문제가 있으면 프로젝트 번호와 재현 순서를 함께 전달"),
    Spacer(1, 14 * mm),
    p("클레임센터 스튜디오 · 더 명확한 근거와 하나의 업무 흐름", "center"),
])


def build() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4,
        rightMargin=20 * mm, leftMargin=20 * mm,
        topMargin=21 * mm, bottomMargin=19 * mm,
        title="클레임센터 스튜디오 가오픈 이용 안내",
        author="CONCOST Claim Center Studio",
        subject="가오픈 주요 기능, 이용 주의사항, 향후 개발 계획, 업데이트 운영 원칙",
    )
    doc.build(story, onFirstPage=page_header_footer, onLaterPages=page_header_footer)
    print(OUTPUT)


if __name__ == "__main__":
    build()
