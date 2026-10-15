import { apiClient } from '../../services/api/client';
import { scopeSuffix, type AccountScope } from '../whatsapp/account-view';
import type {
  BroadcastAnalytics, BroadcastCampaign, BroadcastOptions, BroadcastReadiness,
  BroadcastRecipient, BroadcastRetryPreview, CreateBroadcastInput, CursorPage,
} from './types';

export const broadcastsApi = {
  list(input: { search?: string; status?: string; cursor?: string; limit?: number; scope?: AccountScope } = {}) {
    const query = new URLSearchParams({ limit: String(input.limit ?? 25) });
    if (input.search) query.set('search', input.search);
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.scope) { query.set('view', 'history'); query.set('accountId', input.scope.accountId); }
    return apiClient.get<CursorPage<BroadcastCampaign>>(`/api/campaigns?${query}`);
  },
  options: () => apiClient.get<BroadcastOptions>('/api/campaigns/options'),
  create: (input: CreateBroadcastInput, key: string) => apiClient.post<BroadcastCampaign>('/api/campaigns', input, { 'Idempotency-Key': key }),
  update: (id: string, input: CreateBroadcastInput) => apiClient.patch<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}`, input),
  duplicate: (id: string) => apiClient.post<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}/duplicate`),
  get: (id: string, scope?: AccountScope) => apiClient.get<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}${scope ? `?${scopeSuffix(scope)}` : ''}`),
  readiness: (id: string) => apiClient.get<BroadcastReadiness>(`/api/campaigns/${encodeURIComponent(id)}/readiness`),
  analytics: (id: string, scope?: AccountScope) => apiClient.get<BroadcastAnalytics>(`/api/campaigns/${encodeURIComponent(id)}/analytics${scope ? `?${scopeSuffix(scope)}` : ''}`),
  recipients(id: string, input: { status?: string; cursor?: string; limit?: number; scope?: AccountScope } = {}) {
    const query = new URLSearchParams({ limit: String(input.limit ?? 25) });
    if (input.status) query.set('status', input.status);
    if (input.cursor) query.set('cursor', input.cursor);
    if (input.scope) { query.set('view', 'history'); query.set('accountId', input.scope.accountId); }
    return apiClient.get<CursorPage<BroadcastRecipient>>(`/api/campaigns/${encodeURIComponent(id)}/recipients?${query}`);
  },
  launch: (id: string, input: { mode: 'SEND_NOW' | 'SCHEDULE'; scheduledLocal?: string; timezone: string; launchKey: string }) =>
    apiClient.post<{ campaign: BroadcastCampaign; snapshot?: { total: number; eligible: number; skipped: number }; idempotent: boolean }>(
      `/api/campaigns/${encodeURIComponent(id)}/launch`, input, { 'Idempotency-Key': input.launchKey },
    ),
  pause: (id: string) => apiClient.post<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}/pause`),
  resume: (id: string) => apiClient.post<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}/resume`),
  cancel: (id: string) => apiClient.post<BroadcastCampaign>(`/api/campaigns/${encodeURIComponent(id)}/cancel`),
  retryPreview: (id: string) => apiClient.get<BroadcastRetryPreview>(`/api/campaigns/${encodeURIComponent(id)}/retry/preview`),
  retryFailed: (id: string, key: string) => apiClient.post<{ accepted: boolean; idempotent: boolean; retryBatchId: string; dispatchDelayed?: boolean }>(`/api/campaigns/${encodeURIComponent(id)}/retry`, { confirm: true }, { 'Idempotency-Key': key }),
};
