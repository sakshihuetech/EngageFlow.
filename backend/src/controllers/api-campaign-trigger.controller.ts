import type { NextFunction, Request, Response } from 'express';
import { serializeExecution, triggerApiCampaign } from '../services/api-campaign/trigger.service.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';

export async function trigger(request: Request, response: Response, next: NextFunction) {
  try {
    const idempotencyKey = request.header('Idempotency-Key');
    const result = await triggerApiCampaign({
      workspaceId: request.workspaceContext!.workspaceId,
      credentialId: request.apiCredentialId!,
      ...(idempotencyKey ? { idempotencyKey } : {}),
      body: request.body,
    });
    if (result.replay) response.setHeader('Idempotent-Replay', 'true');
    const execution = serializeExecution(result.execution!.toObject() as never, request.baseUrl === '/api/v1/whatsapp/api-campaigns');
    const payload = {
      accepted: !['FAILED', 'REJECTED'].includes(result.execution!.status),
      idempotent: result.replay,
      execution,
      // Kept for clients that integrated with the first EngageFlow endpoint.
      executionId: String(result.execution!._id),
      status: result.execution!.status,
      replay: result.replay,
    };
    response.status(202).json(request.baseUrl === '/api/v1/whatsapp/api-campaigns'
      ? { accepted: payload.accepted, idempotent: payload.idempotent, execution: payload.execution }
      : successResponse(request, payload));
  } catch (error) {
    if (request.baseUrl === '/api/v1/whatsapp/api-campaigns') {
      const known = error instanceof AppError ? error : undefined;
      response.status(known?.statusCode ?? 500).json({ code: known?.code ?? 'API_CAMPAIGN_ERROR', message: known?.message ?? 'API Campaign request failed.' });
    } else next(error);
  }
}
