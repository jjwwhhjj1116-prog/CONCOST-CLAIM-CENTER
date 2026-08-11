import React, { useCallback, useEffect, useRef, useState } from 'react';
import { previewBrowserKey } from './PreviewCloudDraft';

interface PreviewEvidenceFile {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string;
  uploadedBy: string;
  storageProvider: 'CLOUDFLARE_R2';
  driveStatus: 'PENDING_GOOGLE_CONNECTION' | 'SYNCED_TO_GOOGLE_DRIVE' | 'GOOGLE_SYNC_FAILED';
  downloadUrl: string;
}

interface PreviewEvidenceHubProps {
  userName: string;
  onNavigate: (path: string) => void;
}

const MAX_FILE_BYTES = 10_000_000;
const ACCEPTED_FILES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg,.webp';

function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function formatUploadedAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));
}

export const PreviewEvidenceHub: React.FC<PreviewEvidenceHubProps> = ({ userName, onNavigate }) => {
  const [files, setFiles] = useState<PreviewEvidenceFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [notice, setNotice] = useState('자료를 끌어다 놓거나 파일을 선택하세요.');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const draftKeyRef = useRef('');

  const loadFiles = useCallback(async () => {
    try {
      draftKeyRef.current = previewBrowserKey();
      const response = await fetch('/api/preview/evidence', {
        headers: { 'X-Preview-Draft-Key': draftKeyRef.current }
      });
      const payload = await response.json() as { files?: PreviewEvidenceFile[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? '자료 목록을 불러오지 못했습니다.');
      setFiles(payload.files ?? []);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '자료 목록을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const uploadFiles = async (incoming: FileList | File[]) => {
    const selected = Array.from(incoming);
    if (!selected.length) return;
    setError('');
    setBusyCount(selected.length);

    let completed = 0;
    for (const file of selected) {
      try {
        if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: 파일 크기는 10MB 이하여야 합니다.`);
        const form = new FormData();
        form.set('file', file);
        const response = await fetch('/api/preview/evidence', {
          method: 'POST',
          headers: { 'X-Preview-Draft-Key': draftKeyRef.current || previewBrowserKey() },
          body: form
        });
        const payload = await response.json() as { file?: PreviewEvidenceFile; error?: string };
        if (!response.ok || !payload.file) throw new Error(payload.error ?? `${file.name}: 업로드에 실패했습니다.`);
        setFiles((current) => [payload.file as PreviewEvidenceFile, ...current]);
        completed += 1;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : `${file.name}: 업로드에 실패했습니다.`);
      } finally {
        setBusyCount((count) => Math.max(0, count - 1));
      }
    }
    if (completed) setNotice(`${completed}개 자료를 날짜·시간·사용자 정보와 함께 저장했습니다.`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const downloadFile = async (file: PreviewEvidenceFile) => {
    setError('');
    try {
      const response = await fetch(file.downloadUrl, {
        headers: { 'X-Preview-Draft-Key': draftKeyRef.current || previewBrowserKey() }
      });
      if (!response.ok) throw new Error('자료를 다운로드하지 못했습니다.');
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.originalName;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '자료를 다운로드하지 못했습니다.');
    }
  };

  return (
    <section className="route-view preview-evidence-hub" aria-labelledby="preview-evidence-title">
      <div className="workspace-hero preview-evidence-hero">
        <div>
          <span className="workspace-eyebrow">CASE EVIDENCE · D1 + PRIVATE R2</span>
          <h2 id="preview-evidence-title">자료를 놓으면<br />기록이 시작됩니다.</h2>
          <p>파일 원본은 비공개 Cloudflare R2에, 업로드 날짜·시간·사용자 메타데이터는 D1에 저장합니다.</p>
        </div>
        <div className="preview-drive-card">
          <span>GOOGLE DRIVE</span>
          <strong>OAuth 연결 준비</strong>
          <small>Cloud 저장은 활성 · Drive 동기화는 자격증명 등록 후 활성</small>
          <button type="button" onClick={() => onNavigate('/integrations/google')}>Google Drive 연결 설정</button>
        </div>
      </div>

      <div
        className={`preview-drop-zone${isDragging ? ' is-dragging' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          void uploadFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
        />
        <span className="preview-upload-icon" aria-hidden="true">↥</span>
        <h3>{busyCount ? `${busyCount}개 자료 저장 중…` : '여기로 파일을 드래그 앤 드롭'}</h3>
        <p>PDF · Office · HWP/HWPX · 이미지 · CSV/TXT, 파일당 최대 10MB</p>
        <button type="button" disabled={busyCount > 0} onClick={() => inputRef.current?.click()}>내 컴퓨터에서 선택</button>
      </div>

      <div className="preview-upload-feedback" aria-live="polite">
        <span>{notice}</span>
        <strong>현재 사용자 · {userName}</strong>
      </div>
      {error ? <div className="preview-upload-error" role="alert">{error}<button type="button" onClick={() => void loadFiles()}>목록 다시 불러오기</button></div> : null}

      <section className="preview-evidence-list" aria-labelledby="preview-evidence-list-title">
        <header>
          <div>
            <span className="workspace-eyebrow">EVIDENCE TIMELINE</span>
            <h3 id="preview-evidence-list-title">저장된 자료</h3>
          </div>
          <span>{files.length} FILES</span>
        </header>
        {files.length === 0 ? (
          <div className="preview-evidence-empty">아직 저장된 자료가 없습니다. 첫 자료를 업로드해 보세요.</div>
        ) : (
          <ul>
            {files.map((file) => (
              <li key={file.id}>
                <span className="preview-file-icon" aria-hidden="true">{file.originalName.split('.').pop()?.slice(0, 4).toUpperCase()}</span>
                <div>
                  <strong title={file.originalName}>{file.originalName}</strong>
                  <small>{formatUploadedAt(file.uploadedAt)} · {file.uploadedBy} · {formatBytes(file.byteSize)}</small>
                </div>
                <div className="preview-file-tags">
                  <span>R2 PRIVATE</span>
                  <span className={file.driveStatus === 'SYNCED_TO_GOOGLE_DRIVE' ? 'is-synced' : ''}>
                    {file.driveStatus === 'SYNCED_TO_GOOGLE_DRIVE' ? 'DRIVE SYNCED' : 'DRIVE PENDING'}
                  </span>
                </div>
                <button type="button" onClick={() => void downloadFile(file)}>다운로드</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
};

export const PreviewGoogleDriveSetup: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => (
  <section className="route-view preview-drive-setup" aria-labelledby="preview-drive-title">
    <div>
      <span className="workspace-eyebrow">GOOGLE WORKSPACE · SECURE CONNECTION</span>
      <h2 id="preview-drive-title">Google Drive 연결</h2>
      <p>자료실의 원본 저장은 이미 활성화되었습니다. Google Drive 동기화는 Google Cloud OAuth Client 등록 후 켤 수 있습니다.</p>
    </div>
    <div className="preview-drive-steps">
      <article><span>01</span><strong>Cloud 저장 활성</strong><p>D1 메타데이터와 비공개 R2 원본 저장이 동작합니다.</p></article>
      <article><span>02</span><strong>Google OAuth 등록</strong><p>승인된 Redirect URI와 Client ID/Secret을 서버 비밀값으로 등록합니다.</p></article>
      <article><span>03</span><strong>선택 자료 동기화</strong><p>사용자가 선택한 자료만 사건별 Drive 폴더로 전송합니다.</p></article>
    </div>
    <div className="preview-drive-actions">
      <button type="button" onClick={() => onNavigate('/cases/files')}>자료실로 이동</button>
      <span>현재 상태 · GOOGLE OAUTH CREDENTIALS REQUIRED</span>
    </div>
  </section>
);
