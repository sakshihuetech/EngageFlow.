import { env } from '../../config/env.js';
import { createReadStream } from 'node:fs';

export interface MetaErrorDetails {
  code?: number;
  errorSubcode?: number;
  userTitle?: string;
  userMessage?: string;
  providerMessage?: string;
  traceId?: string;
  retryAfterMs?: number;
}

export function sanitizeMetaDiagnosticText(value: unknown, max = 300): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = Array.from(value, (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character).join('')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:access[_-]?token|api[_-]?key|authorization|password|secret)\b\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[redacted URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\+?\d[\d\s().-]{7,}\d/g, '[redacted number]')
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, '[redacted value]')
    .trim().slice(0, max);
  return cleaned || undefined;
}

export class MetaGraphError extends Error {
  readonly safeToRetry: boolean;
  constructor(message: string, status: number, code: string, public readonly details: MetaErrorDetails = {}) {
    super(message);
    this.name = 'MetaGraphError';
    this.status = status;
    this.code = code;
    // A transport failure can occur after Meta accepted the request. Only an
    // explicit throttling response is safe for automatic re-submission.
    this.safeToRetry = status === 429 && typeof details.code === 'number';
  }

  readonly status: number;
  readonly code: string;
}

function retryAfterMilliseconds(value?: string | null) {
  if (!value) return undefined;
  const seconds = /^[0-9]{1,6}$/.test(value) ? Number(value) * 1_000 : NaN;
  const delay = Number.isFinite(seconds) ? seconds : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? Math.min(delay, 86_400_000) : undefined;
}

function safeMetaError(payload: unknown, status: number, retryAfter?: string | null) {
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const value = root.error && typeof root.error === 'object' ? root.error as Record<string, unknown> : {};
  const userTitle = sanitizeMetaDiagnosticText(value.error_user_title);
  const userMessage = sanitizeMetaDiagnosticText(value.error_user_msg, 500);
  const providerMessage = sanitizeMetaDiagnosticText(value.message, 500);
  const retryAfterMs = retryAfterMilliseconds(retryAfter);
  const details: MetaErrorDetails = {
    ...(typeof value.code === 'number' ? { code: value.code } : {}),
    ...(typeof value.error_subcode === 'number' ? { errorSubcode: value.error_subcode } : {}),
    ...(userTitle ? { userTitle } : {}),
    ...(userMessage ? { userMessage } : {}),
    ...(providerMessage ? { providerMessage } : {}),
    ...(typeof value.fbtrace_id === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value.fbtrace_id) ? { traceId: value.fbtrace_id } : {}),
    ...(retryAfterMs ? { retryAfterMs } : {}),
  };
  const message = details.providerMessage ?? 'Meta Graph API request failed.';
  return new MetaGraphError(message, status, String(details.code ?? 'META_GRAPH_ERROR'), details);
}

