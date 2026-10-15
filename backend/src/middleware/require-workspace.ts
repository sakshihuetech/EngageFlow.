import type { RequestHandler } from 'express';
import type { WorkspaceResolver } from '../types/workspace.js';
import { AppError } from '../utils/app-error.js';

export function requireWorkspace(resolver: WorkspaceResolver): RequestHandler {
  return async (request, _response, next) => {
    try {
      const context = await resolver.resolve(request);
      if (!context) {
        next(new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authentication is not configured.'));
        return;
      }
      request.workspaceContext = context;
      next();
    } catch (error) {
      next(error);
    }
  };
}
