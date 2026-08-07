import * as crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@claim-studio/database';
import { assertSafeResolvedBaseUrl, type AiProviderKind } from './ssrf-guard';
import { assertSecretReference, resolveSecretReference, redactSecretText } from './secret-resolver';
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
  auditLogFactory?: (event: AiAuditEvent, targetId: string, metadata: Record<string, unknown>) => Prisma.AuditLogCreateInput;
}

export type AiAuditEvent = 'STARTED' | 'COMPLETED' | 'FAILED' | 'CANCELED' | 'POLICY_BLOCKED' | 'BUDGET_BLOCKED';

export interface AiGatewayExecutionOptions {
  abortSignal?: AbortSignal;
  onRequestKnown?: (requestId: string, status: string) => void;
}

export interface AiGatewayResult {
  requestId: string;
  status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELED';
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

type StoredRequest = {
  id: string;
  status: string;
  reservedCostMicros: number;
  actualCostMicros: number;
  totalTokens: number;
  responseMetadataJson: string;
  redactedErrorMessage: string | null;
  requestFingerprintSha256: string;
  attempts: readonly unknown[];
};

function resultTextFromMetadata(metadataJson: string): string | undefined {
  try {
    const parsed = JSON.parse(metadataJson) as { resultText?: unknown };
    return typeof parsed.resultText === 'string' ? parsed.resultText : undefined;
  } catch {
    return undefined;
  }
}

function resultFromStored(request: StoredRequest): AiGatewayResult {
  return {
    requestId: request.id,
    status: request.status as AiGatewayResult['status'],
    reservedCostMicros: request.reservedCostMicros,
    actualCostMicros: request.actualCostMicros,
    totalTokens: request.totalTokens,
    resultText: resultTextFromMetadata(request.responseMetadataJson),
    redactedErrorMessage: request.redactedErrorMessage ?? undefined,
    attemptsCount: request.attempts.length
  };
}

function requestFingerprint(payload: AiRequestPayload): string {
  const canonicalPayload = JSON.stringify({
    providerConfigId: payload.providerConfigId,
    modelCode: payload.modelCode,
    prompt: payload.prompt,
    maxTokens: payload.maxTokens ?? null
  });
  return crypto.createHash('sha256').update(canonicalPayload, 'utf8').digest('hex');
}

function parseStringArray(json: string, fieldName: string): string[] {
  try {
    const value = JSON.parse(json) as unknown;
    if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error();
    return value;
  } catch {
    throw new AiGatewayError(500, `Invalid ${fieldName} configuration`);
  }
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

async function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<boolean> {
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

export async function processAiGenerationRequest(
  db: PrismaClient,
  payload: AiRequestPayload,
  options: AiGatewayExecutionOptions = {}
): Promise<AiGatewayResult> {
  const auditRejection = async (event: Extract<AiAuditEvent, 'POLICY_BLOCKED' | 'BUDGET_BLOCKED'>, reason: string): Promise<void> => {
    if (!payload.auditLogFactory) return;
    await db.auditLog.create({ data: payload.auditLogFactory(event, payload.caseId, { reason, providerConfigId: payload.providerConfigId, modelCode: payload.modelCode }) });
  };
  const promptSha256 = crypto.createHash('sha256').update(payload.prompt, 'utf8').digest('hex');
  const fingerprintSha256 = requestFingerprint(payload);
  const idempotencyWhere = {
    organizationId_caseId_userId_idempotencyKey: {
      organizationId: payload.organizationId,
      caseId: payload.caseId,
      userId: payload.userId,
      idempotencyKey: payload.idempotencyKey
    }
  } as const;

  const existingRequest = await db.aiGenerationRequest.findUnique({ where: idempotencyWhere, include: { attempts: true } });
  if (existingRequest) {
    if (existingRequest.requestFingerprintSha256 !== fingerprintSha256) {
      throw new AiGatewayError(409, 'Idempotency key reused with a different request payload');
    }
    options.onRequestKnown?.(existingRequest.id, existingRequest.status);
    return resultFromStored(existingRequest);
  }

  const casePolicy = await db.aiCasePolicy.findUnique({ where: { caseId: payload.caseId } });
  if (!casePolicy || !casePolicy.externalAiAllowed) {
    await auditRejection('POLICY_BLOCKED', 'EXTERNAL_AI_NOT_ALLOWED');
    throw new AiGatewayError(403, 'External AI transmission is not explicitly allowed for this case');
  }

  const providerConfig = await db.aiProviderConfig.findUnique({ where: { id: payload.providerConfigId } });
  if (!providerConfig || providerConfig.organizationId !== payload.organizationId) {
    throw new AiGatewayError(404, 'AI provider configuration not found for this organization');
  }
  if (providerConfig.status !== 'ACTIVE') throw new AiGatewayError(400, 'AI provider configuration is disabled');

  const allowedProviderIds = parseStringArray(casePolicy.allowedProviderIdsJson, 'case provider allowlist');
  if (!allowedProviderIds.includes(providerConfig.id)) {
    await auditRejection('POLICY_BLOCKED', 'PROVIDER_NOT_ALLOWLISTED');
    throw new AiGatewayError(403, 'Provider is not allowlisted by the case AI policy');
  }

  const providerKind = providerConfig.providerKind as AiProviderKind;
  const isLocalFake = providerKind === 'LOCAL_FAKE';
  if (!['LOCAL_FAKE', 'OPENAI', 'ANTHROPIC', 'GEMINI'].includes(providerKind)) throw new AiGatewayError(400, 'Unsupported AI provider kind');
  await assertSafeResolvedBaseUrl(providerConfig.baseUrl, providerKind);

  const allowedModels = parseStringArray(providerConfig.allowedModelsJson, 'provider model allowlist');
  if (!allowedModels.includes(payload.modelCode)) {
    await auditRejection('POLICY_BLOCKED', 'MODEL_NOT_ALLOWLISTED');
    throw new AiGatewayError(400, `Model '${payload.modelCode}' is not allowed for this provider`);
  }

  const requestedMaxTokens = payload.maxTokens ?? casePolicy.maxTokensPerRequest;
  if (!Number.isSafeInteger(requestedMaxTokens) || requestedMaxTokens < 1 || requestedMaxTokens > casePolicy.maxTokensPerRequest) {
    throw new AiGatewayError(400, 'Requested maxTokens is outside the case policy limit');
  }
  const estimatedCostMicros = requestedMaxTokens * 10;
  if (!Number.isSafeInteger(estimatedCostMicros) || estimatedCostMicros > casePolicy.maxCostMicrosPerRequest) {
    await auditRejection('BUDGET_BLOCKED', 'CASE_REQUEST_COST_LIMIT');
    throw new AiGatewayError(400, 'Estimated request cost exceeds the case policy limit');
  }

  let secretKey: string | null = 'LOCAL_FAKE';
  if (!isLocalFake) {
    try { assertSecretReference(providerConfig.secretRef); } catch (error) {
      throw new AiGatewayError(400, error instanceof Error ? error.message : 'Invalid secret reference');
    }
    secretKey = resolveSecretReference(providerConfig.secretRef);
    if (!secretKey) throw new AiGatewayError(400, 'Configured provider secret reference is unavailable');
  }

  const requestId = `AI-REQ-${crypto.randomUUID()}`;
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  let dailyBudgetBlocked = false;
  try {
    await db.$transaction(async (tx) => {
      // A no-op write obtains SQLite's write lock before the aggregate, serializing budget reservations.
      await tx.$executeRaw`UPDATE "AiProviderConfig" SET "updatedAt" = "updatedAt" WHERE "id" = ${providerConfig.id}`;
      const usage = await tx.aiUsageLedger.aggregate({
        where: { organizationId: payload.organizationId, providerConfigId: providerConfig.id, createdAt: { gte: todayStart } },
        _sum: { costMicros: true }
      });
      const committedAndReserved = usage._sum.costMicros ?? 0;
      if (committedAndReserved + estimatedCostMicros > providerConfig.dailyBudgetMicros) {
        dailyBudgetBlocked = true;
        if (payload.auditLogFactory) {
          await tx.auditLog.create({ data: payload.auditLogFactory('BUDGET_BLOCKED', payload.caseId, {
            reason: 'DAILY_PROVIDER_BUDGET', providerConfigId: providerConfig.id, modelCode: payload.modelCode,
            committedAndReserved, estimatedCostMicros, dailyBudgetMicros: providerConfig.dailyBudgetMicros
          }) });
        }
        return;
      }

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
          requestFingerprintSha256: fingerprintSha256,
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
          costMicros: estimatedCostMicros
        }
      });
      if (payload.auditLogFactory) await tx.auditLog.create({ data: payload.auditLogFactory('STARTED', requestId, { estimatedCostMicros }) });
    });
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const racedRequest = await db.aiGenerationRequest.findUnique({ where: idempotencyWhere, include: { attempts: true } });
    if (!racedRequest || racedRequest.requestFingerprintSha256 !== fingerprintSha256) {
      throw new AiGatewayError(409, 'Idempotency key was concurrently reused with a different payload');
    }
    options.onRequestKnown?.(racedRequest.id, racedRequest.status);
    return resultFromStored(racedRequest);
  }

