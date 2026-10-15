import type { ErrorRequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError, TemplateLibraryProviderError } from '../utils/app-error.js';
import { errorResponse } from '../utils/api-response.js';
import { logger } from '../utils/logger.js';

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, _next) => {
  void _next;
  if (error instanceof AppError) {
    response.status(error.statusCode).json(errorResponse(request, error.code, error.message, error instanceof TemplateLibraryProviderError ? error.provider : undefined));
    return;
  }

  logger.error('Unhandled request error', {
    requestId: request.requestId,
    method: request.method,
    path: request.path,
    errorName: error instanceof Error ? error.name : 'UnknownError',
  });

  const message = env.NODE_ENV === 'development' && error instanceof Error
    ? error.message
    : 'An unexpected error occurred.';
  response.status(500).json(errorResponse(request, 'INTERNAL_SERVER_ERROR', message));
};
