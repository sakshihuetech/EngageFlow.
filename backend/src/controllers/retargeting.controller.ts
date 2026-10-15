import type { NextFunction, Request, Response } from 'express';
import { createRetargetDraft as createDraft, retargetPreview, retargetTemplates } from '../services/broadcast/retargeting.service.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';

function context(request: Request) {
  if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authorization is unavailable.');
  return { workspaceId: request.workspaceContext.workspaceId, sourceCampaignId: String(request.params.id ?? '') };
}
function handler(work: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void work(request, response).catch(next);
}

export const getRetargetPreview = handler(async (request, response) => {
  const input = context(request);
  response.json(successResponse(request, await retargetPreview({ ...input, filter: request.query.filter, ...(typeof request.query.cursor === 'string' ? { cursor: request.query.cursor } : {}), limit: Math.min(Math.max(Number(request.query.limit) || 25, 1), 100) })));
});
export const getRetargetTemplates = handler(async (request, response) => {
  const { workspaceId, sourceCampaignId } = context(request);
  response.json(successResponse(request, { items: await retargetTemplates(workspaceId, sourceCampaignId) }));
});
export const createRetargetDraft = handler(async (request, response) => {
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  if ('workspaceId' in body || 'recipientIds' in body || 'recipientCount' in body || 'whatsappAccountId' in body || 'phoneNumberId' in body) {
    throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace, sender and audience are server-controlled.');
  }
  const result = await createDraft({ ...context(request), filter: body.filter, templateId: body.templateId, name: body.name, idempotencyKey: request.header('Idempotency-Key') });
  if (result.idempotent) response.setHeader('Idempotent-Replay', 'true');
  response.status(result.idempotent ? 200 : 201).json(successResponse(request, result));
});
