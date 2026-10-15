import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { apiCampaignRedis, closeApiCampaignQueue, startApiCampaignWorker } from '../config/api-campaign-queue.js';
import { processApiCampaignJob, reconcileApiCampaignExecutions } from '../services/api-campaign/worker.service.js';
import { startWorkerHeartbeat } from '../services/worker-health.service.js';
import { logger } from '../utils/logger.js';

let stopping = false;
let stopHeartbeat: (() => Promise<void>) | undefined;
async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info('API Campaign worker stopping', { signal });
  await stopHeartbeat?.();
  await closeApiCampaignQueue();
  await disconnectDatabase();
}
async function start() {
  if (await connectDatabase() !== 'HEALTHY') throw new Error('MongoDB is unavailable.');
  await reconcileApiCampaignExecutions();
  await startApiCampaignWorker(processApiCampaignJob);
  stopHeartbeat = await startWorkerHeartbeat(await apiCampaignRedis(), 'api-campaign');
  logger.info('API Campaign worker started');
}
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));
void start().catch(async () => {
  logger.error('API Campaign worker failed to start');
  await stop('STARTUP_FAILURE');
  process.exitCode = 1;
});
