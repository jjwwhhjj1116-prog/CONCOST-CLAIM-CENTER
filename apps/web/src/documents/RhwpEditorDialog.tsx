import React, { useEffect, useRef, useState } from 'react';
import type { EditorOptions, RhwpEditor } from '@rhwp/editor';

export interface RhwpEditorDialogProps {
  isOpen: boolean;
  sourceFile?: File | null;
  suggestedName: string;
  documentLabel: string;
  onClose: () => void;
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

export function RhwpEditorDialog({ isOpen, sourceFile, suggestedName, documentLabel, onClose }: RhwpEditorDialogProps): React.ReactElement | null {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RhwpEditor | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState('HWP 편집기를 준비하고 있습니다…');
  const [error, setError] = useState('');
  const [activeFileName, setActiveFileName] = useState(sourceFile?.name ?? suggestedName);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const studioUrl = (import.meta.env.VITE_RHWP_STUDIO_URL as string | undefined)?.trim();

  useEffect(() => {
    if (!isOpen || !editorHostRef.current) return undefined;
    let active = true;
    let instance: RhwpEditor | null = null;
    setError('');
    setStatus('rhwp 오픈소스 편집기를 연결하고 있습니다…');
    setPageCount(null);
    const options: EditorOptions = {
      width: '100%', height: '100%', renderer: 'canvas2d', requestTimeoutMs: 90_000,
      ...(studioUrl ? { studioUrl } : {})
    };
    const host = editorHostRef.current;
    void import('@rhwp/editor')
      .then(({ createEditor }) => createEditor(host, options))
      .then(async (editor) => {
        if (!active) { editor.destroy(); return; }
        instance = editor;
        editorRef.current = editor;
        if (sourceFile) {
          setStatus(`${sourceFile.name} 파일을 여는 중입니다…`);
          const result = await editor.loadFile(await sourceFile.arrayBuffer(), sourceFile.name, { suppressDialogs: true });
          if (!active) return;
          setPageCount(result.pageCount);
          setActiveFileName(sourceFile.name);
          setStatus(`${result.pageCount}페이지를 열었습니다. 편집 후 HWP 또는 HWPX로 내보내세요.`);
        } else {
          setActiveFileName(suggestedName);
          setStatus('새 문서 편집기가 열렸습니다. 기존 HWP/HWPX를 가져오거나 새로 작성하세요.');
        }
      })
      .catch((reason) => {
        if (!active) return;
        setError(reason instanceof Error ? reason.message : 'HWP 편집기를 열지 못했습니다.');
        setStatus('');
      });
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
    setBusy(true); setError(''); setStatus(`${file.name} 파일을 여는 중입니다…`);
    try {
      const result = await editorRef.current.loadFile(await file.arrayBuffer(), file.name, { suppressDialogs: true });
      setPageCount(result.pageCount);
      setActiveFileName(file.name);
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
    setBusy(true); setError(''); setStatus(`${format.toUpperCase()} 파일을 생성하고 있습니다…`);
    try {
      if (format === 'hwp') {
        const verification = await editor.exportHwpVerify();
        if (!verification.recovered || verification.pageCountBefore !== verification.pageCountAfter) {
          throw new Error(`HWP 재열기 검증 실패: 저장 전 ${verification.pageCountBefore}쪽 / 재열기 ${verification.pageCountAfter}쪽`);
        }
      }
      const bytes = format === 'hwp' ? await editor.exportHwp() : await editor.exportHwpx();
      const fileName = `${safeBaseName(activeFileName || suggestedName)}.${format}`;
      const mime = format === 'hwp' ? 'application/x-hwp' : 'application/vnd.hancom.hwpx';
      downloadBlob(bytesToBlob(bytes, mime), fileName);
      try { await editor.notifySaved(fileName); } catch { /* Older hosted Studio can omit this capability. */ }
      setStatus(`${fileName} 다운로드를 완료했습니다.${format === 'hwp' ? ' HWP 자기 재열기 검증도 통과했습니다.' : ''}`);
      setConfirmClose(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${format.toUpperCase()} 파일 생성에 실패했습니다.`);
    } finally { setBusy(false); }
  };

  return <div className="rhwp-dialog-backdrop" role="presentation">
    <section className="rhwp-dialog" role="dialog" aria-modal="true" aria-labelledby="rhwp-dialog-title">
      <header className="rhwp-dialog__header">
        <div><span>HWP / HWPX OPEN-SOURCE EDITOR</span><h2 id="rhwp-dialog-title">{documentLabel} · 한글 문서 편집</h2><p>{activeFileName}{pageCount !== null ? ` · ${pageCount}페이지` : ''}</p></div>
        <button type="button" aria-label="HWP 편집기 닫기" onClick={() => setConfirmClose(true)}>×</button>
      </header>
      <nav className="rhwp-dialog__toolbar" aria-label="HWP 문서 도구">
        <input ref={importInputRef} hidden type="file" accept=".hwp,.hwpx,.hml,application/x-hwp,application/vnd.hancom.hwpx" onChange={(event) => void loadFile(event.target.files?.[0])} />
        <button type="button" className="rhwp-action-import" disabled={busy} onClick={() => importInputRef.current?.click()}>HWP/HWPX 가져오기</button>
        <button type="button" className="rhwp-action-hwp" disabled={busy} onClick={() => void exportDocument('hwp')}>HWP 내보내기</button>
        <button type="button" className="rhwp-action-hwpx" disabled={busy} onClick={() => void exportDocument('hwpx')}>HWPX 내보내기</button>
        <div className="rhwp-dialog__status" role="status">{busy && <i aria-hidden="true" />}{status}</div>
      </nav>
      {!studioUrl && <aside className="rhwp-dialog__security">
        현재 `rhwp` 공식 공개 편집 런타임을 사용합니다. 회사 기밀 문서 운영 전 관리자가 <b>VITE_RHWP_STUDIO_URL</b>을 사내 동일 출처 주소로 설정하면 편집 엔진도 사내 서버에서 실행됩니다.
      </aside>}
      {error && <p className="rhwp-dialog__error" role="alert">{error}</p>}
      <div className="rhwp-dialog__editor" ref={editorHostRef} aria-label="rhwp 한글 문서 편집 영역" />
      {confirmClose && <div className="rhwp-dialog__confirm" role="alertdialog" aria-modal="true" aria-label="편집기 닫기 확인"><div><h3>편집기를 닫을까요?</h3><p>내보내지 않은 수정 내용은 사라질 수 있습니다. 먼저 HWP 또는 HWPX로 내려받는 것을 권장합니다.</p><div><button type="button" onClick={() => setConfirmClose(false)}>계속 편집</button><button type="button" className="is-danger" onClick={onClose}>저장하지 않고 닫기</button></div></div></div>}
    </section>
  </div>;
}
