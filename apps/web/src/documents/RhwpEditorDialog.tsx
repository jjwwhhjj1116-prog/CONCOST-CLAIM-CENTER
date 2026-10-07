import React, { useEffect, useRef, useState } from 'react';
import type { EditorOptions, RhwpEditor } from '@rhwp/editor';
import { loadNativeHwpEngine } from './native-hwp-runtime';
import { captureReportNativeSource, assertReportNativePagesMatch,assertReportNativeImportContainer } from './report-native-source';
import { inspectNativeTocNumbers, parseNativeTocPages, refreshConfirmedNativeTocNumbers, type NativeTocExcludedReason } from './report-native-toc';

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
const tocExcludedLabels:Record<NativeTocExcludedReason,string>={NO_PAGE_NUMBER:'지원하는 아라비아 쪽번호를 행 끝에서 확인하지 못했습니다.',TITLE_NOT_FOUND:'지원 범위에서 정확히 일치하는 본문 제목을 찾지 못했습니다.',TITLE_AMBIGUOUS:'같은 본문 제목이 여러 곳에 있어 연결하지 않았습니다.',TARGET_CONTROL:'목차 문단에 지원하지 않는 필드·컨트롤이 있습니다.',PAGE_UNCONFIRMED:'실제 인쇄번호나 본문 위치를 확인하지 못했습니다.',STYLE_UNCONFIRMED:'숫자·본문 위치나 서식 보존을 확인하지 못했습니다.'};

