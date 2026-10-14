import { createLocalDocumentRecovery, type RecoveryMetadata } from './local-document-recovery';

export interface NativeRecoveryScope { accountId: string; workspaceId: string; version: number }
export interface NativeRecoveryPayload extends Record<string, unknown> {
  kind: 'HWP5'; original: File; edited: File; originalSha256: string; editedSha256: string; serverVersion: number;
}
export const nativeRecoverySha = async (bytes: ArrayBuffer): Promise<string> => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Keep the pinned embed's password boundary. Other formats/properties are not assumed safe. */
export async function assertNativeRecoverySource(bytes: ArrayBuffer, name: string): Promise<void> {
  const unsupported = '이 문서는 HWP 작업본 자동 보관을 지원하지 않습니다. 암호·배포·보호 속성이 없는 HWP 5 문서만 지원합니다. 파일로 직접 보관해 주세요.';
  if (!/\.hwp$/iu.test(name)) throw new Error(unsupported);
  try {
    const { CFB } = await import('xlsx');
    const file = CFB.read(new Uint8Array(bytes), { type: 'array' });
    const header = CFB.find(file, 'FileHeader')?.content;
    if (!header || header.length !== 256) throw new Error(unsupported);
    const data = new Uint8Array(header);
    if (new TextDecoder().decode(data.subarray(0, 17)) !== 'HWP Document File' || data[35] !== 5 || (new DataView(data.buffer).getUint32(36, true) & ~1) !== 0) throw new Error(unsupported);
  } catch { throw new Error(unsupported); }
}

export async function nativeRecoveryPayload(original: File, bytes: Uint8Array, name: string, version: number): Promise<NativeRecoveryPayload> {
  const source = await original.arrayBuffer(), copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  await assertNativeRecoverySource(source, original.name);
  await assertNativeRecoverySource(copy.buffer, name);
  if (!Number.isSafeInteger(version) || version < 0) throw new Error('원고 버전을 확인하지 못해 HWP 작업본을 보관하지 않았습니다.');
  return { kind: 'HWP5', original, edited: new File([copy.buffer], name, { type: 'application/x-hwp' }), originalSha256: await nativeRecoverySha(source), editedSha256: await nativeRecoverySha(copy.buffer), serverVersion: version };
}

export async function readNativeRecovery(scope: NativeRecoveryScope, candidate: RecoveryMetadata): Promise<NativeRecoveryPayload> {
  const prefix = scope.workspaceId + ':';
  if (candidate.accountId !== scope.accountId || !candidate.workspaceId.startsWith(prefix) || !/^[a-f0-9]{64}$/u.test(candidate.workspaceId.slice(prefix.length))) throw new Error('다른 계정이나 문서의 HWP 복구본은 열지 않습니다.');
  const client = createLocalDocumentRecovery<NativeRecoveryPayload>({ accountId: scope.accountId, workspaceId: candidate.workspaceId });
  const record = await client.read(candidate.snapshotId), saved = record?.payload;
  if (!saved || saved.kind !== 'HWP5' || !(saved.original instanceof File) || !(saved.edited instanceof File)) throw new Error('HWP 복구본이 없거나 형식이 잘못되었습니다. 기존 원고와 복구본은 유지됩니다.');
  const verified = await nativeRecoveryPayload(saved.original, new Uint8Array(await saved.edited.arrayBuffer()), saved.edited.name, saved.serverVersion);
  if (verified.originalSha256 !== saved.originalSha256 || verified.editedSha256 !== saved.editedSha256 || candidate.workspaceId !== prefix + saved.originalSha256) throw new Error('HWP 복구본 무결성 검사가 실패했습니다. 기존 원고와 복구본은 유지됩니다.');
  return verified;
}
