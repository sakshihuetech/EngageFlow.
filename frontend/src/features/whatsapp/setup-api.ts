import { apiClient } from '../../services/api/client';

export interface BusinessProfile { displayName?: string; profile: { about?: string; address?: string; description?: string; email?: string; websites?: string[]; vertical?: string; profile_picture_url?: string } }
export const setupApi = {
  onboarding: (input: { code: string; wabaId: string; phoneNumberId?: string; businessId?: string; onboardingMode: string }) => apiClient.post<{ synced: number }>('/api/whatsapp/setup/onboarding/complete', input, undefined, 60_000),
  refresh: () => apiClient.post<{ synced: number }>('/api/whatsapp/setup/refresh', {}, undefined, 45_000),
  register: (pin: string) => apiClient.post<{ state: string; registeredNow: boolean }>('/api/whatsapp/setup/register', { pin }),
  disconnect: () => apiClient.post<{ disconnected: boolean }>('/api/whatsapp/setup/disconnect', { confirm: true }),
  profile: () => apiClient.get<BusinessProfile>('/api/whatsapp/setup/profile'),
  updateProfile: (input: BusinessProfile['profile']) => apiClient.patch<BusinessProfile>('/api/whatsapp/setup/profile', input),
  picture: (file: File) => { const form = new FormData(); form.set('file', file); return apiClient.postForm<BusinessProfile>('/api/whatsapp/setup/profile/picture', form); },
};
