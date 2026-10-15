export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
    provider?: import('../utils/app-error.js').SafeProviderDiagnostic;
  };
  meta: ApiMeta;
}

export type DependencyStatus = 'HEALTHY' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_VERIFIED' | 'DEGRADED' | 'STALE';
