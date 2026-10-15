import type { DependencyStatus } from '../types/api.js';
import { campaignQueueHealth, campaignQueueCounts, campaignRedis } from '../config/campaign-queue.js';
import { apiCampaignQueueCounts, apiCampaignRedis } from '../config/api-campaign-queue.js';
import { boundedHealthRead, boundedQueueCounts, readWorkerHealth } from './worker-health.service.js';
import { databaseStatus } from '../config/database.js';

const service = 'engageflow-api' as const;

export interface LivenessResult {
  status: 'HEALTHY';
  service: typeof service;
  timestamp: string;
}

export interface ReadinessResult {
  status: 'HEALTHY' | 'DEGRADED';
  service: typeof service;
  timestamp: string;
  dependencies: {
    mongodb: { status: DependencyStatus };
    redis: { status: DependencyStatus };
    broadcastQueue: { status: DependencyStatus; counts?: Record<string, number> };
    broadcastWorker: { status: DependencyStatus };
    apiCampaignQueue: { status: DependencyStatus; counts?: Record<string, number> };
    apiCampaignWorker: { status: DependencyStatus };
  };
}

export function getLiveness(): LivenessResult {
  return { status: 'HEALTHY', service, timestamp: new Date().toISOString() };
}

export async function getReadiness(): Promise<ReadinessResult> {
  const mongoStatus = databaseStatus();
  const queue = await campaignQueueHealth();
  const redisStatus: DependencyStatus = queue.ready ? 'HEALTHY' : queue.reason === 'REDIS_NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'UNAVAILABLE';
  const broadcastQueue: ReadinessResult['dependencies']['broadcastQueue'] = { status: redisStatus };
  const apiCampaignQueue: ReadinessResult['dependencies']['apiCampaignQueue'] = { status: redisStatus };
  let broadcastWorker: ReadinessResult['dependencies']['broadcastWorker'] = { status: 'NOT_VERIFIED' };
  let apiCampaignWorker: ReadinessResult['dependencies']['apiCampaignWorker'] = { status: 'NOT_VERIFIED' };
  if (queue.ready) {
    await Promise.all([
      (async () => { try { broadcastQueue.counts = boundedQueueCounts(await boundedHealthRead(campaignQueueCounts())); broadcastWorker = await boundedHealthRead(readWorkerHealth(await boundedHealthRead(campaignRedis()), 'broadcast')); } catch { broadcastQueue.status = 'UNAVAILABLE'; } })(),
      (async () => { try { apiCampaignQueue.counts = boundedQueueCounts(await boundedHealthRead(apiCampaignQueueCounts())); apiCampaignWorker = await boundedHealthRead(readWorkerHealth(await boundedHealthRead(apiCampaignRedis()), 'api-campaign')); } catch { apiCampaignQueue.status = 'UNAVAILABLE'; } })(),
    ]);
  }
  return {
    status: mongoStatus === 'UNAVAILABLE' || redisStatus === 'UNAVAILABLE' || (queue.ready && [broadcastQueue, apiCampaignQueue, broadcastWorker, apiCampaignWorker].some(item => item.status !== 'HEALTHY')) ? 'DEGRADED' : 'HEALTHY',
    service,
    timestamp: new Date().toISOString(),
    dependencies: {
      mongodb: { status: mongoStatus },
      redis: { status: redisStatus },
      broadcastQueue,
      broadcastWorker,
      apiCampaignQueue,
      apiCampaignWorker,
    },
  };
}
