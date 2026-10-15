import { afterEach, describe, expect, it, vi } from 'vitest';
import { retargetingApi } from './retargeting-api';

afterEach(() => vi.unstubAllGlobals());

describe('retargeting API client', () => {
  it('uses the separate bounded preview GET route and never submits a draft', async () => {
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, _options?: RequestInit) => {
      void _url; void _options;
      return new Response(JSON.stringify({ success: true, data: { source: { id: 'source', name: 'Test', status: 'COMPLETED', whatsappAccountId: 'account' }, filter: 'READ', total: 0, eligible: 0, exclusions: {}, items: [], nextCursor: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await retargetingApi.preview('campaign/unsafe', 'READ');
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(String(url)).toMatch(/\/api\/campaigns\/campaign%2Funsafe\/retargeting\/preview\?filter=READ&limit=25$/);
    expect(options?.method).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
