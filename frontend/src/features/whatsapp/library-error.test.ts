import { describe, expect, it } from 'vitest';
import { ApiClientError } from '../../services/api/client';
import { libraryCreateErrorMessage } from './library-error';

describe('Meta library creation feedback', () => {
  it('shows the allowlisted provider code and explanation', () => {
    const error = new ApiClientError('Fallback', 400, 'META_TEMPLATE_REQUEST_FAILED', {
      httpStatus: 400, metaCode: 100, metaSubcode: 2388026, title: 'Invalid template', message: 'This template is unavailable.', traceId: 'ABC123',
    });
    expect(libraryCreateErrorMessage(error)).toBe('Meta 100/2388026: Invalid template. This template is unavailable. (Trace: ABC123)');
  });
  it('uses the safe fallback when provider fields are absent', () => {
    expect(libraryCreateErrorMessage(new ApiClientError('Meta request failed', 400))).toBe('Meta request failed');
  });
});
