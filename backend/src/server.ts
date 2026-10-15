import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { closeCampaignQueue } from './config/campaign-queue.js';

const server = createServer(createApp());

void connectDatabase().then((database) => {
  const onListening = () => {
    logger.info('EngageFlow API started', { port: env.PORT, environment: env.NODE_ENV, database });
  };
  if (env.NODE_ENV === 'development') server.listen(env.PORT, '127.0.0.1', onListening);
  else server.listen(env.PORT, onListening);
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('Graceful shutdown started', { signal });

  server.close(async (error) => {
    if (error) {
      logger.error('Graceful shutdown failed', { errorName: error.name });
      process.exitCode = 1;
    }
    await Promise.all([closeCampaignQueue(), disconnectDatabase()]);
    process.exit();
  });

  setTimeout(() => {
    logger.error('Graceful shutdown timed out');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
