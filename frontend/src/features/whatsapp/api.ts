import { apiClient } from '../../services/api/client';
import type { MetaLibraryItem, SendTestMessageInput, TemplateAuthoringInput, TestMessageStatus, WhatsAppSetup, WhatsAppTemplate } from './types';

export const whatsAppApi = {
  setup: () => apiClient.get<WhatsAppSetup>('/api/whatsapp/setup'),
  templates(input: { status?: string; search?: string } = {}) {
    const query = new URLSearchParams();
    if (input.status && input.status !== 'ALL') query.set('status', input.status);
    if (input.search) query.set('search', input.search);
    return apiClient.get<{ items: WhatsAppTemplate[] }>(`/api/whatsapp/templates${query.size ? `?${query}` : ''}`);
  },
  syncTemplates: () => apiClient.post<{ items: WhatsAppTemplate[]; synced: number }>('/api/whatsapp/templates/sync'),
  createTemplate: (input: TemplateAuthoringInput) => apiClient.post<WhatsAppTemplate>('/api/whatsapp/templates', input),
  editTemplate: (id: string, input: TemplateAuthoringInput) => apiClient.patch<WhatsAppTemplate>(`/api/whatsapp/templates/${encodeURIComponent(id)}`, input),
  deleteTemplate: (id: string) => apiClient.delete<{ alreadyDeleted: boolean }>(`/api/whatsapp/templates/${encodeURIComponent(id)}`),
  library(input: { category: string; language: string; search?: string; topic?: string; usecase?: string; industry?: string; after?: string }) {
    const query = new URLSearchParams(input);
    return apiClient.get<{ items: MetaLibraryItem[]; paging: { after?: string; hasNext: boolean } }>(`/api/whatsapp/templates/library?${query}`);
  },
  useLibraryTemplate: (input: { libraryTemplateName: string; language: string; name: string; bodyInputs?: Record<string, unknown>; bodyParamInputs?: unknown[]; buttonInputs?: unknown[] }) => apiClient.post<WhatsAppTemplate>('/api/whatsapp/templates/library/use', input),
  uploadTemplateMedia: (headerType: string, file: File) => { const form = new FormData(); form.set('headerType', headerType); form.set('file', file); return apiClient.postForm<{ handle: string }>('/api/whatsapp/templates/media', form); },
  sendTest: (input: SendTestMessageInput) => apiClient.post<TestMessageStatus>('/api/whatsapp/messages', input),
  latestTestStatus: () => apiClient.get<TestMessageStatus | null>('/api/whatsapp/messages/latest/status'),
  testStatus: (recordId: string) => apiClient.get<TestMessageStatus>(`/api/whatsapp/messages/${encodeURIComponent(recordId)}/status`),
};