  if (dailyBudgetBlocked) throw new AiGatewayError(429, 'Daily AI provider budget would be exceeded');

  options.onRequestKnown?.(requestId, 'PROCESSING');

  let attemptNumber = 0;
  const maxRetries = Math.min(Math.max(providerConfig.maxRetries, 0), 3);
  let finalResponse: FakeAdapterResponse | null = null;
  let accumulatedPromptTokens = 0;
  let accumulatedCompletionTokens = 0;
  let accumulatedCostMicros = 0;

  while (attemptNumber <= maxRetries) {
    if (options.abortSignal?.aborted) {
      finalResponse = {
        status: 'USER_CANCEL', statusCode: 499, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
        errorMessage: 'User canceled execution'
      };
      break;
    }

    attemptNumber += 1;
    const startedAt = Date.now();
    const response = isLocalFake
      ? await executeFakeAdapterCall(secretKey, { modelCode: payload.modelCode, prompt: payload.prompt, maxTokens: requestedMaxTokens, abortSignal: options.abortSignal })
      : {
        status: 'SERVER_ERROR' as const, statusCode: 501, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
        errorMessage: 'Live provider calls require a separately authorized adapter deployment'
      };

    await db.aiGenerationAttempt.create({
      data: {
        id: `ATT-${crypto.randomUUID()}`,
        requestId,
        attemptNumber,
        status: response.status,
        statusCode: response.statusCode,
        redactedErrorMessage: response.errorMessage ? redactSecretText(response.errorMessage) : null,
        durationMs: Date.now() - startedAt
      }
    });
    accumulatedPromptTokens += Math.max(0, response.promptTokens);
    accumulatedCompletionTokens += Math.max(0, response.completionTokens);
    accumulatedCostMicros += Math.max(0, response.costMicros);
    finalResponse = response;

    const retryable = response.status === 'RATE_LIMIT' || response.status === 'TIMEOUT' || response.status === 'SERVER_ERROR' || response.status === 'STREAM_ABORT';
    if (!retryable || attemptNumber > maxRetries) break;
    const retryAfterMs = Math.min(2_000, (response.retryAfterSeconds ?? 2 ** (attemptNumber - 1)) * 50);
    if (!(await abortableDelay(retryAfterMs, options.abortSignal))) {
      finalResponse = {
        status: 'USER_CANCEL', statusCode: 499, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
        errorMessage: 'User canceled execution during retry backoff'
      };
      break;
    }
  }

