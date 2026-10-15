import { randomUUID } from 'node:crypto';
import { env } from '../../config/env.js';
import { sendTemplateMessage } from './meta-graph.service.js';

export interface TemplateTransportInput {
  phoneNumberId: string;
  payload: Record<string, unknown>;
  accessToken?: string;
}

export interface TemplateTransportResult {
  messageId: string;
  responseStatus?: string;
}

export interface WhatsAppTransport {
  readonly requiresCredential: boolean;
  sendTemplate(input: TemplateTransportInput): Promise<TemplateTransportResult>;
}

export class ProviderSendError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly safeToRetry = false,
  ) {
    super(message);
    this.name = 'ProviderSendError';
  }
}

class DisabledTransport implements WhatsAppTransport {
  readonly requiresCredential = false;

  async sendTemplate(_input: TemplateTransportInput): Promise<TemplateTransportResult> {
    void _input;
    throw new ProviderSendError('Live Meta transport is not configured.', 503, 'META_TRANSPORT_DISABLED');
  }
}

class MockTransport implements WhatsAppTransport {
  readonly requiresCredential = false;

  async sendTemplate(_input: TemplateTransportInput): Promise<TemplateTransportResult> {
    void _input;
    if (env.NODE_ENV === 'production') throw new ProviderSendError('Mock transport is forbidden in production.', 503, 'MOCK_TRANSPORT_FORBIDDEN');
    return { messageId: `wamid.mock.${randomUUID().replaceAll('-', '')}`, responseStatus: 'accepted' };
  }
}

class MetaTransport implements WhatsAppTransport {
  readonly requiresCredential = true;

  async sendTemplate(input: TemplateTransportInput): Promise<TemplateTransportResult> {
    if (!input.accessToken) throw new ProviderSendError('Meta credential is unavailable.', 409, 'META_CREDENTIAL_UNAVAILABLE');
    const result = await sendTemplateMessage(input.phoneNumberId, input.accessToken, input.payload);
    const message = result.messages?.[0];
    if (!message?.id) throw new ProviderSendError('Meta accepted the request but did not return a message ID.', 502, 'INVALID_META_RESPONSE');
    return { messageId: message.id, ...(message.message_status ? { responseStatus: message.message_status } : {}) };
  }
}

export function configuredWhatsAppTransport(): WhatsAppTransport {
  if (env.CAMPAIGN_TRANSPORT === 'mock') return new MockTransport();
  if (env.CAMPAIGN_TRANSPORT === 'meta') return new MetaTransport();
  return new DisabledTransport();
}
