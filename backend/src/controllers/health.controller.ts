import type { RequestHandler } from 'express';
import { getLiveness, getReadiness } from '../services/health.service.js';
import { successResponse } from '../utils/api-response.js';

export const liveness: RequestHandler = (request, response) => {
  response.status(200).json(successResponse(request, getLiveness()));
};

export const readiness: RequestHandler = async (request, response, next) => {
  try {
    response.status(200).json(successResponse(request, await getReadiness()));
  } catch (error) {
    next(error);
  }
};