  const response = finalResponse ?? {
    status: 'SERVER_ERROR' as const, statusCode: 500, promptTokens: 0, completionTokens: 0, totalTokens: 0, costMicros: 0,
    errorMessage: 'AI gateway produced no provider result'
  };
  const finalStatus: AiGatewayResult['status'] = response.status === 'SUCCESS' ? 'COMPLETED' : response.status === 'USER_CANCEL' ? 'CANCELED' : 'FAILED';
  const actualCostMicros = accumulatedCostMicros;
  const actualTokens = accumulatedPromptTokens + accumulatedCompletionTokens;
  const redactedErrorMessage = response.errorMessage ? redactSecretText(response.errorMessage) : null;

  await db.$transaction(async (tx) => {
    const transitioned = await tx.aiGenerationRequest.updateMany({
      where: { id: requestId, status: 'PROCESSING' },
      data: {
        status: finalStatus,
        actualCostMicros,
        totalTokens: actualTokens,
        responseMetadataJson: response.status === 'SUCCESS' ? JSON.stringify({ resultText: response.resultText }) : '{}',
        redactedErrorMessage
      }
    });
    if (transitioned.count === 0) return;
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
        promptTokens: accumulatedPromptTokens,
        completionTokens: accumulatedCompletionTokens,
        totalTokens: actualTokens,
        costMicros: actualCostMicros - estimatedCostMicros
      }
    });
    if (payload.auditLogFactory) {
      await tx.auditLog.create({ data: payload.auditLogFactory(finalStatus === 'COMPLETED' ? 'COMPLETED' : finalStatus === 'CANCELED' ? 'CANCELED' : 'FAILED', requestId, {
        providerConfigId: providerConfig.id, modelCode: payload.modelCode, attemptsCount: attemptNumber,
        totalTokens: actualTokens, actualCostMicros, errorCode: response.status
      }) });
    }
  });

  const stored = await db.aiGenerationRequest.findUnique({ where: { id: requestId }, include: { attempts: true } });
  if (!stored) throw new AiGatewayError(500, 'Generation request disappeared during reconciliation');
  return resultFromStored(stored);
}
