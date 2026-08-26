import React from 'react';

type PublicPageKind = 'about' | 'privacy' | 'terms';

interface PublicOAuthPagesProps {
  page: PublicPageKind;
}

const APP_NAME = '클레임센터 스튜디오';
const SUPPORT_EMAIL = 'concost0010@gmail.com';

const PublicHeader: React.FC = () => (
  <header className="public-oauth-header">
    <a className="public-oauth-brand" href="/about" aria-label={`${APP_NAME} 소개 페이지`}>
      <span aria-hidden="true"><img src="/assets/claim-center-emblem.png" alt="" /></span>
      <div><strong>{APP_NAME}</strong><small>CLAIM CENTER STUDIO</small></div>
    </a>
    <nav aria-label="공개 안내 페이지">
      <a href="/about">서비스 소개</a>
      <a href="/privacy">개인정보처리방침</a>
      <a href="/terms">서비스 약관</a>
      <a className="public-oauth-login" href="/login">로그인</a>
    </nav>
  </header>
);

const PublicFooter: React.FC = () => (
  <footer className="public-oauth-footer">
    <div><strong>CONCOST · {APP_NAME}</strong><span>건설 클레임 프로젝트 업무지원 시스템</span></div>
    <nav aria-label="법적 고지">
      <a href="/about">서비스 소개</a>
      <a href="/privacy">개인정보처리방침</a>
      <a href="/terms">서비스 약관</a>
    </nav>
    <small>문의: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></small>
  </footer>
);

const AboutPage: React.FC = () => (
  <>
    <section className="public-oauth-hero">
      <div>
        <span>CLAIM EVIDENCE · WORKFLOW · REPORT</span>
        <h1>복잡한 건설 클레임 업무를<br />하나의 흐름으로 관리합니다.</h1>
        <p>{APP_NAME}는 프로젝트 의뢰와 제안서, 일정, 회의록, 현장자료, 보고서 작성 및 검토·승인을 연결하는 CONCOST의 업무지원 웹 애플리케이션입니다.</p>
        <div className="public-oauth-actions"><a href="/login">클레임센터 로그인</a><a href="/privacy">데이터 처리 방식 보기</a></div>
      </div>
      <aside aria-label="주요 기능">
        <article><b>01</b><strong>프로젝트 업무 연결</strong><p>접수부터 일정·현장조사·물량산출·납품까지 단계별 기록을 관리합니다.</p></article>
        <article><b>02</b><strong>AI 문서 작성 보조</strong><p>사용자가 제공한 회의록과 근거자료를 바탕으로 초안을 만들고 사람이 검수·수정합니다.</p></article>
        <article><b>03</b><strong>Google Drive 보관</strong><p>승인된 사용자가 선택한 자료와 산출물을 회사 Drive에 보관합니다.</p></article>
      </aside>
    </section>

    <section className="public-oauth-content public-oauth-summary">
      <div className="public-oauth-eyebrow">GOOGLE USER DATA</div>
      <h2>Google Drive 연결은 필요한 파일에만 사용합니다.</h2>
      <p>앱은 Google의 <code>drive.file</code> 최소 권한을 요청합니다. 이 권한은 앱이 생성했거나 사용자가 앱에서 명시적으로 선택한 파일을 저장·관리하는 데 사용되며, 사용자의 전체 Drive를 임의로 탐색하기 위한 권한이 아닙니다.</p>
      <div className="public-oauth-principles">
        <article><strong>목적 제한</strong><span>업로드 자료와 보고서·제안서 산출물의 저장 및 프로젝트 연결</span></article>
        <article><strong>사용자 통제</strong><span>관리자가 연결을 해제하거나 Google 계정에서 접근 권한을 철회할 수 있음</span></article>
        <article><strong>광고·판매 금지</strong><span>Google 사용자 데이터를 광고에 이용하거나 제3자에게 판매하지 않음</span></article>
      </div>
      <p className="public-oauth-note">자세한 수집·이용·보관 기준은 <a href="/privacy">개인정보처리방침</a>에서 확인할 수 있습니다.</p>
    </section>
  </>
);

