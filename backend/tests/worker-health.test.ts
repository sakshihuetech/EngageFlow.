import { afterEach, describe, expect, it, vi } from 'vitest';
import { boundedQueueCounts, heartbeatStatus, readWorkerHealth, startWorkerHeartbeat } from '../src/services/worker-health.service.js';

afterEach(() => vi.useRealTimers());
describe('worker operational health', () => {
  it('distinguishes fresh, stale, expired/missing and invalid heartbeats', () => {
    expect(heartbeatStatus('instance|100000', 120000).status).toBe('HEALTHY');
    expect(heartbeatStatus('instance|100000', 150000).status).toBe('STALE');
    expect(heartbeatStatus(null).status).toBe('NOT_VERIFIED');
    expect(heartbeatStatus('invalid').status).toBe('NOT_VERIFIED');
    expect(heartbeatStatus('instance|').status).toBe('NOT_VERIFIED');
    expect(heartbeatStatus('instance|200000', 100000).status).toBe('NOT_VERIFIED');
  });
  it.each(['broadcast', 'api-campaign'] as const)('writes periodic TTL leases and removes only its own lease for %s', async kind => {
    vi.useFakeTimers();
    const redis = { set: vi.fn().mockResolvedValue('OK'), get: vi.fn().mockResolvedValue(null), eval: vi.fn().mockResolvedValue(1) };
    const stop = await startWorkerHeartbeat(redis as never, kind);
    expect(redis.set).toHaveBeenCalledWith(`engageflow:worker:${kind}:heartbeat`, expect.stringMatching(/\|\d+$/), 'EX', 120);
    await vi.advanceTimersByTimeAsync(15000);
    expect(redis.set).toHaveBeenCalledTimes(2);
    await stop();
    await vi.advanceTimersByTimeAsync(30000);
    expect(redis.set).toHaveBeenCalledTimes(2);
    expect(redis.eval).toHaveBeenCalledWith(expect.stringContaining('ARGV[1]'), 1, `engageflow:worker:${kind}:heartbeat`, expect.stringMatching(/\|$/));
    expect(await readWorkerHealth(redis as never, kind)).toEqual({ status: 'NOT_VERIFIED' });
    redis.get.mockRejectedValue(new Error('Redis unavailable'));
    expect(await readWorkerHealth(redis as never, kind)).toEqual({ status: 'NOT_VERIFIED' });
  });
  it('exposes only bounded aggregate queue counts', () => {
    expect(boundedQueueCounts({ waiting: 10, active: -1, delayed: NaN, failed: Infinity, completed: 99 })).toEqual({ waiting: 10, active: 0, delayed: 0, failed: 0 });
  });
});
