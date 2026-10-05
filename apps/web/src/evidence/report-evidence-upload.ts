import { reportSourceSha256 } from '../documents/report-native-source';
import { fetchEvidenceUpload } from './upload-evidence';

interface StoredReportFile { id: string; originalName: string; downloadUrl: string; sha256: string; byteSize: number }
const UNKNOWN_UPLOAD = '보고서 자료의 저장 결과를 확인하지 못했습니다. 재업로드하지 말고 관리자에게 저장 기록 확인을 요청해 주세요. HWP 다운로드로 편집 내용을 보관할 수 있습니다.';

/** Component-lifetime guard; the server ledger remains authoritative across reloads/tabs. */
export function createReportEvidenceUploader() {
  const uncertainCases = new Set<string>();
  const inFlight = new Set<string>();
  const keys = new Map<string, string>();
  return {
    isBlocked: (caseId: string) => uncertainCases.has(caseId),
    async upload(caseId: string, file: File, isCurrent: () => boolean): Promise<StoredReportFile> {
      if (uncertainCases.has(caseId)) throw new Error(UNKNOWN_UPLOAD);
      if (inFlight.has(caseId)) throw new Error('보고서 자료 저장이 진행 중입니다.');
      if (!isCurrent()) throw new Error('프로젝트 또는 원고가 변경되어 전송하지 않았습니다.');
      inFlight.add(caseId);
      let retryable = false;
      let sent = false;
      try {
        const sha256 = await reportSourceSha256(await file.arrayBuffer());
        if (!isCurrent()) throw new Error('프로젝트 또는 원고가 변경되어 전송하지 않았습니다.');
        const fingerprint = JSON.stringify([caseId, file.name, file.size, sha256]);
        const key = keys.get(fingerprint) ?? crypto.randomUUID();
        keys.set(fingerprint, key);
        const form = new FormData(); form.set('file', file); form.set('category', 'REPORT_REFERENCE');
        sent = true;
        const response = await fetchEvidenceUpload(`/api/cases/${encodeURIComponent(caseId)}/evidence`, {
          method: 'POST', headers: { 'Idempotency-Key': key }, body: form
        }, { reuseExact: true, isCurrent });
        const payload = await response.json() as { file?: StoredReportFile; error?: string; code?: string; retryable?: boolean };
        retryable = !response.ok && (payload.retryable === true || payload.code === 'UPLOAD_CANCELLED');
        if (retryable) keys.delete(fingerprint);
        if (!response.ok) throw new Error(payload.error ?? '보고서 자료 저장에 실패했습니다.');
        const stored = payload.file;
        if (!stored?.id || stored.downloadUrl !== `/api/cases/evidence/${encodeURIComponent(stored.id)}/download`
          || stored.sha256 !== sha256 || stored.byteSize !== file.size) throw new Error('보고서 자료 저장 응답의 파일·크기·해시가 일치하지 않습니다.');
        keys.delete(fingerprint);
        sent = false; // A verified receipt is safe even if the user moved to another case.
        if (!isCurrent()) throw new Error('프로젝트 또는 원고가 변경되어 적용하지 않았습니다. 저장된 자료는 원래 프로젝트에 보존됩니다.');
        return stored;
      } catch (reason) {
        if (sent && !retryable) { uncertainCases.add(caseId); throw new Error(`${reason instanceof Error ? reason.message : '파일 저장 응답 오류'} ${UNKNOWN_UPLOAD}`); }
        throw reason;
      } finally { inFlight.delete(caseId); }
    }
  };
}
