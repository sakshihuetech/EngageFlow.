import { apiClient } from '../../services/api/client';

export type RetargetFilter = 'READ' | 'DELIVERED_NOT_READ' | 'FAILED';
export interface RetargetPreview {
  source: { id: string; name: string; status: string; whatsappAccountId: string; templateName?: string };
  filter: RetargetFilter;
  total: number;
  eligible: number;
  exclusions: Record<string, number>;
  items: Array<{ sourceRecipientId: string; phone: string; outcome: string }>;
  nextCursor: string | null;
}
export interface RetargetTemplate { id: string; name: string; language: string }

export const retargetingApi = {
  preview: (campaignId: string, filter: RetargetFilter, cursor?: string) => apiClient.get<RetargetPreview>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/retargeting/preview?filter=${filter}&limit=25${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
  ),
  templates: (campaignId: string) => apiClient.get<{ items: RetargetTemplate[] }>(`/api/campaigns/${encodeURIComponent(campaignId)}/retargeting/templates`),
  create: (campaignId: string, input: { filter: RetargetFilter; templateId: string; name: string }, key: string) => apiClient.post<{ campaignId: string; idempotent: boolean; snapshotCount: number }>(
    `/api/campaigns/${encodeURIComponent(campaignId)}/retargeting/draft`, input, { 'Idempotency-Key': key },
  ),
};
