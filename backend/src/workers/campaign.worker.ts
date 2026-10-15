import { campaignRedis, closeCampaignQueue, isRedisConfigured, startCampaignWorker } from '../config/campaign-queue.js';
import { startWorkerHeartbeat } from '../services/worker-health.service.js';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { env } from '../config/env.js';
import { processCampaignJob, reconcileCampaignWork } from '../services/broadcast/worker.service.js';
import { logger } from '../utils/logger.js';

let reconciliationTimer: NodeJS.Timeout | undefined;
let stopping = false;
let stopHeartbeat: (() => Promise<void>) | undefined;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  if (reconciliationTimer) clearInterval(reconciliationTimer);
  await stopHeartbeat?.();
  logger.info('Campaign worker shutdown started', { signal });
  await closeCampaignQueue();
  await disconnectDatabase();
}

async function start() {
  const database = await connectDatabase();
  if (database !== 'HEALTHY') throw new Error('MONGODB_URI must reference an available database.');
  if (!isRedisConfigured()) throw new Error('REDIS_URL is required for the campaign worker.');
  await startCampaignWorker(processCampaignJob);
  await reconcileCampaignWork();
  stopHeartbeat = await startWorkerHeartbeat(await campaignRedis(), 'broadcast');
  reconciliationTimer = setInterval(() => void reconcileCampaignWork().catch(() => logger.error('Campaign reconciliation failed')), 60_000);
  reconciliationTimer.unref();
  logger.info('Campaign worker started', {
    concurrency: env.CAMPAIGN_WORKER_CONCURRENCY,
    liveSendEnabled: env.CAMPAIGN_LIVE_SEND_ENABLED,
    transport: env.CAMPAIGN_TRANSPORT,
  });
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
void start().catch(async (error) => {
  logger.error('Campaign worker failed to start', { errorName: error instanceof Error ? error.name : 'UnknownError' });
  await shutdown('STARTUP_FAILURE');
  process.exitCode = 1;
});
