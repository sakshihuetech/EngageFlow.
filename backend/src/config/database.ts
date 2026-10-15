import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

export type DatabaseStatus = 'HEALTHY' | 'UNAVAILABLE' | 'NOT_CONFIGURED';

export function databaseStatus(): DatabaseStatus {
  if (!env.MONGODB_URI) return 'NOT_CONFIGURED';
  return mongoose.connection.readyState === 1 ? 'HEALTHY' : 'UNAVAILABLE';
}

export async function connectDatabase(): Promise<DatabaseStatus> {
  if (!env.MONGODB_URI) return 'NOT_CONFIGURED';
  try {
    await mongoose.connect(env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5_000,
      maxPoolSize: 20,
      autoIndex: false,
      autoCreate: false,
    });
    logger.info('MongoDB connection established');
    return 'HEALTHY';
  } catch (error) {
    logger.error('MongoDB connection failed', { errorName: error instanceof Error ? error.name : 'UnknownError' });
    return 'UNAVAILABLE';
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
}
