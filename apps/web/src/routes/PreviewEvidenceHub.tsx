import React, { useCallback, useEffect, useRef, useState } from 'react';
import { previewBrowserKey } from './PreviewCloudDraft';

interface PreviewEvidenceFile {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  uploadedAt: string;
  uploadedBy: string;
  storageProvider: 'GOOGLE_DRIVE';
  driveStatus: 'PENDING_GOOGLE_CONNECTION' | 'SYNCED_TO_GOOGLE_DRIVE' | 'GOOGLE_SYNC_FAILED';
  downloadUrl: string | null;
}

interface PreviewEvidenceHubProps {
  userName: string;
  onNavigate: (path: string) => void;
}

const MAX_FILE_BYTES = 10_000_000;
const ACCEPTED_FILES = '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.hwp,.hwpx,.txt,.csv,.png,.jpg,.jpeg,.webp';
const STORAGE_PENDING_MESSAGE = 'Google Drive 연결 후 자료를 업로드할 수 있습니다.';

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
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [notice, setNotice] = useState(STORAGE_PENDING_MESSAGE);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const draftKeyRef = useRef('');

  const loadFiles = useCallback(async () => {
    try {
      draftKeyRef.current = previewBrowserKey();
      const response = await fetch('/api/preview/evidence', {
        headers: { 'X-Preview-Draft-Key': draftKeyRef.current }
      });
      const payload = await response.json() as { files?: PreviewEvidenceFile[]; googleDriveConnected?: boolean; error?: string };
      if (!response.ok) {
        if (response.status === 503) {
          setGoogleDriveConnected(false);
          setFiles([]);
          return;
        }
        throw new Error(payload.error ?? '자료 목록을 불러오지 못했습니다.');
      }
      setGoogleDriveConnected(!!payload.googleDriveConnected);
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
    if (!googleDriveConnected) {
      setNotice(STORAGE_PENDING_MESSAGE);
      setError('파일 저장소가 아직 연결되지 않았습니다. 관리자가 Google Drive를 연결한 뒤 다시 시도하세요.');
      return;
    }
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
    if (completed) setNotice(`${completed}개 자료를 Google Drive에 날짜·시간·사용자 기록과 함께 저장했습니다.`);
    if (inputRef.current) inputRef.current.value = '';
  };

  const downloadFile = async (file: PreviewEvidenceFile) => {
    if (!file.downloadUrl) {
      setError('Google Drive 연결 대기 중인 파일입니다.');
      return;
    }
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
          <span className="workspace-eyebrow">CASE EVIDENCE · GOOGLE DRIVE DIRECT</span>
          <h2 id="preview-evidence-title">
            {googleDriveConnected ? 'Google Drive 연결 완료' : 'Google Drive 연결 후'}<br />
            {googleDriveConnected ? '사건 자료를 저장합니다.' : '자료 기록을 시작합니다.'}
          </h2>
          <p>D1 로그인과 보고서 초안 저장은 활성 상태입니다. 파일 원본 저장은 Google Drive OAuth 연결 후 활성화됩니다.</p>
        </div>
        <div className="preview-drive-card">
          <span>GOOGLE DRIVE</span>
          <strong>{googleDriveConnected ? '연결 완료' : '연결 필요'}</strong>
          <small>R2 미사용 · Google OAuth 자격증명 등록 후 파일 저장 활성</small>
          <button type="button" onClick={() => onNavigate('/integrations/google')}>Google Drive 연결 설정</button>
        </div>
      </div>

      <div
        className={`preview-drop-zone${!googleDriveConnected ? ' is-disabled' : ''}${isDragging ? ' is-dragging' : ''}`}
        aria-disabled={!googleDriveConnected}
        onDragEnter={(event) => { event.preventDefault(); if (googleDriveConnected) setIsDragging(true); }}
        onDragOver={(event) => { event.preventDefault(); if (googleDriveConnected) setIsDragging(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!googleDriveConnected) {
            setNotice(STORAGE_PENDING_MESSAGE);
            setError('Google Drive 연결 전에는 파일을 저장하지 않습니다.');
            return;
          }
          if (event.dataTransfer.files) void uploadFiles(event.dataTransfer.files);
        }}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPTED_FILES}
          disabled={!googleDriveConnected}
          onChange={(event) => event.target.files && void uploadFiles(event.target.files)}
        />
        <span className="preview-upload-icon" aria-hidden="true">↥</span>
        <h3>
          {busyCount
            ? `${busyCount}개 자료 저장 중…`
            : googleDriveConnected
            ? '파일을 끌어다 놓거나 클릭하여 Google Drive에 저장하세요'
            : 'Google Drive 연결 후 드래그 앤 드롭 사용 가능'}
        </h3>
        <p>
          {googleDriveConnected
            ? '최대 10MB · PDF, DOCX, XLSX, HWPX, 이미지 지원'
            : '현재 파일 업로드는 비활성 상태입니다. D1에는 파일 원본을 저장하지 않습니다.'}
        </p>
        <button type="button" disabled={!googleDriveConnected} onClick={() => inputRef.current?.click()}>
          {googleDriveConnected ? '파일 선택 및 저장' : '파일 저장소 연결 대기'}
        </button>
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
          <div className="preview-evidence-empty">
            {googleDriveConnected
              ? '업로드된 사건 자료가 없습니다. 파일 선택 후 첫 자료를 기록하세요.'
              : '파일 저장소 연결 대기 중입니다. Google Drive 연결 후 사건 자료가 여기에 표시됩니다.'}
          </div>
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
                  <span>GOOGLE DRIVE</span>
                  <span className={file.driveStatus === 'SYNCED_TO_GOOGLE_DRIVE' ? 'is-synced' : ''}>
                    {file.driveStatus === 'SYNCED_TO_GOOGLE_DRIVE' ? 'DRIVE SYNCED' : 'DRIVE PENDING'}
                  </span>
                </div>
                <button type="button" disabled={!file.downloadUrl} onClick={() => void downloadFile(file)}>다운로드</button>
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
      <p>D1 로그인과 보고서 초안 저장은 활성화되어 있습니다. 파일 원본 저장은 Google Cloud OAuth Client 등록 후 Google Drive로 직접 연결합니다.</p>
    </div>
    <div className="preview-drive-steps">
      <article><span>01</span><strong>D1 업무 저장 활성</strong><p>로그인 세션과 보고서 초안이 Cloudflare D1에 저장됩니다.</p></article>
      <article><span>02</span><strong>Google OAuth 등록</strong><p>승인된 Redirect URI와 Client ID/Secret을 서버 비밀값으로 등록합니다.</p></article>
      <article><span>03</span><strong>Drive 직접 저장</strong><p>사용자가 올린 자료를 날짜·시간·사용자 정보와 함께 사건별 Drive 폴더에 저장합니다.</p></article>
    </div>
    <div className="preview-drive-actions">
      <button type="button" onClick={() => onNavigate('/cases/files')}>자료실로 이동</button>
      <span>현재 상태 · GOOGLE OAUTH CREDENTIALS REQUIRED</span>
    </div>
  </section>
);
