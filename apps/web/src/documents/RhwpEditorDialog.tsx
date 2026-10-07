import React, { useEffect, useRef, useState } from 'react';
import type { EditorOptions, RhwpEditor } from '@rhwp/editor';
import { loadNativeHwpEngine } from './native-hwp-runtime';
import { captureReportNativeSource, assertReportNativePagesMatch } from './report-native-source';

export interface RhwpEditorDialogProps {
  isOpen: boolean;
  sourceFile?: File | null;
  suggestedName: string;
  documentLabel: string;
  onClose: () => void;
  onApplyContent?: (content: string) => void | Promise<void>;
  onApplyPages?: (pages: string[], editedSource?: File, originalSource?: File) => void | Promise<void>;
  preserveAppliedSource?: boolean;
  applyDisabled?: boolean;
  applyLabel?: string;
  applyProgress?: string;
}

type ExportFormat = 'hwp' | 'hwpx';

const safeBaseName = (value: string) => value
  .replace(/\.(?:hwp|hwpx|hml)$/iu, '')
  .replace(/[\\/:*?"<>|]/gu, '_')
  .trim() || '클레임센터_문서';

const bytesToBlob = (bytes: Uint8Array, type: string): Blob => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
};

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const textFromSvg = (svg: string): string => {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const lines = [...document.querySelectorAll('text')]
    .map((node) => (node.textContent ?? '').replace(/\s+/gu, ' ').trim())
    .filter(Boolean);
  if (lines.length) return lines.join('\n');
  return (document.documentElement.textContent ?? '').replace(/\s+/gu, ' ').trim();
};

export function RhwpEditorDialog({ isOpen, sourceFile, suggestedName, documentLabel, onClose, onApplyContent, onApplyPages, preserveAppliedSource = false, applyDisabled = false, applyLabel = '현재 HWP 내용을 선택 챕터에 적용', applyProgress }: RhwpEditorDialogProps): React.ReactElement | null {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RhwpEditor | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);
  const [status, setStatus] = useState('HWP 편집기를 준비하고 있습니다…');
  const [error, setError] = useState('');
  const [activeFileName, setActiveFileName] = useState(sourceFile?.name ?? suggestedName);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [hasImportedTemplate, setHasImportedTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  useEffect(() => { if (editorHostRef.current) editorHostRef.current.inert = busy; }, [busy]);
  const studioUrl = (globalThis as typeof globalThis & { __CLAIM_CENTER_RHWP_STUDIO_URL__?: string }).__CLAIM_CENTER_RHWP_STUDIO_URL__?.trim();

  useEffect(() => {
    if (!isOpen || !editorHostRef.current) return undefined;
    let active = true;
    let instance: RhwpEditor | null = null;
    setError('');
    setStatus('rhwp 오픈소스 편집기를 연결하고 있습니다…');
    setPageCount(null);
    setHasImportedTemplate(false);
    originalFileRef.current = null;
    setBusy(true);
    const options: EditorOptions = {
      width: '100%', height: '100%', renderer: 'canvas2d', requestTimeoutMs: 90_000
    };
    const host = editorHostRef.current;
    void import('@rhwp/editor')
      .then(({ createEditor }) => {
        const runtimeUrl = new URL(studioUrl || 'https://edwardkim.github.io/rhwp/', document.baseURI);
        // Embedded host documents skip startup recovery UI without deleting drafts.
        runtimeUrl.searchParams.set('chrome', 'embed');
        return createEditor(host, { ...options, studioUrl: runtimeUrl.href });
      })
      .then(async (editor) => {
        if (!active) { editor.destroy(); return; }
        instance = editor;
        editorRef.current = editor;
        if (sourceFile) {
          setStatus(`${sourceFile.name} 파일을 여는 중입니다…`);
          const result = await editor.loadFile(await sourceFile.arrayBuffer(), sourceFile.name, { suppressDialogs: true });
          if (!active) return;
          setPageCount(result.pageCount);
          originalFileRef.current = sourceFile;
          setActiveFileName(sourceFile.name);
          setHasImportedTemplate(true);
          setStatus(preserveAppliedSource && onApplyPages ? `${result.pageCount}페이지를 열었습니다. 수정 후 전체 페이지를 적용하고 보고서 저장 상태를 확인하세요. 다운로드만으로 보고서가 갱신되지는 않습니다.` : `${result.pageCount}페이지를 열었습니다. 편집 후 HWP 또는 HWPX로 내보내세요.`);
        } else {
          setActiveFileName(suggestedName);
          setStatus('rhwp는 빈 HWP 생성 API를 제공하지 않습니다. 편집할 HWP/HWPX 원본을 먼저 가져오세요.');
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'HWP 편집기를 열지 못했습니다.');
        setStatus('');
      }).finally(() => { if (active) setBusy(false); });
    return () => {
      active = false;
      if (editorRef.current === instance) editorRef.current = null;
      instance?.destroy();
    };
  }, [isOpen, sourceFile, studioUrl, suggestedName]);

  useEffect(() => {
    if (!isOpen) setConfirmClose(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const loadFile = async (file: File | undefined) => {
    if (!file || !editorRef.current) return;
    setBusy(true); setHasImportedTemplate(false); setError(''); setStatus(`${file.name} 파일을 여는 중입니다…`);
    try {
      const result = await editorRef.current.loadFile(await file.arrayBuffer(), file.name, { suppressDialogs: true });
      setPageCount(result.pageCount);
      originalFileRef.current = file;
      setActiveFileName(file.name);
      setHasImportedTemplate(true);
      setStatus(`${result.pageCount}페이지를 열었습니다. 원본과 표·이미지 위치를 확인해 주세요.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '선택한 HWP 문서를 열지 못했습니다.');
    } finally {
      setBusy(false);
      if (importInputRef.current) importInputRef.current.value = '';
    }
  };

  const exportDocument = async (format: ExportFormat) => {
    const editor = editorRef.current;
    if (!editor) { setError('편집기가 아직 준비되지 않았습니다. 잠시 후 다시 눌러 주세요.'); return; }
    if (!hasImportedTemplate) {
      setError('내보낼 HWP 원본이 없습니다. “HWP/HWPX 가져오기”로 회사 템플릿 또는 기존 문서를 먼저 열어 주세요.');
      setStatus('원본 문서를 불러온 뒤에만 HWP/HWPX 내보내기가 활성화됩니다.');
      return;
    }
    setBusy(true); setError(''); setStatus(`${format.toUpperCase()} 파일을 생성하고 있습니다…`);
    try {
      const before: string[] = [];
      const count = await editor.pageCount();
      for (let page = 0; page < count; page++) before.push(await editor.getPageSvg(page));
      const bytes = format === 'hwp' ? await editor.exportHwp() : await editor.exportHwpx();
      const fileName = `${safeBaseName(activeFileName || suggestedName)}.${format}`;
      const mime = format === 'hwp' ? 'application/x-hwp' : 'application/vnd.hancom.hwpx';
      const snapshot = captureReportNativeSource(bytes, fileName, await loadNativeHwpEngine());
      assertReportNativePagesMatch(before, snapshot.pages);
      downloadBlob(bytesToBlob(bytes, mime), fileName);
      try { await editor.notifySaved(fileName); } catch { /* Older hosted Studio can omit this capability. */ }
      setStatus(`${fileName} 다운로드를 완료했습니다. 웹 엔진에서 저장 전·후 페이지 일치는 확인했지만, PC 한컴의 글꼴·여백·배치와 동일한지는 아직 검증되지 않았습니다. 제출 전 한컴에서 다시 열어 대조해 주세요.`);
      setConfirmClose(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${format.toUpperCase()} 파일 생성에 실패했습니다.`);
    } finally { setBusy(false); }
  };

  const applyCurrentDocument = async () => {
    const editor = editorRef.current;
    if (!editor || busy || applyDisabled || (!onApplyContent && !onApplyPages)) return;
    if (!hasImportedTemplate) {
      setError('적용할 HWP/HWPX 원본을 먼저 가져오세요.');
      return;
    }
    setBusy(true); setError(''); setStatus('현재 HWP 편집 내용을 읽고 있습니다…');
    try {
      let editedSource: File | undefined;
      const pageSvgs: string[] = [];
      if (preserveAppliedSource && onApplyPages) {
        const before: string[] = [];
        const beforeCount = await editor.pageCount();
        for (let page = 0; page < beforeCount; page++) before.push(await editor.getPageSvg(page));
        const format = /\.hwp$/iu.test(activeFileName) ? 'hwp' : 'hwpx';
        const bytes = format === 'hwp' ? await editor.exportHwp() : await editor.exportHwpx();
        const Engine = await loadNativeHwpEngine();
        const snapshot = captureReportNativeSource(bytes, `${safeBaseName(activeFileName).replace(/_편집본$/u, '')}_편집본.${format}`, Engine);
        assertReportNativePagesMatch(before, snapshot.pages);
        pageSvgs.push(...snapshot.pages);
        editedSource = snapshot.file;
      }
      const count = editedSource ? pageSvgs.length : await editor.pageCount();
      setPageCount(count);
      for (let page = 0; !editedSource && page < count; page += 1) {
        pageSvgs.push(await editor.getPageSvg(page));
      }
      if(onApplyPages){
        await onApplyPages(pageSvgs, editedSource, originalFileRef.current ?? undefined);
        setStatus(`${count}페이지를 작업본에 적용했습니다. 보고서 저장 완료 여부를 확인해 주세요.`);
      }else{
        const content=pageSvgs.map(textFromSvg).map((page)=>page.trim()).filter(Boolean).join('\n\n').trim();
        if (!content) throw new Error('HWP에서 편집 가능한 텍스트를 찾지 못했습니다.');
        await onApplyContent?.(content);
        setStatus(`${count}페이지의 텍스트를 보고서 작업본에 적용했습니다.`);
      }
      setConfirmClose(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '현재 HWP 내용을 보고서 작업본에 적용하지 못했습니다.');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  return <div className="rhwp-dialog-backdrop" role="presentation">
    <section className="rhwp-dialog" role="dialog" aria-modal="true" aria-labelledby="rhwp-dialog-title">
      <header className="rhwp-dialog__header">
        <div><span>HWP / HWPX OPEN-SOURCE EDITOR</span><h2 id="rhwp-dialog-title">{documentLabel} · 한글 문서 편집</h2><p>{activeFileName}{pageCount !== null ? ` · ${pageCount}페이지` : ''}</p></div>
        <button type="button" disabled={busy} aria-label="HWP 편집기 닫기" onClick={() => setConfirmClose(true)}>×</button>
      </header>
      <nav className="rhwp-dialog__toolbar" aria-label="HWP 문서 도구">
        <input ref={importInputRef} hidden type="file" accept=".hwp,.hwpx,.hml,application/x-hwp,application/vnd.hancom.hwpx" onChange={(event) => void loadFile(event.target.files?.[0])} />
        <button type="button" className="rhwp-action-import" disabled={busy} onClick={() => importInputRef.current?.click()}>HWP/HWPX 가져오기</button>
        <button type="button" className="rhwp-action-hwp" disabled={busy || !hasImportedTemplate} title={!hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void exportDocument('hwp')}>HWP 다운로드만</button>
        <button type="button" className="rhwp-action-hwpx" disabled={busy || !hasImportedTemplate} title={!hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void exportDocument('hwpx')}>HWPX 다운로드만</button>
        {(onApplyContent||onApplyPages) && <button type="button" className="rhwp-action-apply" disabled={busy || applyDisabled || !hasImportedTemplate} title={applyDisabled ? '원본 연결 또는 다른 저장이 끝난 뒤 적용할 수 있습니다.' : !hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void applyCurrentDocument()}>{applyLabel}</button>}
        <div className="rhwp-dialog__status" role="status">{busy && <i aria-hidden="true" />}{busy && applyProgress ? applyProgress : status}</div>
      </nav>
      <aside className={`rhwp-dialog__format-note${hasImportedTemplate ? ' is-preserved' : ''}`}>
        <strong>{hasImportedTemplate ? '원본 HWP 서식 유지 여부 확인' : '회사 기본서식 적용 방법'}</strong>
        <span>{hasImportedTemplate ? `원본의 글꼴·여백·표·사진·쪽번호를 대조해 주세요. 웹 렌더러가 지원하지 않는 서식은 차이가 날 수 있습니다.${onApplyPages?' 작업본 적용은 페이지 이미지 방식입니다. 문장·표는 이 HWP 편집기에서 수정하고 전체 페이지 적용을 눌러 보고서에 반영하세요. 다운로드 버튼은 파일만 내려받으며 보고서는 바꾸지 않습니다.':''}` : '이 편집기는 기존 HWP/HWPX의 서식을 유지하며 고치는 용도입니다. “HWP/HWPX 가져오기”로 승인 템플릿을 먼저 열어야 편집·내보내기가 정상 작동합니다.'}</span>
      </aside>
      <details className="rhwp-dialog__claude-guide">
        <summary>✦ Claude로 HWP를 직접 고칠 수 있나요?</summary>
        <div><p><b>Microsoft 365용 Claude 플러그인은 Word·Excel·PowerPoint·Outlook 전용</b>이라 이 HWP 편집기에 그대로 설치할 수 없습니다. 이 웹에서 자동 편집하려면 Anthropic API와 선택 문장 읽기·교체 도구를 연결하는 별도 HWP 브리지가 필요합니다.</p><p>현재 rhwp 0.8.4 공개 SDK에는 선택 문장 교체 API가 없어 “Claude가 자동으로 고쳤다”고 표시하지 않습니다. 우선 HWPX 또는 DOCX로 내보낸 뒤 Microsoft 365용 Claude에서 편집하거나, 향후 사내 서버 브리지에 API를 연결할 수 있습니다.</p><nav><a href="https://claude.com/claude-for-microsoft-365" target="_blank" rel="noreferrer">Microsoft 365용 Claude 공식 안내</a><a href="https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview" target="_blank" rel="noreferrer">Anthropic 도구 연결 공식 안내</a></nav></div>
      </details>
      {!studioUrl && <aside className="rhwp-dialog__security">
        현재 `rhwp` 공식 공개 편집 런타임을 사용합니다. 회사 기밀 문서 운영 전 서버가 <b>__CLAIM_CENTER_RHWP_STUDIO_URL__</b> 런타임 설정을 사내 동일 출처 주소로 주입하면 편집 엔진도 사내 서버에서 실행됩니다.
      </aside>}
      {error && <p className="rhwp-dialog__error" role="alert">{error}</p>}
      <div className="rhwp-dialog__editor" ref={editorHostRef} aria-label="rhwp 한글 문서 편집 영역" />
      {confirmClose && <div className="rhwp-dialog__confirm" role="alertdialog" aria-modal="true" aria-label="편집기 닫기 확인"><div><h3>편집기를 닫을까요?</h3><p>{preserveAppliedSource && onApplyPages ? '전체 페이지를 적용하지 않은 수정 내용은 보고서에 반영되지 않습니다. 먼저 전체 페이지 적용과 보고서 저장 완료를 확인하세요. 파일 다운로드만으로는 보고서가 갱신되지 않습니다.' : '내보내지 않은 수정 내용은 사라질 수 있습니다. 먼저 HWP 또는 HWPX로 내려받는 것을 권장합니다.'}</p><div><button type="button" onClick={() => setConfirmClose(false)}>계속 편집</button><button type="button" className="is-danger" onClick={onClose}>저장하지 않고 닫기</button></div></div></div>}
    </section>
  </div>;
}
