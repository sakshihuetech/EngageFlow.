export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta: { requestId: string };
}

export interface ApiFailure {
  success: false;
  error: { code: string; message: string; provider?: {
    httpStatus: number;
    metaCode?: number;
    metaSubcode?: number;
    title?: string;
    message: string;
    traceId?: string;
  } };
  meta: { requestId: string };
}

export type ServiceStatus = 'HEALTHY' | 'UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_VERIFIED' | 'DEGRADED' | 'STALE';

export interface LivenessData {
  status: 'HEALTHY';
  service: 'engageflow-api';
  timestamp: string;
}

export interface DependencyHealth {
  status: ServiceStatus;
  counts?: Record<string, number>;
}

export interface ReadinessData {
  status: 'HEALTHY' | 'DEGRADED';
  service: 'engageflow-api';
  timestamp: string;
  dependencies: {
    mongodb: DependencyHealth;
    redis: DependencyHealth;
    broadcastQueue: DependencyHealth;
    broadcastWorker: DependencyHealth;
    apiCampaignQueue: DependencyHealth;
    apiCampaignWorker: DependencyHealth;
  };
}
