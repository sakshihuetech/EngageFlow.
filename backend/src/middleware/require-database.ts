import type { RequestHandler } from 'express';
import { databaseStatus } from '../config/database.js';
import { AppError } from '../utils/app-error.js';

export const requireDatabase: RequestHandler = (_request, _response, next) => {
  if (databaseStatus() !== 'HEALTHY') {
    next(new AppError(503, 'DATABASE_UNAVAILABLE', 'Broadcast persistence is not configured.'));
    return;
  }
  next();
};
