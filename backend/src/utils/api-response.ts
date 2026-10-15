import type { Request } from 'express';
import type { ApiFailure, ApiSuccess } from '../types/api.js';
import type { SafeProviderDiagnostic } from './app-error.js';

export function successResponse<T>(request: Request, data: T): ApiSuccess<T> {
  return { success: true, data, meta: { requestId: request.requestId } };
}

export function errorResponse(request: Request, code: string, message: string, provider?: SafeProviderDiagnostic): ApiFailure {
  return { success: false, error: { code, message, ...(provider ? { provider } : {}) }, meta: { requestId: request.requestId } };
}
