import { afterEach, describe, expect, it, vi } from 'vitest';
import { templateLibraryProviderError } from '../src/controllers/whatsapp.controller.js';
import { graphRequest, MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { errorResponse } from '../src/utils/api-response.js';

afterEach(() => vi.unstubAllGlobals());

describe('Meta Template Library diagnostics', () => {
  it('parses a mocked Meta 4xx into allowlisted, redacted response fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({
      error: {
        code: 100, error_subcode: 2388026, error_user_title: 'Invalid template',
        error_user_msg: 'Bearer private-token contact +15551234567 at https://example.com/customer',
        message: 'Authorization: private-token', fbtrace_id: 'TRACE123',
        error_data: { details: 'raw private customer payload' },
      },
    }) }));
    let caught: unknown;
    try { await graphRequest('safe-test-path', { method: 'POST', accessToken: 'private-token', body: { name: 'mock-only' } }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(MetaGraphError);
    const mapped = templateLibraryProviderError(caught as MetaGraphError);
    const response = errorResponse({ requestId: 'request-1' } as never, mapped.code, mapped.message, mapped.provider);
    expect(response.error.provider).toMatchObject({ httpStatus: 400, metaCode: 100, metaSubcode: 2388026, title: 'Invalid template', traceId: 'TRACE123' });
    expect(JSON.stringify(response)).not.toMatch(/private-token|15551234567|example\.com|raw private customer payload|Authorization/);
  });
  it('returns a safe fallback when Meta omits all error fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }));
    let caught: unknown;
    try { await graphRequest('safe-test-path', { accessToken: 'private-token' }); } catch (error) { caught = error; }
    const mapped = templateLibraryProviderError(caught as MetaGraphError);
    expect(mapped.provider).toEqual({ httpStatus: 400, message: expect.stringContaining('Meta could not complete') });
  });
});
