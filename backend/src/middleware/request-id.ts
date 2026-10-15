import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const requestIdPattern = /^[a-zA-Z0-9._-]{1,100}$/;

export function requestId(request: Request, response: Response, next: NextFunction) {
  const incomingId = request.header('x-request-id');
  request.requestId = incomingId && requestIdPattern.test(incomingId) ? incomingId : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
