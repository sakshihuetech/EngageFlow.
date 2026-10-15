import { describe, expect, it } from 'vitest';
import { MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { classifyBroadcastError, classifyWebhookFailure, retryExclusion } from '../src/services/broadcast/retry-classification.service.js';

describe('Broadcast retry send safety', () => {
  it('permits a definitive provider throttle only after the provider retry time', () => {
    const result = classifyBroadcastError(new MetaGraphError('Rate limited', 429, '4', { code: 4, retryAfterMs: 60_000 }), true, 1);
    expect(result.retrySafety).toBe('SAFE');
    expect(result.autoRetry).toBe(true);
    expect(result.nextEligibleRetryAt!.getTime()).toBeGreaterThan(Date.now());
    expect(retryExclusion({ status: 'FAILED', retrySafety: 'SAFE', attemptCount: 1, nextEligibleRetryAt: result.nextEligibleRetryAt })).toBe('RETRY_AFTER');
  });

  it('does not retry an ambiguous timeout after submission', () => {
    const result = classifyBroadcastError(new MetaGraphError('Provider request timed out', 502, 'META_TIMEOUT'), true, 1);
    expect(result.retrySafety).toBe('UNCERTAIN');
    expect(result.autoRetry).toBe(false);
    expect(retryExclusion({ status: 'FAILED', retrySafety: result.retrySafety })).toBe('UNCERTAIN_OUTCOME');
  });

  it('excludes permanent provider rejection and legacy unclassified failures', () => {
    expect(classifyBroadcastError(new MetaGraphError('Approval required', 400, '131037', { code: 131037 }), true, 1).retrySafety).toBe('PERMANENT');
    expect(classifyWebhookFailure({ failureCode: '131037', failureTitle: 'Approval required' }).retrySafety).toBe('PERMANENT');
    expect(retryExclusion({ status: 'FAILED', attemptCount: 1 })).toBe('PERMANENT_OR_UNCLASSIFIED');
  });

  it('caps attempts and blocks accepted provider IDs without a definitive failed webhook', () => {
    expect(retryExclusion({ status: 'FAILED', retrySafety: 'SAFE', attemptCount: 5 })).toBe('ATTEMPT_LIMIT');
    expect(retryExclusion({ status: 'FAILED', retrySafety: 'SAFE', attemptCount: 1, metaMessageId: 'wamid.1', failureSource: 'WORKER' })).toBe('PROVIDER_OUTCOME_UNCERTAIN');
    expect(retryExclusion({ status: 'DELIVERED', retrySafety: 'SAFE' })).toBe('NOT_FAILED');
  });
});
