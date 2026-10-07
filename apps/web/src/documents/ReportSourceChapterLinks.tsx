import { useEffect, useRef, useState } from 'react';

export interface SourceChapterLinkSettings {
  chapters: readonly { id: string; title: string }[];
  disabled: boolean;
  onConfirm: (chapterId: string, page: number | null) => Promise<boolean>;
}
export function ReportSourceChapterLinks({ chapters, disabled, onConfirm, sourceKey, pageCount, connections, onPreview }: SourceChapterLinkSettings & {
  sourceKey: string; pageCount: number; connections: readonly { chapterId: string; page: number }[];
  onPreview: (page: number) => boolean;
}) {
  const [chapterId, setChapterId] = useState(''), [page, setPage] = useState('');
  const [previewed, setPreviewed] = useState<number | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const currentKey = useRef(sourceKey); currentKey.current = sourceKey;
  useEffect(() => { setChapterId(''); setPage(''); setPreviewed(null); setBusy(false); setError(''); setNotice(''); }, [sourceKey]);
  const selected = chapters.find(chapter => chapter.id === chapterId);
  const linked = selected && connections.find(entry => entry.chapterId === chapterId);
  const target = Number(page), validPage = Boolean(page) && Number.isSafeInteger(target) && target >= 1 && target <= pageCount;
  const preview = () => {
    setError(''); setNotice('');
    if (!validPage || !onPreview(target)) { setPreviewed(null); setError('양쪽 원본 쪽을 준비하지 못했습니다. 잠시 후 “쪽 보기”를 다시 눌러 주세요.'); return; }
    setPreviewed(target); setNotice(`원본 물리 순서 ${target}쪽을 양쪽에서 확인해 주세요. 연결은 아직 저장하지 않았습니다.`);
  };
  const confirm = async (next: number | null) => {
    if (!selected || busy || disabled || (next !== null && (!validPage || previewed !== next || !onPreview(next)))) return;
    const key = sourceKey;
    setBusy(true); setError(''); setNotice('');
    try {
      if (!await onConfirm(chapterId, next)) throw new Error('연결 저장 결과를 확인하지 못했습니다. 보고서 저장 오류를 확인하고 다시 시도해 주세요.');
      if (currentKey.current === key) setNotice(next === null ? '선택한 탐색 연결을 해제하고 보고서에 저장했습니다.' : `탐색 연결을 원본 ${next}쪽으로 저장했습니다. 원형 목차·본문·업무 승인 상태는 변경하지 않았습니다.`);
    } catch (reason) { if (currentKey.current === key) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (currentKey.current === key) setBusy(false); }
  };
  return <details className="document-review-pages__source-links">
    <summary>챕터·원본 쪽 연결 확인</summary>
    <p>목차 항목과 원본 물리 순서(표지 포함)를 직접 연결합니다. 먼저 “쪽 보기”로 양쪽을 확인하세요. 선택만으로 저장되지 않으며, 확인·저장은 보고서 저장 이력을 남깁니다. 원형 목차의 문구·쪽수는 바꾸지 않습니다.</p>
    <div className="document-review-pages__source-link-controls">
      <label>연결할 목차 항목<select aria-label="연결할 목차 항목" value={chapterId} disabled={busy} onChange={event => { setChapterId(event.target.value); setPreviewed(null); setError(''); setNotice(''); }}>
        <option value="">항목 선택</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.title || '제목 미입력'}</option>)}
      </select></label>
      <label>연결할 원본 물리 쪽<select aria-label="연결할 원본 물리 쪽" value={page} disabled={busy} onChange={event => { setPage(event.target.value); setPreviewed(null); setError(''); setNotice(''); }}>
        <option value="">쪽 선택 · 표지 포함</option>{Array.from({ length: pageCount }, (_, index) => <option key={index + 1} value={index + 1}>원본 {index + 1}쪽 / {pageCount}쪽</option>)}
      </select></label>
      <button type="button" disabled={busy || !validPage} onClick={preview}>쪽 보기</button>
      <button type="button" disabled={disabled || busy || !selected || !validPage || previewed !== target} onClick={() => void confirm(target)}>{busy ? '연결 저장 중…' : '연결 확인·보고서 저장'}</button>
      <button type="button" disabled={disabled || busy || !linked} onClick={() => void confirm(null)}>선택 연결 해제·보고서 저장</button>
    </div>
    {linked && <p>현재 작업본 연결: {selected?.title || '제목 미입력'} → 원본 물리 순서 {linked.page}쪽 · 보고서 저장 상태는 별도 확인</p>}
    {disabled && <p>읽기 전용·실시간 공동편집에서는 연결 저장이 제한됩니다. 편집 가능 상태라면 미저장 변경·저장 오류·진행 중인 작업을 먼저 확인해 주세요. “쪽 보기”는 사용할 수 있습니다.</p>}
    {error && <p role="alert">{error}</p>}<p role="status">{notice}</p>
  </details>;
}