export async function graphRequest<T>(path: string, input: { method?: 'GET' | 'POST' | 'DELETE'; accessToken: string; body?: unknown; form?: Record<string, string> } ): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${path}`, {
      method: input.method ?? 'GET',
      headers: { ...(input.accessToken ? { Authorization: `Bearer ${input.accessToken}` } : {}), ...(input.form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : input.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(input.form ? { body: new URLSearchParams(input.form) } : input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as unknown;
    if (!response.ok) throw safeMetaError(payload, response.status, response.headers?.get('retry-after'));
    return payload as T;
  } catch (error) {
    if (error instanceof MetaGraphError) throw error;
    const timeoutFailure = error instanceof Error && error.name === 'AbortError';
    throw new MetaGraphError(timeoutFailure ? 'Meta Graph API request timed out.' : 'Meta Graph API could not be reached.', 502, timeoutFailure ? 'META_TIMEOUT' : 'META_UNAVAILABLE');
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchMessageTemplates(wabaId: string, accessToken: string) {
  const templates: Array<Record<string, unknown>> = [];
  let after: string | undefined;
  do {
    const query = new URLSearchParams({ fields: 'id,name,language,category,status,components,rejected_reason', limit: '100' });
    if (after) query.set('after', after);
    const page = await graphRequest<{ data?: Array<Record<string, unknown>>; paging?: { cursors?: { after?: string }; next?: string } }>(`${encodeURIComponent(wabaId)}/message_templates?${query}`, { accessToken });
    if (Array.isArray(page.data)) templates.push(...page.data);
    after = page.paging?.next && page.paging.cursors?.after ? page.paging.cursors.after : undefined;
  } while (after);
  return templates;
}

export async function createMessageTemplate(wabaId: string, accessToken: string, payload: unknown) {
  return graphRequest<{ id?: string; status?: string; category?: string }>(`${encodeURIComponent(wabaId)}/message_templates`, { method: 'POST', accessToken, body: payload });
}

export async function editMessageTemplate(templateId: string, accessToken: string, components: unknown[]) {
  return graphRequest<Record<string, unknown>>(encodeURIComponent(templateId), { method: 'POST', accessToken, body: { components } });
}

export async function fetchMessageTemplate(templateId: string, accessToken: string) {
  return graphRequest<Record<string, unknown>>(`${encodeURIComponent(templateId)}?fields=id,name,language,category,status,components,rejected_reason`, { accessToken });
}

export async function deleteMessageTemplate(wabaId: string, accessToken: string, templateId: string, name: string) {
  const query = new URLSearchParams({ hsm_id: templateId, name });
  return graphRequest<{ success?: boolean }>(`${encodeURIComponent(wabaId)}/message_templates?${query}`, { method: 'DELETE', accessToken });
}

export interface LibraryFilters { category?: string; language?: string; search?: string; topic?: string; usecase?: string; industry?: string; after?: string; limit?: number }
export async function fetchMessageTemplateLibrary(accessToken: string, filters: LibraryFilters) {
  const query = new URLSearchParams({ limit: String(Math.min(50, Math.max(1, filters.limit ?? 20))) });
  for (const key of ['category', 'language', 'search', 'topic', 'usecase', 'industry', 'after'] as const) if (filters[key]) query.set(key, filters[key]);
  return graphRequest<{ data?: Array<Record<string, unknown>>; paging?: { cursors?: { after?: string }; next?: string } }>(`message_template_library?${query}`, { accessToken });
}

export async function uploadTemplateHeaderMedia(input: { accessToken: string; filePath: string; fileName: string; fileSize: number; mimeType: string }) {
  if (!env.META_APP_ID) throw new MetaGraphError('Meta App ID is not configured.', 409, 'META_APP_ID_REQUIRED');
  const query = new URLSearchParams({ file_length: String(input.fileSize), file_type: input.mimeType, file_name: input.fileName });
  const session = await graphRequest<{ id?: string }>(`${encodeURIComponent(env.META_APP_ID)}/uploads?${query}`, { method: 'POST', accessToken: input.accessToken });
  if (!session.id) throw new MetaGraphError('Meta did not return an upload session.', 502, 'META_UPLOAD_SESSION_MISSING');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(`https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${encodeURIComponent(session.id)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${input.accessToken}`, 'Content-Type': input.mimeType, file_offset: '0' },
      body: createReadStream(input.filePath) as unknown as BodyInit,
      duplex: 'half',
      signal: controller.signal,
    } as RequestInit & { duplex: 'half' });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw safeMetaError(payload, response.status);
    if (typeof payload.h !== 'string' || !payload.h) throw new MetaGraphError('Meta did not return an uploaded media handle.', 502, 'META_UPLOAD_HANDLE_MISSING');
    return payload.h;
  } catch (error) {
    if (error instanceof MetaGraphError) throw error;
    throw new MetaGraphError(error instanceof Error && error.name === 'AbortError' ? 'Meta media upload timed out.' : 'Meta media upload failed.', 502, 'META_UPLOAD_FAILED');
  } finally { clearTimeout(timeout); }
}

export async function sendTemplateMessage(phoneNumberId: string, accessToken: string, payload: unknown) {
  return graphRequest<{ messages?: Array<{ id?: string; message_status?: string }> }>(`${encodeURIComponent(phoneNumberId)}/messages`, { method: 'POST', accessToken, body: payload });
}

export async function sendTextMessage(phoneNumberId: string, accessToken: string, payload: unknown) {
  return graphRequest<{ messages?: Array<{ id?: string; message_status?: string }> }>(`${encodeURIComponent(phoneNumberId)}/messages`, { method: 'POST', accessToken, body: payload });
}

export function metaFailureResolution(code: unknown) {
  if (String(code) === '131037') return {
    code: '131037', title: 'Display name approval required',
    message: 'Meta blocked this WhatsApp-provided number because its display name is not currently approved for this send.',
    nextAction: 'Check the sending phone and display name state in WhatsApp Manager. Refresh Meta Assets in WhatsApp Setup after Meta resolves the issue.',
  };
  if (String(code) === '131042') return {
    code: '131042', title: 'Payment setup required',
    message: 'Meta requires billing or payment eligibility to be completed for this business account.',
    nextAction: 'Complete payment setup in Meta Business billing.',
    actionUrl: 'https://business.facebook.com/billing_hub/',
  };
  return undefined;
}
