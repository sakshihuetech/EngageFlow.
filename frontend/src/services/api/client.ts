import type { ApiFailure, ApiSuccess, LivenessData, ReadinessData } from './types';

type ProviderDiagnostic = NonNullable<ApiFailure['error']['provider']>;

export function normalizeApiUrl(value: string) {
  return value.replace(/\/+$/, '').replace(/\/api$/, '');
}

export const apiBaseUrl = normalizeApiUrl(import.meta.env.VITE_API_URL || 'http://localhost:5001');
const REQUEST_TIMEOUT_MS = 8_000;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code = 'REQUEST_FAILED',
    public readonly provider?: ProviderDiagnostic,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    const payload = (await response.json()) as ApiSuccess<T> | ApiFailure;

    if (!response.ok || !payload.success) {
      const message = payload.success ? 'Request failed.' : payload.error.message;
      const code = payload.success ? 'REQUEST_FAILED' : payload.error.code;
      throw new ApiClientError(message, response.status, code, payload.success ? undefined : payload.error.provider);
    }

    return payload.data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError('The server took too long to respond.', undefined, 'REQUEST_TIMEOUT');
    }
    throw new ApiClientError('The EngageFlow API is unavailable.', undefined, 'NETWORK_ERROR');
  } finally {
    window.clearTimeout(timeout);
  }
}

export const healthApi = {
  live: () => request<LivenessData>('/api/health/live'),
  ready: () => request<ReadinessData>('/api/health/ready'),
};

export const apiClient = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit, timeoutMs?: number) => request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(headers)) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, timeoutMs),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  postForm: <T>(path: string, body: FormData) => request<T>(path, { method: 'POST', body }),
};
