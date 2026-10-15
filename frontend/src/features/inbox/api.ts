import { apiClient } from '../../services/api/client';
import type { CursorPage, InboxConversation, InboxMessage, InboxThread } from './types';
import { scopeSuffix, type AccountScope } from '../whatsapp/account-view';

function query(input: Record<string, string | number | boolean | undefined>) { const value = new URLSearchParams(); Object.entries(input).forEach(([key, item]) => { if (item !== undefined && item !== '') value.set(key, String(item)); }); return value.toString(); }

export const inboxApi = {
  conversations: (input: { search?: string; status?: string; unread?: boolean; cursor?: string; limit?: number } = {}, scope?: AccountScope) => apiClient.get<CursorPage<InboxConversation>>(`/api/inbox/conversations?${query({ ...input, limit: input.limit ?? 30 })}${scope ? `&${scopeSuffix(scope)}` : ''}`),
  messages: (id: string, input: { cursor?: string; limit?: number } = {}, scope?: AccountScope) => apiClient.get<InboxThread>(`/api/inbox/conversations/${encodeURIComponent(id)}/messages?${query({ ...input, limit: input.limit ?? 50 })}${scope ? `&${scopeSuffix(scope)}` : ''}`),
  reply: (id: string, text: string) => apiClient.post<{ message: InboxMessage; conversation: InboxConversation }>(`/api/inbox/conversations/${encodeURIComponent(id)}/messages`, { text }),
  markRead: (id: string) => apiClient.post<InboxConversation>(`/api/inbox/conversations/${encodeURIComponent(id)}/read`),
  update: (id: string, status: 'OPEN' | 'CLOSED') => apiClient.patch<InboxConversation>(`/api/inbox/conversations/${encodeURIComponent(id)}`, { status }),
};