export function RhwpEditorDialog({ isOpen, sourceFile, suggestedName, documentLabel, onClose, onApplyContent, onApplyPages, preserveAppliedSource = false, applyDisabled = false, applyLabel = '현재 HWP 내용을 선택 챕터에 적용', applyProgress }: RhwpEditorDialogProps): React.ReactElement | null {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RhwpEditor | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const originalFileRef = useRef<File | null>(null);
  const generationRef = useRef(0);
  const operationRef = useRef(false);
  const latestRef = useRef({isOpen,sourceFile,applyDisabled,canApply:Boolean(onApplyPages||onApplyContent),report:Boolean(preserveAppliedSource&&onApplyPages)});
  latestRef.current={isOpen,sourceFile,applyDisabled,canApply:Boolean(onApplyPages||onApplyContent),report:Boolean(preserveAppliedSource&&onApplyPages)};
  const tocHandedOffRef=useRef(false);
  const [status, setStatus] = useState('HWP 편집기를 준비하고 있습니다…');
  const [error, setError] = useState('');
  const [activeFileName, setActiveFileName] = useState(sourceFile?.name ?? suggestedName);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [hasImportedTemplate, setHasImportedTemplate] = useState(false);
  const [editorReady,setEditorReady]=useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [tocRange,setTocRange]=useState('');
  const [tocInspection,setTocInspection]=useState<Awaited<ReturnType<typeof inspectNativeTocNumbers>>|null>(null);
  const [tocPreview,setTocPreview]=useState<(Awaited<ReturnType<typeof inspectNativeTocNumbers>> & {bytes:Uint8Array;format:ExportFormat;name:string;editor:RhwpEditor;generation:number;original:File|null;source:File|null|undefined})|null>(null);
  const [tocSelected,setTocSelected]=useState<number[]>([]);
  const [arabicConfirmed,setArabicConfirmed]=useState(false);
  const [tocHandedOff,setTocHandedOff]=useState(false);
  useEffect(() => { if (editorHostRef.current) editorHostRef.current.inert = busy || Boolean(tocPreview); }, [busy,tocPreview]);
  const studioUrl = (globalThis as typeof globalThis & { __CLAIM_CENTER_RHWP_STUDIO_URL__?: string }).__CLAIM_CENTER_RHWP_STUDIO_URL__?.trim();

  useEffect(() => {
    if (!isOpen || !editorHostRef.current) return undefined;
    let active = true;
    generationRef.current++;
    operationRef.current=true;
    let instance: RhwpEditor | null = null;
    setError('');
    setStatus('rhwp 오픈소스 편집기를 연결하고 있습니다…');
    setPageCount(null);
    setHasImportedTemplate(false);
    setEditorReady(false);
    originalFileRef.current = null;
    tocHandedOffRef.current=false;setTocPreview(null);setTocInspection(null);setTocSelected([]);setArabicConfirmed(false);setTocHandedOff(false);setTocRange('');setConfirmClose(false);
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
        setEditorReady(true);
        if (sourceFile) {
          setStatus(`${sourceFile.name} 파일을 여는 중입니다…`);
          const bytes=await sourceFile.arrayBuffer();if(!active)return;assertReportNativeImportContainer(bytes,sourceFile.name);
          const result = await editor.loadFile(bytes, sourceFile.name, { suppressDialogs: true });
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
      }).finally(() => { if (active) {operationRef.current=false;setBusy(false);} });
    return () => {
      active = false;
      generationRef.current++;operationRef.current=false;
      if (editorRef.current === instance) editorRef.current = null;
      instance?.destroy();
    };
  }, [isOpen, sourceFile, studioUrl, suggestedName]);

  useEffect(() => {
    if (!isOpen) setConfirmClose(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const beginOperation=()=>{
    const editor=editorRef.current;if(!editor||operationRef.current||!latestRef.current.isOpen)return null;
    operationRef.current=true;setBusy(true);setError('');
    return {editor,generation:generationRef.current,source:sourceFile,original:originalFileRef.current};
  };
  type Operation=NonNullable<ReturnType<typeof beginOperation>>;
  const current=(operation:Operation)=>latestRef.current.isOpen&&generationRef.current===operation.generation&&editorRef.current===operation.editor&&latestRef.current.sourceFile===operation.source;
  const requireCurrent=(operation:Operation,applying=false,reportOnly=false)=>{if(!current(operation)||(applying&&(latestRef.current.applyDisabled||!latestRef.current.canApply))||(reportOnly&&!latestRef.current.report))throw new Error('문서 또는 저장 권한·상태가 바뀌어 적용을 중단했습니다. 현재 보고서에서 다시 확인해 주세요.');};
  const endOperation=(operation:Operation)=>{if(current(operation)){operationRef.current=false;setBusy(false);}};
  const closeEditor=()=>{if(operationRef.current)return;generationRef.current++;onClose();};
  const readNativeSnapshot=async(operation:Operation)=>{
    const before:string[]=[], count=await operation.editor.pageCount();requireCurrent(operation);
    for(let page=0;page<count;page++){before.push(await operation.editor.getPageSvg(page));requireCurrent(operation);}
    const format:ExportFormat=/\.hwp$/iu.test(activeFileName)?'hwp':'hwpx';
    const bytes=format==='hwp'?await operation.editor.exportHwp():await operation.editor.exportHwpx();requireCurrent(operation);
    const Engine=await loadNativeHwpEngine();requireCurrent(operation);
    const name=`${safeBaseName(activeFileName).replace(/_편집본$/u,'')}_편집본.${format}`;
    const snapshot=captureReportNativeSource(bytes,name,Engine);assertReportNativePagesMatch(before,snapshot.pages);
    return {bytes,format,Engine,name,snapshot};
  };

  const loadFile = async (file: File | undefined) => {
    if (!file || tocPreview) return;
    const operation=beginOperation();if(!operation)return;
    setTocInspection(null);setTocRange('');
    setBusy(true); setHasImportedTemplate(false); setError(''); setStatus(`${file.name} 파일을 여는 중입니다…`);
    try {
      const bytes=await file.arrayBuffer();requireCurrent(operation);
      assertReportNativeImportContainer(bytes,file.name);
      const result = await operation.editor.loadFile(bytes, file.name, { suppressDialogs: true });requireCurrent(operation);
      setPageCount(result.pageCount);
      originalFileRef.current = file;
      setActiveFileName(file.name);
      setHasImportedTemplate(true);
      setStatus(`${result.pageCount}페이지를 열었습니다. 원본과 표·이미지 위치를 확인해 주세요.`);
    } catch (reason) {
      if(current(operation)){setError(reason instanceof Error ? reason.message : '선택한 HWP 문서를 열지 못했습니다.');setStatus('');}
    } finally {
      endOperation(operation);
      if (current(operation)&&importInputRef.current) importInputRef.current.value = '';
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
    if(tocPreview)return;const operation=beginOperation();if(!operation)return;
    setBusy(true); setError(''); setStatus(`${format.toUpperCase()} 파일을 생성하고 있습니다…`);
    try {
      const before: string[] = [];
      const count = await editor.pageCount();
      requireCurrent(operation);
      for (let page = 0; page < count; page++) {before.push(await editor.getPageSvg(page));requireCurrent(operation);}
      const bytes = format === 'hwp' ? await editor.exportHwp() : await editor.exportHwpx();
      requireCurrent(operation);
      const fileName = `${safeBaseName(activeFileName || suggestedName)}.${format}`;
      const mime = format === 'hwp' ? 'application/x-hwp' : 'application/vnd.hancom.hwpx';
      const snapshot = captureReportNativeSource(bytes, fileName, await loadNativeHwpEngine());
      requireCurrent(operation);
      assertReportNativePagesMatch(before, snapshot.pages);
      downloadBlob(bytesToBlob(bytes, mime), fileName);
      try { await editor.notifySaved(fileName); } catch { /* Older hosted Studio can omit this capability. */ }
      requireCurrent(operation);
      setStatus(`${fileName} 다운로드를 완료했습니다. 웹 엔진에서 저장 전·후 페이지 일치는 확인했지만, PC 한컴의 글꼴·여백·배치와 동일한지는 아직 검증되지 않았습니다. 제출 전 한컴에서 다시 열어 대조해 주세요.`);
      setConfirmClose(false);
    } catch (reason) {
      if(current(operation)){setError(reason instanceof Error ? reason.message : `${format.toUpperCase()} 파일 생성에 실패했습니다.`);setStatus('');}
    } finally { endOperation(operation); }
  };

  const applyCurrentDocument = async () => {
    const editor = editorRef.current;
    if (!editor || busy || applyDisabled || tocPreview || (!onApplyContent && !onApplyPages)) return;
    if (!hasImportedTemplate) {
      setError('적용할 HWP/HWPX 원본을 먼저 가져오세요.');
      return;
    }
    const operation=beginOperation();if(!operation)return;
    setBusy(true); setError(''); setStatus('현재 HWP 편집 내용을 읽고 있습니다…');
    try {
      let editedSource: File | undefined;
      const pageSvgs: string[] = [];
      if (preserveAppliedSource && onApplyPages) {
        const {snapshot}=await readNativeSnapshot(operation);
        pageSvgs.push(...snapshot.pages);
        editedSource = snapshot.file;
      }
      const count = editedSource ? pageSvgs.length : await editor.pageCount();
      requireCurrent(operation,true);
      setPageCount(count);
      for (let page = 0; !editedSource && page < count; page += 1) {
        pageSvgs.push(await editor.getPageSvg(page));
        requireCurrent(operation,true);
      }
      if(onApplyPages){
        requireCurrent(operation,true);await onApplyPages(pageSvgs, editedSource, operation.original ?? undefined);
        if(!current(operation))return;
        setStatus(`${count}페이지를 작업본에 적용했습니다. 보고서 저장 완료 여부를 확인해 주세요.`);
      }else{
        const content=pageSvgs.map(textFromSvg).map((page)=>page.trim()).filter(Boolean).join('\n\n').trim();
        if (!content) throw new Error('HWP에서 편집 가능한 텍스트를 찾지 못했습니다.');
        await onApplyContent?.(content);
        if(!current(operation))return;
        setStatus(`${count}페이지의 텍스트를 보고서 작업본에 적용했습니다.`);
      }
      setConfirmClose(false);
    } catch (reason) {
      if(current(operation)){setError(reason instanceof Error ? reason.message : '현재 HWP 내용을 보고서 작업본에 적용하지 못했습니다.');setStatus('');}
    } finally {
      endOperation(operation);
    }
  };

  const inspectToc=async()=>{
    if(!preserveAppliedSource||!onApplyPages||!hasImportedTemplate||applyDisabled||tocPreview)return;
    const operation=beginOperation();if(!operation)return;setTocInspection(null);setStatus('현재 원형의 목차와 본문 위치를 확인하고 있습니다…');
    try {
      const pages=parseNativeTocPages(tocRange,pageCount??0), source=await readNativeSnapshot(operation);requireCurrent(operation,true,true);
      const proposal=await inspectNativeTocNumbers(source.bytes,source.format,pages,source.Engine);requireCurrent(operation,true,true);
      setTocInspection(proposal);
      tocHandedOffRef.current=false;setTocSelected([]);setArabicConfirmed(false);setTocHandedOff(false);
      if(proposal.candidates.length){setTocPreview({...proposal,bytes:source.bytes,format:source.format,name:source.name,...operation});setStatus('변경할 항목을 직접 선택해 주세요. 확인하는 동안 원형 편집은 잠겨 있습니다.');}
      else setStatus(`자동 확인 가능한 변경 후보가 없습니다. 일치 ${proposal.unchanged}건 · 자동 확인 제외 ${proposal.unsupported}건. 전체 목차의 일치 판정은 아니며, 나머지는 원형 편집기에서 직접 대조하세요.`);
    }catch(reason){if(current(operation)){setError(reason instanceof Error?reason.message:'목차를 확인하지 못했습니다. 쪽 범위를 확인하고 다시 시도하세요.');setStatus('');}}
    finally{endOperation(operation);}
  };
  const applyToc=async()=>{
    const prepared=tocPreview;if(!prepared||tocHandedOffRef.current||!tocSelected.length||!arabicConfirmed||applyDisabled||!onApplyPages)return;
    const operation=beginOperation();if(!operation)return;setStatus('선택한 목차 숫자를 변경하고 두 차례 저장·재열기에서 서식을 대조하고 있습니다…');
    let handedOff=false;
    try{
      if(prepared.generation!==operation.generation||prepared.editor!==operation.editor||prepared.original!==operation.original||prepared.source!==operation.source)throw new Error('확인한 문서가 바뀌었습니다. 취소 후 목차를 다시 확인하세요.');
      const Engine=await loadNativeHwpEngine();requireCurrent(operation,true,true);
      const candidate=await refreshConfirmedNativeTocNumbers(prepared.bytes,prepared.format,prepared.sourceSha256,tocSelected.map(index=>prepared.candidates[index]),Engine);requireCurrent(operation,true,true);
      if(!candidate.changes.length){setTocPreview(null);setStatus('목차 숫자가 이미 일치합니다. 저장하지 않았습니다.');return;}
      const snapshot=captureReportNativeSource(candidate.bytes,prepared.name,Engine);requireCurrent(operation,true,true);
      handedOff=true;tocHandedOffRef.current=true;setTocHandedOff(true);
      await onApplyPages(snapshot.pages,snapshot.file,operation.original??undefined);if(!current(operation))return;
      setStatus(`목차 숫자 ${candidate.changes.length}건을 작업본에 적용했습니다. 보고서 저장 완료 여부를 확인해 주세요.`);setConfirmClose(false);endOperation(operation);onClose();
    }catch(reason){if(current(operation)){const message=reason instanceof Error?reason.message:'목차 숫자를 반영하지 못했습니다.';setError(handedOff?`${message} 파일 적용은 이미 시작되어 숫자를 다시 적용하지 않습니다. 편집기를 닫고 보고서 저장 상태를 확인한 뒤 기존 저장 재시도를 사용하세요.`:message);setStatus('');}}
    finally{endOperation(operation);}
  };

  return <div className="rhwp-dialog-backdrop" role="presentation">
    <section className="rhwp-dialog" role="dialog" aria-modal="true" aria-labelledby="rhwp-dialog-title">
      <header className="rhwp-dialog__header">
        <div><span>HWP / HWPX OPEN-SOURCE EDITOR</span><h2 id="rhwp-dialog-title">{documentLabel} · 한글 문서 편집</h2><p>{activeFileName}{pageCount !== null ? ` · ${pageCount}페이지` : ''}</p></div>
        <button type="button" disabled={busy} aria-label="HWP 편집기 닫기" onClick={() => {if(!operationRef.current)setConfirmClose(true);}}>×</button>
      </header>
      <nav className="rhwp-dialog__toolbar" aria-label="HWP 문서 도구">
        <input ref={importInputRef} hidden type="file" accept=".hwp,.hwpx,.hml,application/x-hwp,application/vnd.hancom.hwpx" onChange={(event) => void loadFile(event.target.files?.[0])} />
        <button type="button" className="rhwp-action-import" disabled={busy || !editorReady || Boolean(tocPreview)} onClick={() => importInputRef.current?.click()}>HWP/HWPX 가져오기</button>
        <button type="button" className="rhwp-action-hwp" disabled={busy || Boolean(tocPreview) || !hasImportedTemplate} title={!hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void exportDocument('hwp')}>HWP 다운로드만</button>
        <button type="button" className="rhwp-action-hwpx" disabled={busy || Boolean(tocPreview) || !hasImportedTemplate} title={!hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void exportDocument('hwpx')}>HWPX 다운로드만</button>
        {(onApplyContent||onApplyPages) && <button type="button" className="rhwp-action-apply" disabled={busy || Boolean(tocPreview) || applyDisabled || !hasImportedTemplate} title={applyDisabled ? '원본 연결 또는 다른 저장이 끝난 뒤 적용할 수 있습니다.' : !hasImportedTemplate ? 'HWP/HWPX 원본을 먼저 가져오세요.' : undefined} onClick={() => void applyCurrentDocument()}>{applyLabel}</button>}
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
      {error && <p className="rhwp-dialog__error" role="alert">{error}{!busy&&!editorReady&&' 편집기 연결에 실패했습니다. 오른쪽 위 닫기 버튼으로 닫은 뒤 다시 열어 연결을 재시도해 주세요.'}</p>}
      {preserveAppliedSource && onApplyPages && <section className="rhwp-dialog__toc" aria-labelledby="native-toc-title">
        <h3 id="native-toc-title">원형 목차 쪽번호 갱신</h3>
        {!tocPreview ? <form onSubmit={event=>{event.preventDefault();void inspectToc();}}>
          <label htmlFor="native-toc-pages">목차가 있는 물리 쪽 <input id="native-toc-pages" value={tocRange} onChange={event=>setTocRange(event.target.value)} maxLength={200} placeholder="예: 2-4,6" disabled={busy||applyDisabled} aria-describedby="native-toc-help" /></label>
          <button type="submit" disabled={busy||applyDisabled||!hasImportedTemplate||!tocRange.trim()}>목차 번호 확인</button>
          <p id="native-toc-help">표지를 포함해 세는 쪽입니다. 점선·탭 뒤 아라비아 쪽번호와 본문 제목이 정확히 일치하는 항목만 확인합니다. 본문의 1행 2열 로마 번호·제목 표는 읽어서 위치만 확인하며 표는 바꾸지 않습니다. 목차가 표 안이거나 필드·로마 쪽번호이면 직접 편집하세요.</p>
        </form> : <>
          <p>숫자만 갱신합니다. 일치 {tocPreview.unchanged}건 · 자동 확인 제외 {tocPreview.unsupported}건. 제외 항목은 직접 대조하세요.</p>
          <div className="rhwp-dialog__toc-rows" role="group" aria-label="갱신할 목차 항목 선택">{tocPreview.candidates.map((row,index)=><label key={`${row.section}:${row.paragraph}`}><input type="checkbox" checked={tocSelected.includes(index)} disabled={busy||applyDisabled||tocHandedOff} onChange={event=>setTocSelected(previous=>event.target.checked?[...previous,index]:previous.filter(value=>value!==index))}/><span><strong>{row.title}</strong><small>목차 물리 {row.tocPhysicalPage}쪽 · 본문 물리 {row.anchor.physicalPage}쪽</small></span><b>{row.oldText} → {row.newText}</b></label>)}</div>
          <label className="rhwp-dialog__toc-folio"><input type="checkbox" checked={arabicConfirmed} disabled={busy||applyDisabled||tocHandedOff} onChange={event=>setArabicConfirmed(event.target.checked)}/>본문에 인쇄된 쪽번호가 위의 아라비아 숫자와 같고, 앞의 0 표시도 맞는지 확인했습니다.</label>
          <div className="rhwp-dialog__toc-actions">{tocHandedOff?<button type="button" disabled={busy} onClick={()=>setConfirmClose(true)}>닫고 보고서 저장 상태 확인</button>:<button type="button" disabled={busy} onClick={()=>{if(operationRef.current||tocHandedOffRef.current)return;setTocPreview(null);setTocSelected([]);setArabicConfirmed(false);setError('');setStatus('목차 갱신을 취소했습니다. 저장하지 않았습니다.');}}>취소·원형 편집 계속</button>}<button type="button" disabled={busy||applyDisabled||tocHandedOff||!tocSelected.length||!arabicConfirmed} onClick={()=>void applyToc()}>선택 숫자 갱신·보고서 적용</button></div>
        </>}
        {tocInspection&&<div className="rhwp-dialog__toc-result" role="status"><p>마지막 확인 물리 쪽: {tocInspection.inspectedPages.join(', ')} · 쪽번호 있는 행 {tocInspection.numberRows}개 · 일치 {tocInspection.unchanged}개 · 갱신 후보 {tocInspection.candidates.length}개</p><p>아래 제외 수는 인식한 점선·탭 행만 센 값이며 전체 목차 검수 합격을 뜻하지 않습니다. 편집 후에는 번호 확인을 다시 실행하세요.</p></div>}
        {tocInspection&&tocInspection.excluded.length>0&&<details className="rhwp-dialog__toc-excluded"><summary>자동 갱신 제외 사유 {tocInspection.excluded.length}개</summary><ul>{tocInspection.excluded.map(row=><li key={`${row.section}:${row.paragraph}`}><strong>{row.title}</strong><span>원본 물리 {row.physicalPage}쪽 · {tocExcludedLabels[row.reason]}</span></li>)}</ul></details>}
      </section>}
      <div className="rhwp-dialog__editor" ref={editorHostRef} aria-label="rhwp 한글 문서 편집 영역" />
      {confirmClose && <div className="rhwp-dialog__confirm" role="alertdialog" aria-modal="true" aria-label="편집기 닫기 확인"><div><h3>편집기를 닫을까요?</h3><p>{tocHandedOff?'목차 작업본 적용은 이미 시작됐습니다. 닫은 뒤 보고서 저장 상태를 확인하고 저장 실패 시 기존 저장 재시도를 사용하세요. 같은 숫자 갱신이나 파일 업로드를 반복하지 마세요.':preserveAppliedSource && onApplyPages ? '전체 페이지를 적용하지 않은 수정 내용은 보고서에 반영되지 않습니다. 먼저 전체 페이지 적용과 보고서 저장 완료를 확인하세요. 파일 다운로드만으로는 보고서가 갱신되지 않습니다.' : '내보내지 않은 수정 내용은 사라질 수 있습니다. 먼저 HWP 또는 HWPX로 내려받는 것을 권장합니다.'}</p><div><button type="button" disabled={busy} onClick={() => setConfirmClose(false)}>{tocHandedOff?'안내로 돌아가기':'계속 편집'}</button><button type="button" disabled={busy} className="is-danger" onClick={closeEditor}>{tocHandedOff?'닫고 저장 상태 확인':'저장하지 않고 닫기'}</button></div></div></div>}
    </section>
  </div>;
}
