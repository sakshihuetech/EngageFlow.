import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as queue from '../src/config/api-campaign-queue.js';
import { env } from '../src/config/env.js';
import { apiCampaignRateLimit } from '../src/middleware/api-campaign-rate-limit.js';

afterEach(() => vi.restoreAllMocks());

function request() {
  return {
    baseUrl: '/api/v1/whatsapp/api-campaigns',
    workspaceContext: { workspaceId: 'test-workspace' },
    apiCredentialId: 'test-credential',
  } as Request;
}

function response() {
  const headers: Record<string, string> = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    set: vi.fn((name: string, value: string) => { headers[name] = value; return res; }),
  };
  return { res: res as unknown as Response, status: res.status, json: res.json, headers };
}

describe('API Campaign Redis rate limit', () => {
  it('awaits the shared Redis client and passes an allowed request', async () => {
    const evalMock = vi.fn().mockResolvedValue([1, 59000]);
    vi.spyOn(queue, 'apiCampaignRedis').mockResolvedValue({ eval: evalMock } as never);
    const { res, status, headers } = response();
    const next = vi.fn();

    await apiCampaignRateLimit(request(), res, next as NextFunction);

    expect(queue.apiCampaignRedis).toHaveBeenCalledOnce();
    expect(evalMock).toHaveBeenCalledWith(expect.stringContaining("redis.call('INCR'"), 1,
      expect.stringMatching(/^api-campaign:rate:test-workspace:\d+$/),
      String(env.API_CAMPAIGN_RATE_LIMIT_WINDOW_MS));
    expect(headers['X-RateLimit-Remaining']).toBe(String(env.API_CAMPAIGN_RATE_LIMIT_MAX - 1));
    expect(status).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns a bounded 429 response when the limit is exceeded', async () => {
    vi.spyOn(queue, 'apiCampaignRedis').mockResolvedValue({
      eval: vi.fn().mockResolvedValue([env.API_CAMPAIGN_RATE_LIMIT_MAX + 1, 4500]),
    } as never);
    const { res, status, json, headers } = response();
    const next = vi.fn();

    await apiCampaignRateLimit(request(), res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({ code: 'RATE_LIMITED', message: 'API Campaign request limit exceeded.' });
    expect(headers['Retry-After']).toBe('5');
    expect(next).not.toHaveBeenCalled();
  });

  it('fails closed when shared Redis cannot connect', async () => {
    vi.spyOn(queue, 'apiCampaignRedis').mockRejectedValue(new Error('connection failed'));
    const { res, status, json } = response();
    const next = vi.fn();

    await apiCampaignRateLimit(request(), res, next as NextFunction);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({ code: 'RATE_LIMIT_UNAVAILABLE', message: 'API request protection is unavailable.' });
    expect(next).not.toHaveBeenCalled();
  });
});
