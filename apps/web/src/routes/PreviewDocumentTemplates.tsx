import React from 'react';
import { Button, Card } from '@claim-studio/ui';
import { triggerBrowserDownload } from '../api';
import { proposalStudioWorkbook } from '../proposals/proposal-excel';

interface PreviewDocumentTemplatesProps {
  onNavigate: (path: string) => void;
}

function downloadProposalTemplate(): void {
  const bytes = proposalStudioWorkbook({
    clientName: '', projectTitle: '', subtitle: '', submissionDate: '',
    keyIssues: '', objective: '', planNotes: '', exclusions: ''
  }, '프로젝트 선택 후 제안서 작성 화면에서 연결', '컨코스트 12챕터 제안서');
  const payload = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  triggerBrowserDownload({
    blob: new Blob([payload], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: 'CONCOST_제안서_1단계_입력양식.xlsx'
  });
}

function downloadStaticTemplate(path: string, filename: string): void {
  const anchor = document.createElement('a');
  anchor.href = path;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export const PreviewDocumentTemplates: React.FC<PreviewDocumentTemplatesProps> = ({ onNavigate }) => (
  <main className="document-template-library">
    <header className="document-template-library__hero">
      <span>DOCUMENT FORMS</span>
      <h1>클레임센터 문서 양식</h1>
      <p>내보낸 원본의 숨김 코드와 열 구조는 유지하고 작성칸만 수정하세요. 다시 가져오면 해당 업무 화면에 자동 반영됩니다.</p>
    </header>
    <section className="document-template-library__grid">
      <Card title="제안서 1단계 Excel 입력 양식">
        <p>C열에 클라이언트·제안 목적·핵심 쟁점·수행 계획을 작성합니다. Excel에서 저장한 뒤 제안서 작성의 ‘작성 Excel 가져오기’로 불러옵니다.</p>
        <div className="action-row"><Button onClick={downloadProposalTemplate}>제안서 XLSX 내려받기</Button><Button variant="secondary" onClick={() => onNavigate('/proposals/editor')}>제안서 작성으로</Button></div>
      </Card>
      <Card title="회사 표준 회의록 Excel 양식">
        <p>착수회의·회의록에 가져오면 회의 정보와 후속업무 초안에 연결됩니다. 원본 회사 양식의 시트 구조를 유지하세요.</p>
        <div className="action-row"><Button onClick={() => downloadStaticTemplate('/templates/CONCOST_회의록_양식.xlsx', 'CONCOST_회의록_양식.xlsx')}>회의록 XLSX 내려받기</Button><Button variant="secondary" onClick={() => onNavigate('/workflow/kickoff')}>착수회의로</Button></div>
      </Card>
      <Card title="보고서 HWP·HWPX 원본 연결">
        <p>회사의 기존 HWP/HWPX 보고서를 보고서 작성 3단계에서 연결하고, 웹 편집기에는 외부 LLM 결과 또는 직접 작성한 초안을 붙여넣을 수 있습니다.</p>
        <div className="action-row"><Button onClick={() => onNavigate('/reports/studio')}>보고서 작성으로</Button></div>
      </Card>
    </section>
  </main>
);
