import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@claim-studio/ui';
import { apiRequest } from '../api';

interface ReportListItem {
  id: string;
  title: string;
  version: number;
  updatedAt: string;
  templateName: string;
  templateVersion: number | null;
  sectionCount: number;
  requiredSectionCount: number;
  approvedSectionCount: number;
  finalized: boolean;
  outputFormats: string[];
  case: { id: string; caseNumber: string; title: string; claimType: string; status: string };
}

const statusLabel: Record<string, string> = {
  INQUIRY: '문의', PROPOSAL: '제안', ESTIMATE: '견적', CONTRACT: '계약', MATERIAL_RECEIVED: '자료접수',
  ANALYSIS: '분석', REPORT_DRAFTING: '보고서 작성', SUBMITTED: '제출', LITIGATION: '소송 진행',
  JUDGEMENT: '판결', SUCCESS_FEE: '성공보수', CLOSED: '종결'
};

export function ReportList({ onNavigate }: { onNavigate: (path: string) => void }): React.ReactElement {
  const [reports, setReports] = useState<ReportListItem[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (nextQuery = query) => {
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest<{ reports: ReportListItem[] }>(`/api/reports?q=${encodeURIComponent(nextQuery.trim())}`);
      setReports(result.reports);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => { void load(); }, []);

  const summary = useMemo(() => ({
    active: reports.filter((report) => !report.finalized).length,
    finalized: reports.filter((report) => report.finalized).length,
    ready: reports.filter((report) => report.sectionCount > 0 && report.approvedSectionCount === report.sectionCount).length
  }), [reports]);

  return (
    <div className="report-list-page">
      <section className="workspace-hero">
        <div>
          <span className="workspace-eyebrow">REPORT WORKSPACE</span>
          <h3>보고서 작성 현황을 한곳에서 관리하세요</h3>
          <p>사건별 목차 승인 진행률을 확인하고 보고서 스튜디오, 최종 확정, DOCX·PDF 출력으로 이어집니다.</p>
        </div>
        <Button onClick={() => onNavigate('/templates')}>템플릿에서 새 보고서 만들기</Button>
      </section>

      <div className="report-summary-grid" aria-label="보고서 현황 요약">
        <div><span>전체 보고서</span><strong>{reports.length}</strong></div>
        <div><span>작성·검토 중</span><strong>{summary.active}</strong></div>
        <div><span>승인 완료</span><strong>{summary.ready}</strong></div>
        <div><span>최종 확정</span><strong>{summary.finalized}</strong></div>
      </div>

      <Card title="보고서 검색">
        <form className="inline-form" onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <Input label="보고서명·사건명·사건번호" value={query} placeholder="검색어를 입력하세요" onChange={(event) => setQuery(event.target.value)} />
          <Button type="submit">검색</Button>
          {query && <Button type="button" variant="secondary" onClick={() => { setQuery(''); void load(''); }}>초기화</Button>}
        </form>
      </Card>

      {error && <div className="error-box" role="alert">{error}</div>}
      {loading ? <div className="report-list-loading" role="status">보고서 작업공간을 불러오는 중입니다.</div> : reports.length === 0 ? (
        <section className="report-empty-state">
          <strong>표시할 보고서가 없습니다.</strong>
          <p>ACTIVE 템플릿에서 사건 보고서를 생성하면 이곳에 표시됩니다.</p>
          <Button onClick={() => onNavigate('/templates')}>템플릿 카탈로그 열기</Button>
        </section>
      ) : (
        <div className="report-workspace-grid">
          {reports.map((report) => {
            const percent = Math.round((report.approvedSectionCount / Math.max(1, report.sectionCount)) * 100);
            return (
              <article className="report-workspace-card" key={report.id}>
                <header>
                  <div>
                    <span className="report-case-number">{report.case.caseNumber} · {report.case.claimType}</span>
                    <h4 title={report.title}>{report.title}</h4>
                    <p>{report.case.title}</p>
                  </div>
                  <span className={`report-state-badge ${report.finalized ? 'is-final' : percent === 100 ? 'is-ready' : ''}`}>
                    {report.finalized ? '최종 확정' : percent === 100 ? '승인 완료' : statusLabel[report.case.status] ?? report.case.status}
                  </span>
                </header>
                <div className="report-template-line">{report.templateName}{report.templateVersion ? ` · v${report.templateVersion}` : ''}</div>
                <div className="report-progress-label"><span>장 승인 진행률</span><strong>{report.approvedSectionCount}/{report.sectionCount}</strong></div>
                <div className="report-progress" aria-label={`장 승인 진행률 ${percent}%`}><span style={{ width: `${percent}%` }} /></div>
                <footer>
                  <div className="report-file-badges">
                    {report.outputFormats.length ? report.outputFormats.map((format) => <span key={format}>{format}</span>) : <span>출력 대기</span>}
                  </div>
                  <Button onClick={() => onNavigate(`/cases/${encodeURIComponent(report.case.id)}/reports/${encodeURIComponent(report.id)}/studio`)}>스튜디오 열기</Button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
