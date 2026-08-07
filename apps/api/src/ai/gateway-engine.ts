import * as crypto from 'node:crypto';
import type { PrismaClient } from '@claim-studio/database';
import { assertSafeBaseUrl } from './ssrf-guard';
import { resolveSecretReference, redactSecretText } from './secret-resolver';
import { executeFakeAdapterCall, type FakeAdapterResponse } from './fake-adapter';

export interface AiRequestPayload {
  organizationId: string;
  caseId: string;
  userId: string;
  providerConfigId: string;
  modelCode: string;
  prompt: string;
  idempotencyKey: string;
  maxTokens?: number;
}

export interface AiGatewayResult {
  requestId: string;
  status: 'COMPLETED' | 'FAILED' | 'CANCELED';
  reservedCostMicros: number;
  actualCostMicros: number;
  totalTokens: number;
  resultText?: string;
  redactedErrorMessage?: string;
  attemptsCount: number;
}

export class AiGatewayError extends Error {
  constructor(public readonly status: number, message: string) {
    super(redactSecretText(message));
    this.name = 'AiGatewayError';
  }
}

/**
 * Main AI Gateway Engine for handling provider invocations, budget reservations,
 * SSRF security checks, idempotency, bounded retries, and ledger audit logging.
 */
export async function processAiGenerationRequest(
  db: PrismaClient,
  payload: AiRequestPayload,
  abortSignal?: AbortSignal
): Promise<AiGatewayResult> {
  const promptSha256 = crypto.createHash('sha256').update(payload.prompt, 'utf8').digest('hex');

  // 1. Idempotency Check & Lock
  const existingRequest = await db.aiGenerationRequest.findUnique({
    where: {
      organizationId_caseId_userId_idempotencyKey: {
        organizationId: payload.organizationId,
        caseId: payload.caseId,
        userId: payload.userId,
        idempotencyKey: payload.idempotencyKey
      }
    },
    include: { attempts: true }
  });

  if (existingRequest) {
    if (existingRequest.promptSha256 !== promptSha256) {
      throw new AiGatewayError(409, 'Idempotency key reused with a different prompt payload');
    }
    // Return existing idempotent result without duplicate charge
    return {
      requestId: existingRequest.id,
      status: existingRequest.status as 'COMPLETED' | 'FAILED' | 'CANCELED',
      reservedCostMicros: existingRequest.reservedCostMicros,
      actualCostMicros: existingRequest.actualCostMicros,
      totalTokens: existingRequest.totalTokens,
      resultText: existingRequest.responseMetadataJson ? JSON.parse(existingRequest.responseMetadataJson).resultText : undefined,
      redactedErrorMessage: existingRequest.redactedErrorMessage ?? undefined,
      attemptsCount: existingRequest.attempts.length
    };
  }

  // 2. Validate Case Security Policy (externalAiAllowed)
  const casePolicy = await db.aiCasePolicy.findUnique({
    where: { caseId: payload.caseId }
  });

  if (casePolicy && !casePolicy.externalAiAllowed) {
    throw new AiGatewayError(403, 'External AI transmission is forbidden for this case security policy');
  }

  // 3. Validate Provider Config & SSRF
  const providerConfig = await db.aiProviderConfig.findUnique({
    where: { id: payload.providerConfigId }
  });

  if (!providerConfig || providerConfig.organizationId !== payload.organizationId) {
    throw new AiGatewayError(404, 'AI provider configuration not found for this organization');
  }

  if (providerConfig.status !== 'ACTIVE') {
    throw new AiGatewayError(400, 'AI provider configuration is disabled');
  }

  const isLocalFake = providerConfig.providerKind === 'LOCAL_FAKE';
  assertSafeBaseUrl(providerConfig.baseUrl, isLocalFake);

  const allowedModels: string[] = JSON.parse(providerConfig.allowedModelsJson || '[]');
  if (allowedModels.length > 0 && !allowedModels.includes(payload.modelCode)) {
    throw new AiGatewayError(400, `Model '${payload.modelCode}' is not allowed for this provider`);
  }

  // 4. Calculate Max Expected Reserved Cost
  const requestedMaxTokens = payload.maxTokens ?? casePolicy?.maxTokensPerRequest ?? 4096;
  if (casePolicy && requestedMaxTokens > casePolicy.maxTokensPerRequest) {
    throw new AiGatewayError(400, `Requested tokens (${requestedMaxTokens}) exceeds case policy limit (${casePolicy.maxTokensPerRequest})`);
  }

  // Standard estimated pricing reservation: 10 micros per token
  const estimatedCostMicros = requestedMaxTokens * 10;
  if (casePolicy && estimatedCostMicros > casePolicy.maxCostMicrosPerRequest) {
    throw new AiGatewayError(400, `Estimated cost (${estimatedCostMicros} micros) exceeds case request budget limit (${casePolicy.maxCostMicrosPerRequest} micros)`);
  }

  // Check Daily Organization Budget
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const todayLedgers = await db.aiUsageLedger.aggregate({
    where: {
      organizationId: payload.organizationId,
      createdAt: { gte: todayStart }
    },
    _sum: { costMicros: true }
  });

  const currentDailyUsage = todayLedgers._sum.costMicros ?? 0;
  if (currentDailyUsage + estimatedCostMicros > providerConfig.dailyBudgetMicros) {
    throw new AiGatewayError(400, `Daily budget limit exceeded for organization. Used: ${currentDailyUsage} micros, Daily Limit: ${providerConfig.dailyBudgetMicros} micros`);
  }

  // 5. Create Request and Reserve Budget Atomically in Transaction
  const requestId = `AI-REQ-${crypto.randomUUID()}`;
  const secretKey = resolveSecretReference(providerConfig.secretRef);

  await db.$transaction(async (tx) => {
    await tx.aiGenerationRequest.create({
      data: {
        id: requestId,
        organizationId: payload.organizationId,
        caseId: payload.caseId,
        userId: payload.userId,
        providerConfigId: providerConfig.id,
        modelCode: payload.modelCode,
        status: 'PROCESSING',
        promptSha256,
        idempotencyKey: payload.idempotencyKey,
        reservedCostMicros: estimatedCostMicros,
        actualCostMicros: 0,
        totalTokens: 0
      }
    });

    await tx.aiUsageLedger.create({
      data: {
        id: `LDG-${crypto.randomUUID()}`,
        organizationId: payload.organizationId,
        caseId: payload.caseId,
        userId: payload.userId,
        providerConfigId: providerConfig.id,
        modelCode: payload.modelCode,
        requestId,
        transactionType: 'RESERVATION',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: estimatedCostMicros
      }
    });
  });

  // 6. Execute Bounded Retry Invocations
  let attemptNumber = 0;
  const maxRetries = Math.min(providerConfig.maxRetries, 3); // Upper bound cap: 3 retries max
  let finalAdapterResponse: FakeAdapterResponse | null = null;

  while (attemptNumber <= maxRetries) {
    attemptNumber++;
    const startTime = Date.now();

    if (abortSignal?.aborted) {
      finalAdapterResponse = {
        status: 'USER_CANCEL',
        statusCode: 499,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0,
        errorMessage: 'User canceled execution'
      };
      break;
    }

    let adapterResult: FakeAdapterResponse;
    if (isLocalFake) {
      adapterResult = await executeFakeAdapterCall(secretKey, {
        modelCode: payload.modelCode,
        prompt: payload.prompt,
        maxTokens: requestedMaxTokens,
        abortSignal
      });
    } else {
      // Future real provider adapter fallback wrapper
      adapterResult = {
        status: 'SERVER_ERROR',
        statusCode: 501,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costMicros: 0,
        errorMessage: 'Real provider network calls require explicit live credential authorization'
      };
    }

    const durationMs = Date.now() - startTime;

    // Log attempt record in DB (Append-only)
    await db.aiGenerationAttempt.create({
      data: {
        id: `ATT-${crypto.randomUUID()}`,
        requestId,
        attemptNumber,
        status: adapterResult.status,
        statusCode: adapterResult.statusCode,
        redactedErrorMessage: adapterResult.errorMessage ? redactSecretText(adapterResult.errorMessage) : null,
        durationMs
      }
    });

    finalAdapterResponse = adapterResult;

    // Non-retryable statuses (401 Bad Key, Cancel, Malformed Schema, Success)
    if (['SUCCESS', 'BAD_KEY', 'USER_CANCEL', 'MALFORMED_SCHEMA'].includes(adapterResult.status)) {
      break;
    }

    // Bounded Retry delay for Rate Limit (429) or Server Error (500/504)
    if (attemptNumber <= maxRetries) {
      const backoffMs = (adapterResult.retryAfterSeconds ?? Math.pow(2, attemptNumber - 1)) * 50;
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }

  const response = finalAdapterResponse || {
    status: 'SERVER_ERROR',
    statusCode: 500,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costMicros: 0,
    errorMessage: 'Unknown gateway execution failure'
  };

  // 7. Reconcile Actual Cost and Terminal State Transition
  const isSuccess = response.status === 'SUCCESS';
  const isCanceled = response.status === 'USER_CANCEL';
  const finalStatus = isSuccess ? 'COMPLETED' : isCanceled ? 'CANCELED' : 'FAILED';

  const actualCost = isSuccess ? response.costMicros : 0;
  const actualTokens = isSuccess ? response.totalTokens : 0;
  const redactedError = response.errorMessage ? redactSecretText(response.errorMessage) : null;

  await db.$transaction(async (tx) => {
    // Compare-and-Set Terminal State Guard
    const req = await tx.aiGenerationRequest.findUnique({ where: { id: requestId } });
    if (!req || ['COMPLETED', 'FAILED', 'CANCELED'].includes(req.status)) {
      // Request already in terminal state; prevent late responses from modifying ledger
      return;
    }

    await tx.aiGenerationRequest.update({
      where: { id: requestId },
      data: {
        status: finalStatus,
        actualCostMicros: actualCost,
        totalTokens: actualTokens,
        responseMetadataJson: isSuccess ? JSON.stringify({ resultText: response.resultText }) : '{}',
        redactedErrorMessage: redactedError
      }
    });

    await tx.aiUsageLedger.create({
      data: {
        id: `LDG-${crypto.randomUUID()}`,
        organizationId: payload.organizationId,
        caseId: payload.caseId,
        userId: payload.userId,
        providerConfigId: providerConfig.id,
        modelCode: payload.modelCode,
        requestId,
        transactionType: 'RECONCILIATION',
        promptTokens: response.promptTokens,
        completionTokens: response.completionTokens,
        totalTokens: actualTokens,
        costMicros: actualCost - estimatedCostMicros // Adjustment delta
      }
    });
  });

  return {
    requestId,
    status: finalStatus,
    reservedCostMicros: estimatedCostMicros,
    actualCostMicros: actualCost,
    totalTokens: actualTokens,
    resultText: response.resultText,
    redactedErrorMessage: redactedError ?? undefined,
    attemptsCount: attemptNumber
  };
}
