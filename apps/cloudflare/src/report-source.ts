import { downloadEvidenceFromDrive, type GoogleFetch } from './google-drive';

// ponytail: bounded, process-local reuse only; cross-worker reuse needs a dedicated persistent model.
const transcriptions = new WeakMap<object, Map<string, { text: string; expiresAt: number }>>();
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 32;

/** Call only after current authorization, policy and original byte/hash verification. */
export async function reuseReportTranscription(scope: object, key: string, read: () => Promise<string>, now = Date.now): Promise<string> {
  let entries = transcriptions.get(scope);
  if (!entries) { entries = new Map(); transcriptions.set(scope, entries); }
  for (const [id, entry] of entries) if (entry.expiresAt <= now()) entries.delete(id);
  const hit = entries.get(key);
  if (hit) return hit.text;
  const text = await read(); // A thrown error or partial transcription is never retained.
  if (!text.trim() || text.length > 100_000) throw new Error('원문 인식 결과 크기를 확인해 주세요.');
  while (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
  entries.set(key, { text, expiresAt: now() + TTL_MS });
  return text;
}

/** One deadline covers token refresh, headers and the full binary stream. */
export async function readReportDriveBytes(fetcher: GoogleFetch, getToken: (bounded: GoogleFetch) => Promise<string>, fileId: string, size: number, deadline: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!Number.isInteger(size) || size < 1 || size > 10_000_000) throw new Error('원문 크기 제한(10MB)을 확인해 주세요.');
  if (Date.now() >= deadline) throw new Error('Drive 원문 읽기 시간 한도를 넘었습니다.');
  const controller = new AbortController();
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let onAbort: (() => void) | undefined;
  const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
  const bounded: GoogleFetch = (input, init) => fetcher(input, { ...init, signal: controller.signal });
  try {
    return await Promise.race([
      (async () => {
        const token = await getToken(bounded);
        if (controller.signal.aborted) throw new Error('Drive 원문 읽기 시간 한도를 넘었습니다.');
        const response = await downloadEvidenceFromDrive(bounded, token, fileId);
        if (!response.body) throw new Error('Drive 원문을 읽지 못했습니다.');
        reader = response.body.getReader();
        const bytes = new Uint8Array(size); let offset = 0;
        while (true) {
          if (controller.signal.aborted) throw new Error('Drive 원문 읽기 시간 한도를 넘었습니다.');
          const next = await reader.read(); if (next.done) break;
          if (offset + next.value.length > size) throw new Error('원문 크기가 저장 기록과 다릅니다.');
          bytes.set(next.value, offset); offset += next.value.length;
        }
        if (offset !== size) throw new Error('원문 크기가 저장 기록과 다릅니다.');
        return bytes;
      })(),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => { void reader?.cancel().catch(() => {}); reject(new Error('Drive 원문 읽기 시간 한도를 넘었습니다.')); };
        controller.signal.addEventListener('abort', onAbort, { once: true });
      })
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener('abort', onAbort);
    controller.abort();
    void reader?.cancel().catch(() => {});
  }
}
