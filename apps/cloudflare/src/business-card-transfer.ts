import type { CloudflareEnv } from './index';
import { GoogleDriveError, sha256Hex, validateEvidenceFile } from './google-drive';

const BASE = '/api/business-cards/transfers';
const IMAGE_LIMIT = 900_000;
const BODY_LIMIT = 1_900_000;
const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const encoder = new TextEncoder();
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
const fail = (message: string, status: number, code: string) => reply({ error: message, code }, status);
const hex = (value: Uint8Array) => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
const unhex = (value: string) => Uint8Array.from(value.match(/.{2}/g) ?? [], byte => parseInt(byte, 16));
const b64 = (value: Uint8Array) => { let output = ''; for (let i = 0; i < value.length; i += 8192) output += String.fromCharCode(...value.subarray(i, i + 8192)); return btoa(output); };
const unb64 = (value: string) => Uint8Array.from(atob(value), char => char.charCodeAt(0));

async function transferKey(env: CloudflareEnv): Promise<CryptoKey | null> {
  const secret = env.GOOGLE_WORKSPACE_CREDENTIAL_MASTER_KEY?.trim() || env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) return null;
  const input = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('claim-center-card-transfer-v1'), info: encoder.encode('phone-to-pc-images') }, input, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

async function readForm(request: Request): Promise<FormData> {
  if (Number(request.headers.get('Content-Length') || '0') > BODY_LIMIT || !request.body) throw new GoogleDriveError('TRANSFER_TOO_LARGE', 413, '전송 사진 두 장의 크기를 줄여 주세요.');
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > BODY_LIMIT) { await reader.cancel(); throw new GoogleDriveError('TRANSFER_TOO_LARGE', 413, '전송 사진 두 장의 크기를 줄여 주세요.'); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return await new Request(request.url, { method: 'POST', headers: request.headers, body: bytes }).formData(); }
  catch { throw new GoogleDriveError('TRANSFER_FORM_INVALID', 400, '사진 전송 형식을 확인해 주세요.'); }
}

async function encryptImage(value: FormDataEntryValue | null, side: 'front' | 'back', key: CryptoKey, actorId: string, tokenHash: string) {
  if (!(value instanceof File)) throw new GoogleDriveError('TRANSFER_BOTH_SIDES_REQUIRED', 400, '명함 앞면과 뒷면 사진을 모두 선택해 주세요.');
  if (value.size > IMAGE_LIMIT) throw new GoogleDriveError('TRANSFER_IMAGE_TOO_LARGE', 413, '각 사진은 900KB 이하여야 합니다.');
  if (!MIME_TYPES.has(value.type) || value.size < 16) throw new GoogleDriveError('TRANSFER_IMAGE_INVALID', 415, '각 사진은 JPG·PNG·WEBP여야 합니다.');
  const image = await validateEvidenceFile(value);
  if (image.mimeType !== value.type) throw new GoogleDriveError('TRANSFER_IMAGE_INVALID', 415, '사진 내용과 파일 형식이 일치하지 않습니다.');
  if (image.mimeType === 'image/jpeg' && (image.bytes[image.bytes.length - 2] !== 0xff || image.bytes[image.bytes.length - 1] !== 0xd9)) throw new GoogleDriveError('TRANSFER_IMAGE_INVALID', 415, 'JPEG 사진의 끝부분이 손상되었습니다.');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(`${tokenHash}:${actorId}:${side}`) }, key, image.bytes as Uint8Array<ArrayBuffer>);
  return { side, ciphertext: b64(new Uint8Array(ciphertext)), iv: hex(iv), originalName: value.name, mimeType: image.mimeType };
}

