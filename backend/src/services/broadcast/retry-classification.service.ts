import { MetaGraphError } from '../whatsapp/meta-graph.service.js';
import { ProviderSendError } from '../whatsapp/transport.js';
import { AppError } from '../../utils/app-error.js';
import { safeFailureText } from './safety.js';

export const MAX_BROADCAST_ATTEMPTS = 5;

export type RetrySafety = 'SAFE' | 'PERMANENT' | 'UNCERTAIN';
export type FailureSource = 'META_API' | 'META_WEBHOOK' | 'VALIDATION' | 'WORKER' | 'QUEUE';

export function classifyBroadcastError(error: unknown, submissionStarted: boolean, attempt: number) {
  const graph = error instanceof MetaGraphError ? error : undefined;
  const transport = error instanceof ProviderSendError ? error : undefined;
  const shaped = error as { code?: unknown; status?: unknown; statusCode?: unknown; message?: unknown; userTitle?: unknown; userMessage?: unknown };
  const code = String(graph?.details.code ?? shaped.code ?? 'SEND_FAILED');
  const failureCode = /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'SEND_FAILED';
  const failureSubcode = graph?.details.errorSubcode;
  const failureTitle = safeFailureText(graph?.details.userTitle ?? shaped.userTitle ?? '', 300);
  const failureMessage = safeFailureText(graph?.details.userMessage ?? shaped.userMessage ?? shaped.message ?? 'Campaign message failed.', 1_000);
  const failureSource: FailureSource = graph ? 'META_API' : submissionStarted && !transport ? 'WORKER' : 'VALIDATION';
  const definitiveThrottle = Boolean(graph && graph.status === 429 && typeof graph.details.code === 'number');
  const definitiveProviderRejection = Boolean(graph && graph.status >= 400 && graph.status < 500 && graph.status !== 429 && typeof graph.details.code === 'number');
  const ambiguous = submissionStarted && !definitiveThrottle && !definitiveProviderRejection && !transport;
  const recoverablePreflight = !submissionStarted && error instanceof AppError && ['META_CREDENTIAL_UNAVAILABLE', 'WHATSAPP_NOT_CONNECTED', 'WHATSAPP_ACCOUNT_UNAVAILABLE', 'PHONE_UNAVAILABLE', 'TEMPLATE_UNAVAILABLE'].includes(error.code);
  const retrySafety: RetrySafety = ambiguous ? 'UNCERTAIN' : definitiveThrottle || transport?.safeToRetry || recoverablePreflight ? 'SAFE' : 'PERMANENT';
  const retryAfterMs = definitiveThrottle ? graph?.details.retryAfterMs : undefined;
  const nextEligibleRetryAt = retryAfterMs ? new Date(Date.now() + retryAfterMs) : undefined;
  // No generic time is invented for a provider restriction. A provider's
  // explicit Retry-After is required before this attempt can be retried.
  const autoRetry = retrySafety === 'SAFE' && Boolean(nextEligibleRetryAt) && attempt < 3;
  return { failureCode, failureSubcode, failureTitle, failureMessage, failureSource, retrySafety, nextEligibleRetryAt, autoRetry };
}

export function classifyWebhookFailure(input: { failureCode?: unknown; failureSubcode?: unknown; failureTitle?: unknown; failureMessage?: unknown }) {
  const code = safeFailureText(String(input.failureCode ?? ''), 64);
  const failureCode = /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'META_WEBHOOK_FAILED';
  const failureSubcode = typeof input.failureSubcode === 'number' ? input.failureSubcode : undefined;
  const failureTitle = safeFailureText(input.failureTitle, 300);
  const failureMessage = safeFailureText(input.failureMessage, 1_000);
  // A signed provider FAILED event is definitive, but unknown provider codes
  // are not assumed transient. 429 is kept visible as a temporary restriction
  // without inventing a retry time.
  const retrySafety: RetrySafety = failureCode === '429' ? 'SAFE' : 'PERMANENT';
  return { failureCode, failureSubcode, failureTitle, failureMessage, failureSource: 'META_WEBHOOK' as const, retrySafety };
}

export function retryExclusion(row: { status?: string; retrySafety?: string | null; submissionState?: string | null; attemptCount?: number; nextEligibleRetryAt?: Date | null; metaMessageId?: string | null; failureSource?: string | null; failureCode?: string | null }, now = new Date()) {
  if (row.status !== 'FAILED') return 'NOT_FAILED';
  if (row.retrySafety === 'UNCERTAIN' || row.submissionState === 'UNCERTAIN') return 'UNCERTAIN_OUTCOME';
  if (row.retrySafety !== 'SAFE') return 'PERMANENT_OR_UNCLASSIFIED';
  if ((row.attemptCount ?? 0) >= MAX_BROADCAST_ATTEMPTS) return 'ATTEMPT_LIMIT';
  if (!row.nextEligibleRetryAt && row.failureCode === '429') return 'PROVIDER_RESTRICTION';
  if (row.nextEligibleRetryAt && new Date(row.nextEligibleRetryAt).getTime() > now.getTime()) return 'RETRY_AFTER';
  if (row.metaMessageId && row.failureSource !== 'META_WEBHOOK') return 'PROVIDER_OUTCOME_UNCERTAIN';
  return null;
}
