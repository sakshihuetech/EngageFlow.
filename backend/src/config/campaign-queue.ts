import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export const CAMPAIGN_QUEUE_NAME = 'whatsapp-campaign-send';

export interface CampaignJobData {
  workspaceId: string;
  campaignId: string;
  sequence: number;
}

export interface QueueHealth {
  ready: boolean;
  reason?: 'REDIS_NOT_CONFIGURED' | 'REDIS_UNAVAILABLE';
}

let connection: Redis | undefined;
let campaignQueue: Queue<CampaignJobData> | undefined;
let campaignWorker: Worker<CampaignJobData> | undefined;

export function isRedisConfigured() {
  return Boolean(env.REDIS_URL.trim());
}

function getConnection() {
  if (!isRedisConfigured()) throw new Error('Redis is not configured.');
  if (env.NODE_ENV === 'test') throw new Error('Real Redis is disabled during tests.');
  if (!connection) {
    connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      connectTimeout: 5_000,
      retryStrategy: (attempt: number) => attempt <= 3 ? Math.min(attempt * 250, 1_000) : null,
    });
    connection.on('error', () => logger.error('Campaign Redis connection error'));
  }
  return connection;
}

async function ensureConnected() {
  const redis = getConnection();
  if (redis.status === 'wait') await redis.connect();
  if (redis.status !== 'ready') throw new Error('Redis is unavailable.');
  await Promise.race([
    redis.ping(),
    new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('Redis readiness timed out.')), 5_000)),
  ]);
  return redis;
}

export const campaignRedis = ensureConnected;

export async function campaignQueueHealth(): Promise<QueueHealth> {
  if (!isRedisConfigured()) return { ready: false, reason: 'REDIS_NOT_CONFIGURED' };
  try {
    await ensureConnected();
    return { ready: true };
  } catch {
    return { ready: false, reason: 'REDIS_UNAVAILABLE' };
  }
}

export function campaignJobId(campaignId: string, sequence = 0) {
  return `campaign-${campaignId}-batch-${sequence}`;
}

export function campaignJobOptions(campaignId: string, sequence = 0, delay = 0) {
  return {
    jobId: campaignJobId(campaignId, sequence),
    delay: Math.max(0, delay),
    attempts: 1,
    removeOnComplete: { age: 86_400, count: 1_000 },
    removeOnFail: { age: 604_800, count: 5_000 },
  };
}

export async function enqueueCampaign(data: CampaignJobData, delay = 0) {
  const redis = await ensureConnected();
  campaignQueue ??= new Queue<CampaignJobData>(CAMPAIGN_QUEUE_NAME, { connection: redis });
  return campaignQueue.add('dispatch', data, campaignJobOptions(data.campaignId, data.sequence, delay));
}

export async function campaignQueueCounts() {
  const redis = await ensureConnected();
  campaignQueue ??= new Queue<CampaignJobData>(CAMPAIGN_QUEUE_NAME, { connection: redis });
  return campaignQueue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
}

export async function startCampaignWorker(processor: (job: Job<CampaignJobData>) => Promise<unknown>) {
  if (campaignWorker) return campaignWorker;
  const redis = await ensureConnected();
  campaignWorker = new Worker<CampaignJobData>(CAMPAIGN_QUEUE_NAME, processor, {
    connection: redis,
    concurrency: env.CAMPAIGN_WORKER_CONCURRENCY,
  });
  campaignWorker.on('error', () => logger.error('Campaign worker queue error'));
  campaignWorker.on('failed', (job) => logger.error('Campaign job failed', { jobId: job?.id ?? 'unknown' }));
  return campaignWorker;
}

export async function closeCampaignQueue() {
  await campaignWorker?.close().catch(() => undefined);
  await campaignQueue?.close().catch(() => undefined);
  await connection?.quit().catch(() => connection?.disconnect());
  campaignWorker = undefined;
  campaignQueue = undefined;
  connection = undefined;
}
