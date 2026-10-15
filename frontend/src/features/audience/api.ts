import { apiClient } from '../../services/api/client';
import type { Contact, ContactInput, CursorPage, Segment, SegmentInput } from './types';

function query(input: Record<string, string | number | undefined>) {
  const value = new URLSearchParams();
  Object.entries(input).forEach(([key, item]) => { if (item !== undefined && item !== '') value.set(key, String(item)); });
  return value.toString();
}

export const audienceApi = {
  contact: (id: string) => apiClient.get<Contact>(`/api/audience/contacts/${encodeURIComponent(id)}`),
  import: (items: ContactInput[], preview = false) => apiClient.post<{ total: number; valid: number; created: number; duplicates: number; invalid: number; errors: { row: number; message: string }[] }>('/api/audience/contacts/import', { items, preview }),
  bulk: (ids: string[], action: string, values: { tags?: string[]; status?: string } = {}) => apiClient.post<{ matched: number; modified: number }>('/api/audience/contacts/bulk', { ids, action, ...values }),
  contacts: (input: { search?: string; status?: string; cursor?: string; limit?: number } = {}) => apiClient.get<CursorPage<Contact>>(`/api/audience/contacts?${query({ ...input, limit: input.limit ?? 25 })}`),
  createContact: (input: ContactInput) => apiClient.post<Contact>('/api/audience/contacts', input),
  updateContact: (id: string, input: Partial<ContactInput>) => apiClient.patch<Contact>(`/api/audience/contacts/${encodeURIComponent(id)}`, input),
  deleteContact: (id: string) => apiClient.delete<{ id: string; status: 'DELETED' }>(`/api/audience/contacts/${encodeURIComponent(id)}`),
  restoreContact: (id: string) => apiClient.post<Contact>(`/api/audience/contacts/${encodeURIComponent(id)}/restore`),
  segments: (input: { search?: string; cursor?: string; limit?: number } = {}) => apiClient.get<CursorPage<Segment>>(`/api/audience/segments?${query({ ...input, limit: input.limit ?? 25 })}`),
  createSegment: (input: SegmentInput) => apiClient.post<Segment>('/api/audience/segments', input),
  updateSegment: (id: string, input: SegmentInput) => apiClient.patch<Segment>(`/api/audience/segments/${encodeURIComponent(id)}`, input),
  deleteSegment: (id: string) => apiClient.delete<{ id: string; deleted: true }>(`/api/audience/segments/${encodeURIComponent(id)}`),
};
