import type { Request, Response, NextFunction } from 'express';
import { unlink } from 'node:fs/promises';
import { completeSetupOnboarding, refreshSetupAssets, disconnectSetup, registerSetupPhone } from '../services/whatsapp/setup-controls.service.js';
import { getBusinessProfile, updateBusinessProfile, updateBusinessPicture } from '../services/whatsapp/business-profile.service.js';
import { MetaGraphError, metaFailureResolution } from '../services/whatsapp/meta-graph.service.js';
import { AppError } from '../utils/app-error.js';
import { successResponse } from '../utils/api-response.js';

function handler(work: (workspace: string, request: Request) => Promise<unknown>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void (async () => {
      if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace is unavailable.');
      const result = await work(String(request.workspaceContext.workspaceId), request);
      response.json(successResponse(request, result));
    })().catch((error: unknown) => {
      if (error instanceof MetaGraphError) {
        const billing = metaFailureResolution(error.details.code);
        next(new AppError(error.status, billing?.code ?? error.code, billing?.message ?? 'Meta could not complete this Setup action. Check permissions and provider state; refresh before retrying.'));
      } else next(error);
    });
  };
}
function body(request: Request) {
  if (!request.body || typeof request.body !== 'object' || Array.isArray(request.body)) throw new AppError(400, 'INVALID_INPUT', 'Provide an object.');
  return request.body as Record<string, unknown>;
}
export const completeOnboarding = handler((workspace, request) => completeSetupOnboarding(workspace, body(request)));
export const refreshAssets = handler(workspace => refreshSetupAssets(workspace));
export const disconnect = handler((workspace, request) => {
  if (body(request).confirm !== true) throw new AppError(400, 'CONFIRMATION_REQUIRED', 'Confirm local disconnection.');
  return disconnectSetup(workspace);
});
export const registerPhone = handler((workspace, request) => registerSetupPhone(workspace, body(request)));
export const readProfile = handler(workspace => getBusinessProfile(workspace));
export const writeProfile = handler((workspace, request) => updateBusinessProfile(workspace, body(request)));
export const writePicture = handler(async (workspace, request) => {
  if (!request.file) throw new AppError(400, 'PICTURE_REQUIRED', 'Select a profile picture.');
  try { return await updateBusinessPicture(workspace, request.file); }
  finally { await unlink(request.file.path).catch(() => undefined); }
});
