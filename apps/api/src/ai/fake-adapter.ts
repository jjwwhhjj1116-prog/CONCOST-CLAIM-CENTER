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

/**
 * Deterministic local fake AI provider adapter.
 * Used for testing and CI without external network access or real API keys.
 */
export async function executeFakeAdapterCall(
  apiKey: string | null,
  options: FakeAdapterRequestOptions
): Promise<FakeAdapterResponse> {
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
  if (apiKey === 'INVALID_KEY' || options.prompt.includes('TRIGGER_BAD_KEY')) {
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

  if (options.prompt.includes('TRIGGER_SLOW_SUCCESS')) {
    const completed = await waitForAbortableDelay(750, options.abortSignal);
    if (!completed) {
      return {
        status: 'USER_CANCEL', statusCode: 499, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
        errorMessage: 'User canceled the in-flight provider request'
      };
    }
  }

  // 2. Timeout simulation
  if (options.prompt.includes('TRIGGER_TIMEOUT')) {
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
  if (options.prompt.includes('TRIGGER_RATE_LIMIT')) {
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
  if (options.prompt.includes('TRIGGER_SERVER_ERROR')) {
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
  if (options.prompt.includes('TRIGGER_MALFORMED_SCHEMA')) {
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
  if (options.prompt.includes('TRIGGER_STREAM_ABORT')) {
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

  // 7. Success case
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
