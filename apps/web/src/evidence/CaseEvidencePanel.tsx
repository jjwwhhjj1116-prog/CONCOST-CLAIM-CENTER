import { Button } from '@claim-studio/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

export type CaseEvidenceCategory = 'TAKEOFF_SOURCE' | 'COST_BREAKDOWN';

interface CaseEvidenceFile {
  id: string;
  category: CaseEvidenceCategory;
  originalName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  storageProvider: 'D1_TEMPORARY' | 'GOOGLE_DRIVE';
  uploadedBy: string;
  uploadedAt: string;
  downloadUrl: string;
}

const categoryCopy: Record<CaseEvidenceCategory, { title: string; description: string; icon: string }> = {
  TAKEOFF_SOURCE: { title: '산출자료', description: '도면, 실측표, 산출근거, 검토용 원본', icon: '∑' },
  COST_BREAKDOWN: { title: '내역자료', description: '계약내역, 공사비 내역, 단가·금액 검토표', icon: '₩' }
};
const ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg,.webp';

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function CaseEvidencePanel({ caseId, defaultCategory = 'TAKEOFF_SOURCE', compact = false, onNavigate }: { caseId: string; defaultCategory?: CaseEvidenceCategory; compact?: boolean; onNavigate: (path: string) => void }): React.ReactElement {
  const [category, setCategory] = useState<CaseEvidenceCategory>(defaultCategory);
  const [files, setFiles] = useState<CaseEvidenceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [storagePolicy, setStoragePolicy] = useState<'GOOGLE_DRIVE_REQUIRED' | 'D1_TEST_FALLBACK'>('D1_TEST_FALLBACK');
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const keysRef = useRef(new Map<string, string>());
  const caseIdRef = useRef(caseId);
  const loadSequenceRef = useRef(0);

  const load = useCallback(async () => {
    if (!caseId) { setFiles([]); return; }
    const requestCaseId = caseId;
    const sequence = ++loadSequenceRef.current;
    setLoading(true); setError('');
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(requestCaseId)}/evidence`, { headers: { Accept: 'application/json' } });
      const payload = await response.json() as { files?: CaseEvidenceFile[]; error?: string; storagePolicy?: 'GOOGLE_DRIVE_REQUIRED' | 'D1_TEST_FALLBACK'; googleDriveConnected?: boolean };
      if (!response.ok) throw new Error(payload.error ?? '프로젝트 자료를 불러오지 못했습니다.');
      if (sequence !== loadSequenceRef.current || caseIdRef.current !== requestCaseId) return;
      setFiles(payload.files ?? []);
      setStoragePolicy(payload.storagePolicy ?? 'D1_TEST_FALLBACK');
      setGoogleDriveConnected(Boolean(payload.googleDriveConnected));
    } catch (reason) { if (sequence === loadSequenceRef.current && caseIdRef.current === requestCaseId) setError(reason instanceof Error ? reason.message : '프로젝트 자료를 불러오지 못했습니다.'); }
    finally { if (sequence === loadSequenceRef.current && caseIdRef.current === requestCaseId) setLoading(false); }
  }, [caseId]);

  useEffect(() => { caseIdRef.current = caseId; loadSequenceRef.current += 1; setFiles([]); setCategory(defaultCategory); setNotice(''); setError(''); setUploading(0); setDragging(false); setGoogleDriveConnected(false); }, [caseId, defaultCategory]);
  useEffect(() => { void load(); }, [load]);

  const upload = async (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    if (!caseId || !selected.length) return;
    if (storagePolicy === 'GOOGLE_DRIVE_REQUIRED' && !googleDriveConnected) { setError('관리자 설정에서 회사 Google Drive 계정을 먼저 연결해 주세요.'); return; }
    const targetCaseId = caseId;
    const targetCategory = category;
    setUploading(selected.length); setError(''); setNotice('');
    let completed = 0;
    for (const file of selected) {
      const fingerprint = `${targetCaseId}:${targetCategory}:${file.name}:${file.size}:${file.lastModified}`;
      const key = keysRef.current.get(fingerprint) ?? `case-evidence-${crypto.randomUUID()}`;
      keysRef.current.set(fingerprint, key);
      try {
        const form = new FormData();
        form.set('file', file); form.set('category', targetCategory);
        const response = await fetch(`/api/cases/${encodeURIComponent(targetCaseId)}/evidence`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: form });
        const payload = await response.json() as { file?: CaseEvidenceFile; error?: string };
        if (!response.ok || !payload.file) throw new Error(payload.error ?? `${file.name}: 업로드에 실패했습니다.`);
        keysRef.current.delete(fingerprint);
        if (caseIdRef.current === targetCaseId) setFiles((current) => [payload.file as CaseEvidenceFile, ...current.filter((item) => item.id !== payload.file?.id)]);
        completed += 1;
      } catch (reason) { if (caseIdRef.current === targetCaseId) setError(reason instanceof Error ? reason.message : `${file.name}: 업로드에 실패했습니다.`); }
      finally { if (caseIdRef.current === targetCaseId) setUploading((count) => Math.max(0, count - 1)); }
    }
    if (completed && caseIdRef.current === targetCaseId) setNotice(`${completed}개 ${categoryCopy[targetCategory].title}를 프로젝트 자료실에 저장했습니다.`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const download = async (file: CaseEvidenceFile) => {
    setError('');
    try {
      const response = await fetch(file.downloadUrl);
      if (!response.ok) throw new Error('파일 무결성 확인 또는 다운로드에 실패했습니다.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.originalName; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '파일 다운로드에 실패했습니다.'); }
  };

  const categoryFiles = files.filter((file) => file.category === category);
  const visibleFiles = compact ? categoryFiles.slice(0, 6) : categoryFiles;
  const uploadDisabled = Boolean(uploading) || (storagePolicy === 'GOOGLE_DRIVE_REQUIRED' && !googleDriveConnected);
  return <section className={`case-evidence-panel${compact ? ' is-compact' : ''}`} aria-label="프로젝트 산출·내역 자료실">
    <div className="case-evidence-categories" role="tablist" aria-label="자료 구분">
      {(Object.keys(categoryCopy) as CaseEvidenceCategory[]).map((value) => <button key={value} type="button" role="tab" aria-selected={category === value} className={category === value ? 'is-active' : ''} onClick={() => setCategory(value)}><b aria-hidden="true">{categoryCopy[value].icon}</b><span><strong>{categoryCopy[value].title}</strong><small>{categoryCopy[value].description}</small></span><em>{files.filter((file) => file.category === value).length}</em></button>)}
    </div>
    <div className={`case-evidence-dropzone${dragging ? ' is-dragging' : ''}${uploadDisabled ? ' is-disabled' : ''}`} onDragEnter={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }} onDragOver={(event) => { event.preventDefault(); if (!uploadDisabled) setDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }} onDrop={(event) => { event.preventDefault(); setDragging(false); if (!uploadDisabled && event.dataTransfer.files) void upload(event.dataTransfer.files); }}>
      <input ref={inputRef} type="file" multiple accept={ACCEPT} disabled={uploadDisabled} onChange={(event) => event.target.files && void upload(event.target.files)} />
      <span aria-hidden="true">⇧</span><div><strong>{uploading ? `${uploading}개 파일 저장 중…` : uploadDisabled ? '회사 Google Drive 연결이 필요합니다' : `${categoryCopy[category].title}를 끌어다 놓으세요`}</strong><small>최대 10MB · 업로더·업로드 시각·SHA-256을 기록하고 프로젝트/자료종류/월 폴더에 저장합니다.</small></div><Button disabled={uploadDisabled} onClick={() => inputRef.current?.click()}>파일 선택</Button>
    </div>
    <p className="case-evidence-storage-note"><strong>{storagePolicy === 'GOOGLE_DRIVE_REQUIRED' ? 'COMPANY GOOGLE DRIVE STORAGE' : 'LOCAL TEST FALLBACK'}</strong> {storagePolicy === 'GOOGLE_DRIVE_REQUIRED' ? googleDriveConnected ? '회사 Drive 연결 완료 · 새 파일은 프로젝트/산출·내역/월 폴더에 직접 저장됩니다.' : '업로드가 잠겨 있습니다. 설정의 관리자 설정에서 회사 계정을 연결하세요.' : '자동화 테스트 환경에서만 D1 임시 보존을 사용합니다.'} {storagePolicy === 'GOOGLE_DRIVE_REQUIRED' && !googleDriveConnected && <button type="button" onClick={() => onNavigate('/settings?section=admin')}>Google Drive 설정 열기</button>}</p>
    {notice && <p className="notice-box" role="status">{notice}</p>}{error && <p className="error-box" role="alert">{error} <button type="button" onClick={() => void load()}>다시 확인</button></p>}
    <div className="case-evidence-list"><header><div><span>PROJECT EVIDENCE</span><h3>{categoryCopy[category].title} 목록</h3></div><div><em>{categoryFiles.length} FILES</em>{compact && <Button size="sm" variant="secondary" onClick={() => onNavigate(`/cases/files?caseId=${encodeURIComponent(caseId)}`)}>자료실 전체 보기</Button>}</div></header>
      {loading ? <p className="case-evidence-empty">자료 목록을 불러오는 중입니다.</p> : visibleFiles.length ? <ul>{visibleFiles.map((file) => <li key={file.id}><b aria-hidden="true">{categoryCopy[file.category].icon}</b><div><strong title={file.originalName}>{file.originalName}</strong><small>{categoryCopy[file.category].title} · {new Date(file.uploadedAt).toLocaleString('ko-KR')} · {file.uploadedBy} · {formatBytes(file.byteSize)}</small></div><span>{file.storageProvider === 'GOOGLE_DRIVE' ? 'GOOGLE DRIVE' : 'D1 LEGACY'}</span><Button size="sm" variant="secondary" onClick={() => void download(file)}>다운로드</Button></li>)}</ul> : <p className="case-evidence-empty">아직 저장된 자료가 없습니다. 위 영역에 첫 자료를 올려 주세요.</p>}
    </div>
  </section>;
}
