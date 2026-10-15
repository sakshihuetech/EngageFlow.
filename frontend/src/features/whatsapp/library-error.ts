import { ApiClientError } from '../../services/api/client';

export function libraryCreateErrorMessage(reason: unknown): string {
  if (!(reason instanceof ApiClientError)) return reason instanceof Error ? reason.message : 'Meta library template could not be used.';
  const provider = reason.provider;
  if (!provider) return reason.message;
  const code = provider.metaCode !== undefined ? `Meta ${provider.metaCode}${provider.metaSubcode !== undefined ? `/${provider.metaSubcode}` : ''}: ` : '';
  const title = provider.title ? `${provider.title}. ` : '';
  return `${code}${title}${provider.message}${provider.traceId ? ` (Trace: ${provider.traceId})` : ''}`;
}