/** Caller must supply the authenticated user from the existing session. */
export async function handleBusinessCardTransfer(request: Request, env: CloudflareEnv, actor: { id: string }): Promise<Response> {
  if (!env.DB) return fail('촬영 연결 저장소가 준비되지 않았습니다.', 503, 'D1_NOT_CONFIGURED');
  if (!actor?.id) return fail('로그인이 필요합니다.', 401, 'AUTH_REQUIRED');
  const db = env.DB; const url = new URL(request.url); const method = request.method.toUpperCase();
  const origin = request.headers.get('Origin');
  if (!['GET', 'HEAD'].includes(method) && ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site' || (request.headers.has('Cookie') && origin !== url.origin))) return fail('현재 스튜디오 화면에서 다시 시도해 주세요.', 403, 'ORIGIN_MISMATCH');
  try {
    const now = new Date().toISOString();
    if (url.pathname === BASE && method === 'POST') {
      if (!await transferKey(env)) return fail('촬영 연결 암호화 설정이 없습니다.', 503, 'TRANSFER_KEY_NOT_CONFIGURED');
      await db.prepare('DELETE FROM preview_business_card_transfers WHERE expires_at<=?').bind(now).run();
      const token = hex(crypto.getRandomValues(new Uint8Array(24)));
      const expiresAt = new Date(Date.now() + 600_000).toISOString();
      const inserted = await db.prepare("INSERT INTO preview_business_card_transfers(token_hash,organization_id,actor_id,status,created_at,expires_at) SELECT ?,'concost',?,'PENDING',?,? WHERE (SELECT COUNT(*) FROM preview_business_card_transfers WHERE actor_id=? AND expires_at>?)<3")
        .bind(await sha256Hex(token), actor.id, now, expiresAt, actor.id, now).run();
      if (inserted.meta?.changes !== 1) return fail('열린 촬영 연결이 3개입니다. 이전 연결을 닫고 다시 시도해 주세요.', 429, 'TRANSFER_LIMIT');
      return reply({ token, expiresAt }, 201);
    }
    const match = new RegExp(`^${BASE}/session(?:/(upload|photo))?$`).exec(url.pathname);
    if (!match) return fail('촬영 연결을 찾을 수 없습니다.', 404, 'TRANSFER_NOT_FOUND');
    const token = request.headers.get('X-Card-Transfer-Token') ?? '';
    if (!/^[0-9a-f]{48}$/.test(token)) return fail('촬영 연결을 찾을 수 없습니다.', 404, 'TRANSFER_NOT_FOUND');
    if ([...url.searchParams.keys()].some(key => match[1] !== 'photo' || key !== 'side')) return fail('촬영 연결 요청을 확인해 주세요.', 400, 'TRANSFER_QUERY_INVALID');
    const hash = await sha256Hex(token);
    const row = await db.prepare('SELECT status,expires_at AS expiresAt FROM preview_business_card_transfers WHERE token_hash=? AND actor_id=? AND organization_id=?')
      .bind(hash, actor.id, 'concost').first<{ status: string; expiresAt: string }>();
    if (!row) return fail('촬영 연결이 없거나 만료됐습니다. PC에서 새 QR을 만들어 주세요.', 404, 'TRANSFER_NOT_FOUND');
    if (method === 'DELETE' && !match[1]) {
      await db.prepare('DELETE FROM preview_business_card_transfers WHERE token_hash=? AND actor_id=?').bind(hash, actor.id).run();
      return reply({ ok: true });
    }
    if (row.expiresAt <= now) return fail('촬영 연결이 없거나 만료됐습니다. PC에서 새 QR을 만들어 주세요.', 404, 'TRANSFER_NOT_FOUND');
    if (method === 'GET' && !match[1]) return reply({ status: row.status, expiresAt: row.expiresAt });
    if (method === 'POST' && match[1] === 'upload') {
      if (row.status !== 'PENDING') return fail('이미 사진이 전송됐습니다. PC에서 확인해 주세요.', 409, 'TRANSFER_ALREADY_UPLOADED');
      if (!db.batch) return fail('촬영 연결 저장을 준비하지 못했습니다.', 503, 'D1_BATCH_REQUIRED');
      const key = await transferKey(env); if (!key) return fail('촬영 연결 암호화 설정이 없습니다.', 503, 'TRANSFER_KEY_NOT_CONFIGURED');
      const form = await readForm(request);
      const front = await encryptImage(form.get('file'), 'front', key, actor.id, hash);
      const back = await encryptImage(form.get('backFile'), 'back', key, actor.id, hash);
      const uploadedAt = new Date().toISOString(); const nonce = crypto.randomUUID();
      const statements = [db.prepare("UPDATE preview_business_card_transfers SET status='UPLOADED',uploaded_at=?,upload_nonce=? WHERE token_hash=? AND actor_id=? AND status='PENDING' AND expires_at>?")
        .bind(uploadedAt, nonce, hash, actor.id, uploadedAt), ...[front, back].map(image => db.prepare("INSERT INTO preview_business_card_transfer_images(token_hash,side,ciphertext,iv,original_name,mime_type) SELECT token_hash,?,?,?,?,? FROM preview_business_card_transfers WHERE token_hash=? AND actor_id=? AND status='UPLOADED' AND upload_nonce=?")
        .bind(image.side, image.ciphertext, image.iv, image.originalName, image.mimeType, hash, actor.id, nonce))];
      const results = await db.batch(statements) as Array<{ meta?: { changes?: number } }>;
      if (results.some(result => result.meta?.changes !== 1)) return fail('촬영 연결이 변경됐거나 만료됐습니다.', 409, 'TRANSFER_CONFLICT');
      return reply({ status: 'UPLOADED' });
    }
    if (method === 'GET' && match[1] === 'photo') {
      const side = url.searchParams.get('side');
      if (side !== 'front' && side !== 'back') return fail('사진 면을 선택해 주세요.', 400, 'TRANSFER_SIDE_REQUIRED');
      if (row.status !== 'UPLOADED') return fail('아직 사진이 도착하지 않았습니다.', 409, 'TRANSFER_NOT_UPLOADED');
      const key = await transferKey(env); if (!key) return fail('촬영 연결 암호화 설정이 없습니다.', 503, 'TRANSFER_KEY_NOT_CONFIGURED');
      const photo = await db.prepare('SELECT ciphertext,iv,mime_type AS mimeType FROM preview_business_card_transfer_images WHERE token_hash=? AND side=?').bind(hash, side).first<{ ciphertext: string; iv: string; mimeType: string }>();
      if (!photo) return fail('명함 사진을 읽지 못했습니다.', 409, 'TRANSFER_IMAGE_MISSING');
      const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(photo.iv) as Uint8Array<ArrayBuffer>, additionalData: encoder.encode(`${hash}:${actor.id}:${side}`) }, key, unb64(photo.ciphertext) as Uint8Array<ArrayBuffer>);
      return new Response(bytes, { headers: { 'Content-Type': photo.mimeType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
    }
    return fail('지원하지 않는 촬영 요청입니다.', 405, 'METHOD_NOT_ALLOWED');
  } catch (reason) {
    if (reason instanceof GoogleDriveError) return fail(reason.message, reason.status, reason.code);
    return fail('촬영 연결을 처리하지 못했습니다. 다시 시도해 주세요.', 503, 'TRANSFER_FAILED');
  }
}
