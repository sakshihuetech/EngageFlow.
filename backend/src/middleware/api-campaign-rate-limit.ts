import type { NextFunction, Request, Response } from 'express';
import { apiCampaignRedis } from '../config/api-campaign-queue.js';
import { env } from '../config/env.js';
import { errorResponse } from '../utils/api-response.js';
import { logger } from '../utils/logger.js';

const script = `local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; local ttl=redis.call('PTTL',KEYS[1]); return {n,ttl}`;
let connectionLogged = false;

const failure = (req: Request, res: Response, status: number, code: string, message: string) =>
  res.status(status).json(req.baseUrl === '/api/v1/whatsapp/api-campaigns'
    ? { code, message }
    : errorResponse(req, code, message));

export async function apiCampaignRateLimit(req: Request, res: Response, next: NextFunction) {
  if (!req.workspaceContext || !req.apiCredentialId) {
    failure(req, res, 401, 'UNAUTHORIZED', 'API authentication is required.');
    return;
  }
  try {
    const bucket = Math.floor(Date.now() / env.API_CAMPAIGN_RATE_LIMIT_WINDOW_MS);
    const key = `api-campaign:rate:${req.workspaceContext.workspaceId}:${bucket}`;
    const redis = await apiCampaignRedis();
    if (!connectionLogged) {
      logger.info('API Campaign rate-limit Redis ready');
      connectionLogged = true;
    }
    const result = await redis.eval(script, 1, key, String(env.API_CAMPAIGN_RATE_LIMIT_WINDOW_MS)) as [number, number];
    const remaining = Math.max(0, env.API_CAMPAIGN_RATE_LIMIT_MAX - result[0]);
    res.set('X-RateLimit-Limit', String(env.API_CAMPAIGN_RATE_LIMIT_MAX));
    res.set('X-RateLimit-Remaining', String(remaining));
    if (result[0] > env.API_CAMPAIGN_RATE_LIMIT_MAX) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(result[1] / 1000))));
      failure(req, res, 429, 'RATE_LIMITED', 'API Campaign request limit exceeded.');
      return;
    }
    next();
  } catch (error) {
    logger.error('API Campaign rate-limit Redis unavailable', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    });
    failure(req, res, 503, 'RATE_LIMIT_UNAVAILABLE', 'API request protection is unavailable.');
  }
}