const PrivacyPage: React.FC = () => (
  <article className="public-oauth-content public-oauth-document">
    <div className="public-oauth-eyebrow">PRIVACY POLICY</div>
    <h1>개인정보처리방침</h1>
    <p className="public-oauth-lead">CONCOST는 {APP_NAME} 이용자의 개인정보와 Google 사용자 데이터를 안전하고 투명하게 처리합니다.</p>
    <p className="public-oauth-effective">시행일: 2026년 8월 26일</p>

    <section><h2>1. 적용 범위</h2><p>본 방침은 CONCOST가 업무 목적으로 제공하는 {APP_NAME} 웹 애플리케이션에 적용됩니다. 승인된 회사 구성원과 업무상 허가된 사용자만 서비스를 이용할 수 있습니다.</p></section>
    <section><h2>2. 처리하는 정보</h2><ul><li>계정 정보: 아이디, 이름, 업무용 이메일, 소속, 역할 및 접근 권한</li><li>업무 정보: 프로젝트 의뢰, 회의록, 일정, 근거자료, 제안서·보고서와 그 수정·승인 기록</li><li>접속·보안 정보: 로그인 기록, 작업 이력, 오류 기록, 기기·브라우저 및 접속 시각</li><li>Google Drive 연결 정보: OAuth 접근·갱신 토큰, 연결 상태, 앱이 생성했거나 사용자가 앱에서 선택한 파일의 내용과 메타데이터</li></ul></section>
    <section><h2>3. Google 사용자 데이터의 이용</h2><p>Google Drive 데이터는 사용자가 요청한 파일 업로드, 산출물 보관, 프로젝트 자료 연결 및 내려받기를 수행하기 위해서만 사용합니다. 앱은 <code>https://www.googleapis.com/auth/drive.file</code> 권한을 사용합니다.</p><p>Drive 연결만으로 파일을 AI에 자동 전송하지 않습니다. 사용자가 AI 자동작성·개선 기능을 명시적으로 실행한 경우에 한해, 해당 작업에 필요한 선택 자료가 화면에 고지된 AI 처리 기능으로 전달될 수 있습니다.</p></section>
    <section><h2>4. 이용 목적</h2><ul><li>프로젝트 업무의 생성·저장·검색·협업과 권한 관리</li><li>회의록, 제안서 및 보고서 초안 작성과 사람의 검수·승인 지원</li><li>Google Drive 파일 저장·연결 및 산출물 관리</li><li>보안사고 예방, 감사 기록, 장애 대응 및 서비스 개선</li></ul></section>
    <section><h2>5. 보관 및 삭제</h2><p>업무 문서와 기록은 회사의 계약·법령·문서보존 정책에 필요한 기간 동안 보관합니다. Google OAuth 토큰은 연결이 유지되는 동안 암호화하여 보관하고, 관리자가 연결을 해제하거나 권한을 철회하면 더 이상 사용하지 않습니다. 법적 의무나 분쟁 대응을 위해 필요한 정보는 해당 기간 동안 별도로 보관될 수 있습니다.</p></section>
    <section><h2>6. 제3자 제공 및 처리</h2><p>법령상 의무가 있거나 이용자의 명시적 지시가 있는 경우를 제외하고 개인정보를 판매하지 않습니다. 서비스 운영을 위해 Google Cloud·Google Drive, Cloudflare 및 관리자가 설정한 AI 제공자 등 기술 제공자가 제한적으로 정보를 처리할 수 있으며, 필요한 범위와 계약·보안 통제 안에서만 처리합니다.</p></section>
    <section><h2>7. Google API 데이터 정책 준수</h2><p>{APP_NAME}의 Google API 데이터 이용은 Google API Services User Data Policy와 Limited Use 요건을 준수합니다. Google 사용자 데이터를 맞춤형 광고, 신용평가, 판매 또는 무관한 목적에 사용하지 않습니다.</p></section>
    <section><h2>8. 보호 조치</h2><ul><li>전송 구간 암호화와 OAuth 토큰 암호화 저장</li><li>역할 기반 접근통제, 관리자 권한 분리 및 감사로그</li><li>최소 권한 적용, 세션 보호, 입력 검증 및 장애 모니터링</li></ul></section>
    <section><h2>9. 이용자의 선택과 권리</h2><p>사용자는 관리자에게 개인정보 열람·정정·삭제 및 처리 제한을 요청할 수 있습니다. Google 계정의 보안 설정에서 앱 접근 권한을 직접 철회할 수도 있습니다. 권한 철회 후에는 Drive 연동 기능을 사용할 수 없습니다.</p></section>
    <section><h2>10. 문의</h2><p>개인정보 및 Google 사용자 데이터 처리 관련 문의: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p></section>
    <section><h2>11. 방침 변경</h2><p>처리 방식이 변경되면 시행 전에 본 페이지 또는 서비스 내 공지를 통해 알립니다. 중요한 변경은 이용자가 쉽게 확인할 수 있는 방법으로 별도 안내합니다.</p></section>
  </article>
);

