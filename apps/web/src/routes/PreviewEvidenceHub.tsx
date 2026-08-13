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
  roles: string[];
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

export const PreviewEvidenceHub: React.FC<PreviewEvidenceHubProps> = ({ userName, roles, onNavigate }) => {
  const [files, setFiles] = useState<PreviewEvidenceFile[]>([]);
  const [googleDriveConnected, setGoogleDriveConnected] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [busyCount, setBusyCount] = useState(0);
  const [notice, setNotice] = useState(STORAGE_PENDING_MESSAGE);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const draftKeyRef = useRef('');
  const uploadKeysRef = useRef(new Map<string, string>());

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
      const fingerprint = `${file.name}:${file.type}:${file.size}:${file.lastModified}`;
      const idempotencyKey = uploadKeysRef.current.get(fingerprint) ?? crypto.randomUUID();
      uploadKeysRef.current.set(fingerprint, idempotencyKey);
      try {
        if (file.size <= 0 || file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: 파일 크기는 10MB 이하여야 합니다.`);
        const form = new FormData();
        form.set('file', file);
        const response = await fetch('/api/preview/evidence', {
          method: 'POST',
          headers: {
            'X-Preview-Draft-Key': draftKeyRef.current || previewBrowserKey(),
            'Idempotency-Key': idempotencyKey
          },
          body: form
        });
        const payload = await response.json() as { file?: PreviewEvidenceFile; error?: string; code?: string };
        if (!response.ok || !payload.file) {
          uploadKeysRef.current.delete(fingerprint);
          throw new Error(payload.error ?? `${file.name}: 업로드에 실패했습니다.`);
        }
        uploadKeysRef.current.delete(fingerprint);
        setFiles((current) => [payload.file as PreviewEvidenceFile, ...current.filter((item) => item.id !== payload.file?.id)]);
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
            사건 자료를 한곳에서<br />
            {googleDriveConnected ? '안전하게 저장합니다.' : '정리할 준비를 합니다.'}
          </h2>
          <p>사건, 일정, 보고서 초안은 D1에 저장되고 있습니다. 파일 원본 저장은 요청하신 대로 Google Drive 연결 전까지 보류합니다.</p>
        </div>
        <div className="preview-drive-card">
          <span>GOOGLE DRIVE</span>
          <strong>{googleDriveConnected ? '연결 완료' : '연동 보류'}</strong>
          <small>R2 미사용 · 현재 보고서와 사건 데이터만 D1에 저장</small>
          {roles.includes('admin') && <button type="button" onClick={() => onNavigate('/integrations/google')}>관리자 연결 설정</button>}
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

interface GoogleDriveStatus {
  connected: boolean;
  configured: boolean;
  status: 'CONNECTED' | 'DISCONNECTED';
  storageProvider: 'GOOGLE_DRIVE';
  accountEmail: string | null;
  allowedDomain: string | null;
}

export const PreviewGoogleDriveSetup: React.FC<{ onNavigate: (path: string) => void }> = ({ onNavigate }) => {
  const [status, setStatus] = useState<GoogleDriveStatus | null>(null);
  const [folderId, setFolderId] = useState('');
  const [boundFolder, setBoundFolder] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('Google OAuth 연결 상태를 확인하고 있습니다.');
  const [error, setError] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch('/api/google/status', { headers: { Accept: 'application/json' } });
      const payload = await response.json() as GoogleDriveStatus & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Google Drive 상태를 확인하지 못했습니다.');
      setStatus(payload);
      setNotice(payload.connected
        ? `회사 Google Drive가 연결되었습니다${payload.accountEmail ? ` · ${payload.accountEmail}` : ''}. 계정을 바꾸면 사건 폴더를 다시 지정해야 합니다. 기존 파일은 삭제되지 않으며 새 계정에 공유·이관되어 있어야 계속 열 수 있습니다.`
        : payload.configured
          ? 'Google OAuth 설정이 준비되었습니다. 관리자 동의를 진행하세요.'
          : 'Cloudflare Secret에 Google OAuth 설정을 등록해야 합니다.');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google Drive 상태를 확인하지 못했습니다.');
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);

  const connect = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/google/oauth/start', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? 'Google OAuth를 시작하지 못했습니다.');
      const authorizationUrl = new URL(payload.authorizationUrl);
      if (authorizationUrl.origin !== 'https://accounts.google.com') throw new Error('허용되지 않은 Google 승인 주소입니다.');
      window.location.assign(authorizationUrl.toString());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google OAuth를 시작하지 못했습니다.');
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/google/oauth/disconnect', { method: 'POST', headers: { Accept: 'application/json' } });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Google Drive 연결을 해제하지 못했습니다.');
      setBoundFolder(null);
      await loadStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Google Drive 연결을 해제하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const bindFolder = async () => {
    if (!folderId.trim()) {
      setError('Google Drive 폴더 ID를 입력하세요.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/google/folders/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Preview-Draft-Key': previewBrowserKey() },
        body: JSON.stringify({ folderId: folderId.trim() })
      });
      const payload = await response.json() as { folder?: { id: string; name: string }; error?: string };
      if (!response.ok || !payload.folder) throw new Error(payload.error ?? '사건 폴더를 확인하지 못했습니다.');
      setBoundFolder(payload.folder);
      setNotice(`“${payload.folder.name}” 폴더가 현재 초안 자료실에 연결되었습니다.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '사건 폴더를 확인하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
  <section className="route-view preview-drive-setup" aria-labelledby="preview-drive-title">
    <div>
      <span className="workspace-eyebrow">GOOGLE WORKSPACE · SECURE CONNECTION</span>
      <h2 id="preview-drive-title">Google Drive 연결</h2>
      <p>D1에는 로그인·보고서 초안·파일 메타데이터만 저장합니다. 파일 원본은 관리자가 승인한 Google Drive 폴더에 직접 저장되며 R2는 사용하지 않습니다.</p>
    </div>
    <div className="preview-drive-status" role="status" aria-live="polite">
      <span className={status?.connected ? 'is-connected' : ''}>{status?.connected ? 'CONNECTED' : 'DISCONNECTED'}</span>
      <strong>{notice}</strong>
    </div>
    <div className="preview-drive-steps">
      <article><span>01</span><strong>D1 업무 저장 활성</strong><p>로그인 세션과 보고서 초안은 Cloudflare D1에 저장됩니다.</p></article>
      <article><span>02</span><strong>관리자 OAuth 동의</strong><p>PKCE와 일회용 state를 사용하며 Refresh Token 원문은 브라우저와 D1에 노출하지 않습니다.</p></article>
      <article><span>03</span><strong>사건 폴더 지정</strong><p>Google Drive 폴더 ID를 검증한 뒤 현재 초안의 자료 저장 위치로 연결합니다.</p></article>
    </div>
    {status?.connected ? (
      <div className="preview-drive-folder-form">
        <label htmlFor="preview-google-folder-id">Google Drive 폴더 ID</label>
        <div>
          <input
            id="preview-google-folder-id"
            value={folderId}
            onChange={(event) => setFolderId(event.target.value)}
            placeholder="Drive 폴더 URL의 /folders/ 다음 ID"
            autoComplete="off"
          />
          <button type="button" disabled={busy} onClick={() => void bindFolder()}>폴더 확인·연결</button>
        </div>
        {boundFolder ? <small>연결됨 · {boundFolder.name} ({boundFolder.id})</small> : null}
      </div>
    ) : null}
    {error ? <div className="preview-upload-error" role="alert">{error}<button type="button" onClick={() => void loadStatus()}>상태 다시 확인</button></div> : null}
    <div className="preview-drive-actions">
      <div>
        <button type="button" disabled={busy || !status?.configured} onClick={() => void connect()}>
          {busy ? '처리 중…' : status?.connected ? '다른 회사 Google 계정으로 변경' : '회사 Google 계정 연결'}
        </button>
        {status?.connected ? <button type="button" disabled={busy} onClick={() => void disconnect()}>연결 해제</button> : null}
        <button type="button" disabled={!status?.connected} onClick={() => onNavigate('/cases/files')}>자료실로 이동</button>
      </div>
      {status?.allowedDomain ? <small>허용 회사 도메인 · @{status.allowedDomain}</small> : null}
      <span>저장 방식 · GOOGLE DRIVE DIRECT · R2 미사용</span>
    </div>
  </section>
  );
};
