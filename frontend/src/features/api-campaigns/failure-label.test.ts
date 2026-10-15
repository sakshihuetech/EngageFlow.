import { describe, expect, it } from 'vitest';
import { executionFailureLabel } from './failure-label';
import type { ApiExecution } from './types';

const failed = { status: 'FAILED' } as ApiExecution;

describe('execution failure label', () => {
  it('prefers the provider title, then message, then code', () => {
    expect(executionFailureLabel({ ...failed, failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment needed', failureCode: '131042' })).toBe('Business eligibility payment issue');
    expect(executionFailureLabel({ ...failed, failureMessage: 'Payment needed', failureCode: '131042' })).toBe('Payment needed');
    expect(executionFailureLabel({ ...failed, failureCode: '131042' })).toBe('131042');
  });

  it('gives legacy failures a safe reason rather than an empty dash', () => {
    expect(executionFailureLabel(failed)).toBe('Execution failed; no reason was recorded.');
  });

  it('shows a stored Meta code instead of stale generic worker placeholders', () => {
    expect(executionFailureLabel({ ...failed, failureCode: '131037', failureTitle: 'API Campaign execution failed', failureMessage: 'The execution could not be completed.' })).toBe('Meta error 131037');
    expect(executionFailureLabel({ ...failed, failureCode: '131037', failureTitle: 'API Campaign execution failed', failureMessage: 'Display name approval is required.' })).toBe('Display name approval is required.');
  });
});
