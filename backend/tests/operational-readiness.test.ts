import { afterEach, describe, expect, it, vi } from 'vitest';
import * as broadcast from '../src/config/campaign-queue.js';
import * as apiCampaign from '../src/config/api-campaign-queue.js';
import * as database from '../src/config/database.js';
import { getReadiness } from '../src/services/health.service.js';

afterEach(() => vi.restoreAllMocks());
describe('both queues and workers in readiness', () => {
  function mocks(broadcastTimestamp: string | null, apiTimestamp: string | null) {
    vi.spyOn(database, 'databaseStatus').mockReturnValue('HEALTHY');
    vi.spyOn(broadcast, 'campaignQueueHealth').mockResolvedValue({ ready: true });
    vi.spyOn(broadcast, 'campaignQueueCounts').mockResolvedValue({ waiting: 2, active: 1, delayed: 3, failed: 4 });
    vi.spyOn(apiCampaign, 'apiCampaignQueueCounts').mockResolvedValue({ waiting: 5, active: 2, delayed: 0, failed: 1 });
    vi.spyOn(broadcast, 'campaignRedis').mockResolvedValue({ get: vi.fn().mockResolvedValue(broadcastTimestamp) } as never);
    vi.spyOn(apiCampaign, 'apiCampaignRedis').mockResolvedValue({ get: vi.fn().mockResolvedValue(apiTimestamp) } as never);
  }
  it('reports both live workers and bounded queue counts independently', async () => {
    mocks(`broadcast|${Date.now()}`, `api|${Date.now()}`);
    expect(await getReadiness()).toMatchObject({ status: 'HEALTHY', dependencies: { broadcastWorker: { status: 'HEALTHY' }, apiCampaignWorker: { status: 'HEALTHY' }, broadcastQueue: { counts: { waiting: 2, active: 1, delayed: 3, failed: 4 } }, apiCampaignQueue: { counts: { waiting: 5, active: 2, delayed: 0, failed: 1 } } } });
  });
  it('does not infer worker health from queue connectivity', async () => {
    mocks(`broadcast|${Date.now() - 60000}`, null);
    expect(await getReadiness()).toMatchObject({ status: 'DEGRADED', dependencies: { broadcastQueue: { status: 'HEALTHY' }, apiCampaignQueue: { status: 'HEALTHY' }, broadcastWorker: { status: 'STALE' }, apiCampaignWorker: { status: 'NOT_VERIFIED' } } });
  });
  it('reports API queue failure without making Broadcast unavailable', async () => {
    mocks(`broadcast|${Date.now()}`, `api|${Date.now()}`);
    vi.mocked(apiCampaign.apiCampaignQueueCounts).mockRejectedValue(new Error('unavailable'));
    expect(await getReadiness()).toMatchObject({ status: 'DEGRADED', dependencies: { broadcastQueue: { status: 'HEALTHY' }, apiCampaignQueue: { status: 'UNAVAILABLE' }, apiCampaignWorker: { status: 'NOT_VERIFIED' } } });
  });
});
