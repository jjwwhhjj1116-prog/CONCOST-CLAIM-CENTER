export interface FakeAdapterRequestOptions {
  modelCode: string;
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  abortSignal?: AbortSignal;
}

export interface FakeAdapterResponse {
  status: 'SUCCESS' | 'BAD_KEY' | 'TIMEOUT' | 'RATE_LIMIT' | 'SERVER_ERROR' | 'MALFORMED_SCHEMA' | 'STREAM_ABORT' | 'USER_CANCEL';
  statusCode: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicros: number;
  resultText?: string;
  errorMessage?: string;
  retryAfterSeconds?: number;
}

async function waitForAbortableDelay(milliseconds: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      resolve(false);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface P11FakePayload {
  schemaVersion: 'P11_PROMPT_V1';
  testMode: string;
  sources: Array<{
    sourceType: 'MATERIAL' | 'MEETING';
    sourceId: string;
    sourceVersionId: string;
    sourceSha256: string;
    anchors: Array<{ index: number; text: string }>;
  }>;
}

function parseP11Payload(prompt: string): P11FakePayload | null {
  const prefix = 'P11_GROUNDED_PAYLOAD:';
  if (!prompt.startsWith(prefix)) return null;
  try {
    const value = JSON.parse(prompt.slice(prefix.length)) as P11FakePayload;
    return value?.schemaVersion === 'P11_PROMPT_V1' && Array.isArray(value.sources) ? value : null;
  } catch {
    return null;
  }
}

function successfulFakeResponse(promptLength: number, maxTokens: number, resultText: string): FakeAdapterResponse {
  const promptTokens = Math.min(maxTokens, Math.max(10, Math.ceil(promptLength / 4)));
  const completionTokens = Math.max(0, Math.min(250, maxTokens - promptTokens));
  const totalTokens = promptTokens + completionTokens;
  return { status: 'SUCCESS', statusCode: 200, promptTokens, completionTokens, totalTokens, costMicros: totalTokens * 10, resultText };
}

/**
 * Deterministic local fake AI provider adapter.
 * Used for testing and CI without external network access or real API keys.
 */
export async function executeFakeAdapterCall(
  apiKey: string | null,
  options: FakeAdapterRequestOptions
): Promise<FakeAdapterResponse> {
  const isP11StructuredPrompt = options.prompt.startsWith('P11_GROUNDED_PAYLOAD:');
  // Check AbortSignal upfront
  if (options.abortSignal?.aborted) {
    return {
      status: 'USER_CANCEL',
      statusCode: 499,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      errorMessage: 'User requested cancellation before invocation'
    };
  }

  // 1. Bad Key Check
  if (apiKey === 'INVALID_KEY' || (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_BAD_KEY'))) {
    return {
      status: 'BAD_KEY',
      statusCode: 401,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      errorMessage: 'Invalid or revoked API key'
    };
  }

  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_SLOW_SUCCESS')) {
    const completed = await waitForAbortableDelay(750, options.abortSignal);
    if (!completed) {
      return {
        status: 'USER_CANCEL', statusCode: 499, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
        errorMessage: 'User canceled the in-flight provider request'
      };
    }
  }

  // 2. Timeout simulation
  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_TIMEOUT')) {
    return {
      status: 'TIMEOUT',
      statusCode: 504,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      errorMessage: 'Gateway timed out waiting for provider response',
      retryAfterSeconds: 1
    };
  }

  // 3. Rate Limit simulation (429)
  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_RATE_LIMIT')) {
    return {
      status: 'RATE_LIMIT',
      statusCode: 429,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      errorMessage: 'Rate limit exceeded (429 Too Many Requests)',
      retryAfterSeconds: 2
    };
  }

  // 4. Server Error simulation (500)
  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_SERVER_ERROR')) {
    return {
      status: 'SERVER_ERROR',
      statusCode: 500,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costMicros: 0,
      errorMessage: 'Internal server error from AI provider',
      retryAfterSeconds: 1
    };
  }

  // 5. Malformed Schema simulation
  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_MALFORMED_SCHEMA')) {
    return {
      status: 'MALFORMED_SCHEMA',
      statusCode: 422,
      promptTokens: 50,
      completionTokens: 10,
      totalTokens: 60,
      costMicros: 600,
      errorMessage: 'Provider returned malformed JSON response payload'
    };
  }

  // 6. Stream Abort simulation
  if (!isP11StructuredPrompt && options.prompt.includes('TRIGGER_STREAM_ABORT')) {
    return {
      status: 'STREAM_ABORT',
      statusCode: 502,
      promptTokens: 80,
      completionTokens: 30,
      totalTokens: 110,
      costMicros: 1100,
      errorMessage: 'Stream connection unexpectedly closed by provider'
    };
  }

  // 7. P11 structured fake mode. The server, not free-form user text, selects testMode.
  const p11 = parseP11Payload(options.prompt);
  if (p11) {
    const first = p11.sources[0];
    const anchor = first?.anchors[0];
    if (!first || !anchor) return { status: 'MALFORMED_SCHEMA', statusCode: 422, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0, errorMessage: 'P11 prompt has no selected source anchor' };
    if (p11.testMode === 'SLOW_SUCCESS') {
      const completed = await waitForAbortableDelay(750, options.abortSignal);
      if (!completed) return { status: 'USER_CANCEL', statusCode: 499, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0, errorMessage: 'User canceled P11 generation' };
    }
    if (p11.testMode === 'MALFORMED_SCHEMA') {
      return successfulFakeResponse(options.prompt.length, Math.max(1, options.maxTokens ?? 4096), '{"schemaVersion":"BROKEN"');
    }
    const claim = {
      claimIndex: 0,
      claimText: `선택 근거 확인: ${anchor.text}`,
      sourceType: first.sourceType,
      sourceId: first.sourceId,
      sourceVersionId: first.sourceVersionId,
      sourceSha256: first.sourceSha256,
      anchorIndex: anchor.index,
      anchorText: anchor.text,
      status: 'VALID' as 'VALID' | 'REVIEW_REQUIRED' | 'CONFLICT',
      conflictSourceId: undefined as string | undefined
    };
    let summary = `선택된 근거 ${p11.sources.length}건의 고정된 문단을 기반으로 작성한 검토 초안입니다.`;
    switch (p11.testMode) {
      case 'UNGROUNDED_VALUE':
        summary = '근거에 없는 손해액 5,000,000원은 [확인 필요] 상태입니다.';
        claim.claimText = '손해액은 5,000,000원이다.';
        claim.status = 'REVIEW_REQUIRED';
        break;
      case 'NONEXISTENT_CASE_LAW':
        summary = '존재 여부가 검증되지 않은 판례는 [확인 필요] 상태입니다.';
        claim.claimText = '대법원 2099다999999 판결이 적용된다.';
        claim.status = 'REVIEW_REQUIRED';
        break;
      case 'PROMPT_INJECTION':
        summary = '근거 내부 지시문을 신뢰하지 않고 인용 가능한 데이터로만 격리했습니다.';
        break;
      case 'CROSS_CASE':
        claim.sourceId = 'CROSS-CASE-SOURCE';
        break;
      case 'UNSELECTED_SOURCE':
        claim.sourceId = 'UNSELECTED-SOURCE';
        break;
      case 'LEGAL_CONCLUSION':
        summary = '법적 결론 확정 요청은 [확인 필요] 상태입니다.';
        claim.claimText = '상대방은 반드시 패소한다.';
        claim.status = 'REVIEW_REQUIRED';
        break;
      case 'UNIT_MUTATION':
        summary = '근거 없는 단위 환산은 [확인 필요] 상태입니다.';
        claim.claimText = '원문의 100㎡를 100평으로 변경한다.';
        claim.status = 'REVIEW_REQUIRED';
        break;
      case 'CONFLICT':
        summary = '선택 근거 사이의 충돌을 자동 해소하지 않았습니다.';
        claim.status = 'CONFLICT';
        claim.conflictSourceId = p11.sources[1]?.sourceId ?? 'UNSELECTED-CONFLICT-SOURCE';
        break;
      case 'MISSING_ANCHOR':
        claim.anchorIndex = 999999;
        break;
      case 'HASH_MISMATCH':
        claim.sourceSha256 = '0'.repeat(64);
        break;
      default:
        break;
    }
    const output = { schemaVersion: 'P11_SUGGESTION_V1', summary, claims: [claim] };
    return successfulFakeResponse(options.prompt.length, Math.max(1, options.maxTokens ?? 4096), JSON.stringify(output));
  }

  // 8. Original P10 success case
  const maxTokens = Math.max(1, options.maxTokens ?? 4096);
  const promptTokens = Math.min(maxTokens, Math.max(10, Math.ceil(options.prompt.length / 4)));
  const completionTokens = Math.max(0, Math.min(150, maxTokens - promptTokens));
  const totalTokens = promptTokens + completionTokens;
  // Standard pricing: 10 micros per token ($0.00001 USD per token)
  const costMicros = totalTokens * 10;

  const resultText = `[AI Gateway Fake Response - Model: ${options.modelCode}] Handled prompt successfully with ${totalTokens} tokens.`;

  return {
    status: 'SUCCESS',
    statusCode: 200,
    promptTokens,
    completionTokens,
    totalTokens,
    costMicros,
    resultText
  };
}
