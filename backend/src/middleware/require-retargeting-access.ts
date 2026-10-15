import type { RequestHandler } from 'express';
import { AppError } from '../utils/app-error.js';

// Replace this single boundary with authenticated workspace membership + permission
// checks that set request.workspaceContext from the trusted identity. Do not chain
// the development workspace resolver after this guard: it would overwrite identity.
// Loopback, tunnel headers, CORS, NODE_ENV and DEV_WORKSPACE_ID are never authority.
export const requireRetargetingAccess: RequestHandler = (_request, _response, next) => {
  next(new AppError(503, 'RETARGETING_AUTH_REQUIRED', 'Campaign Retargeting is unavailable until dashboard authentication and workspace authorization are configured.'));
};