const TermsPage: React.FC = () => (
  <article className="public-oauth-content public-oauth-document">
    <div className="public-oauth-eyebrow">TERMS OF SERVICE</div>
    <h1>서비스 이용약관</h1>
    <p className="public-oauth-lead">본 약관은 CONCOST가 제공하는 {APP_NAME}의 이용 조건과 사용자 책임을 정합니다.</p>
    <p className="public-oauth-effective">시행일: 2026년 8월 26일</p>

    <section><h2>1. 서비스 목적</h2><p>{APP_NAME}는 건설 클레임 프로젝트의 의뢰, 제안, 일정, 근거자료, 회의록, 보고서 작성과 승인 업무를 지원하는 회사 업무용 서비스입니다.</p></section>
    <section><h2>2. 계정과 권한</h2><ul><li>회사가 승인한 사용자만 자신의 계정으로 서비스를 이용할 수 있습니다.</li><li>사용자는 인증정보를 안전하게 관리하고 타인에게 계정을 양도하거나 공유해서는 안 됩니다.</li><li>사용자의 역할과 프로젝트 배정에 따라 열람·작성·승인·관리 권한이 제한될 수 있습니다.</li></ul></section>
    <section><h2>3. 사용자 책임</h2><p>사용자는 입력 자료를 적법하게 취득하고 업무상 필요한 범위에서만 사용해야 합니다. 개인정보, 영업비밀, 저작권 자료를 업로드할 때에는 필요한 권한과 보호조치를 확인해야 합니다.</p></section>
    <section><h2>4. AI 작성 보조</h2><p>AI가 생성하거나 개선한 내용은 초안이며 최종 판단이 아닙니다. 사용자는 사실관계, 금액, 법률·기술적 판단, 인용과 문서 형식을 직접 검수하고 승인한 뒤 사용해야 합니다.</p></section>
    <section><h2>5. Google Drive 연결</h2><p>사용자가 Google Drive 연결에 동의하면 앱은 사용자가 선택한 파일과 앱이 생성한 산출물을 저장·관리하기 위해 필요한 최소 권한을 사용합니다. 사용자는 언제든 Google 계정 또는 서비스 관리자에게 연결 해제를 요청할 수 있습니다.</p></section>
    <section><h2>6. 금지 행위</h2><ul><li>권한 없는 프로젝트·개인정보·문서에 접근하거나 접근을 시도하는 행위</li><li>악성코드, 자동화 공격, 서비스 방해 또는 보안 통제를 우회하는 행위</li><li>불법·허위 자료를 입력하거나 타인의 권리를 침해하는 행위</li><li>승인 없이 서비스나 계정, 데이터를 외부에 재판매·재배포하는 행위</li></ul></section>
    <section><h2>7. 서비스 운영</h2><p>보안, 유지보수, 법령 준수 또는 장애 대응을 위해 서비스의 일부가 일시 중단될 수 있습니다. 중대한 장애나 변경은 가능한 범위에서 서비스 내 공지 또는 업무 연락 수단으로 안내합니다.</p></section>
    <section><h2>8. 지식재산권</h2><p>서비스의 소프트웨어, 화면, 상표와 운영 자료에 관한 권리는 CONCOST 또는 정당한 권리자에게 있습니다. 사용자가 적법하게 입력한 회사 업무자료의 권리와 이용 기준은 회사 정책 및 관련 계약을 따릅니다.</p></section>
    <section><h2>9. 책임 범위</h2><p>서비스와 AI 기능은 업무를 보조하며 전문가의 최종 검토를 대체하지 않습니다. 고의 또는 중대한 과실이 없는 한, 검수 없이 사용한 초안이나 외부 서비스의 장애로 발생한 간접 손해에 대한 책임은 관련 법령이 허용하는 범위에서 제한될 수 있습니다.</p></section>
    <section><h2>10. 약관 변경 및 문의</h2><p>약관 변경 시 시행 전에 본 페이지 또는 서비스 내 공지를 통해 알립니다. 서비스 이용 문의: <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a></p></section>
  </article>
);

export const PublicOAuthPages: React.FC<PublicOAuthPagesProps> = ({ page }) => (
  <main className="public-oauth-page" id="main-content">
    <PublicHeader />
    {page === 'about' ? <AboutPage /> : page === 'privacy' ? <PrivacyPage /> : <TermsPage />}
    <PublicFooter />
  </main>
);

