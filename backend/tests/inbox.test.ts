import type { RequestHandler } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { decodeConversationCursor, encodeConversationCursor, assertInboxLiveSendEnabled, listConversationMessages, markConversationRead } from '../src/controllers/inbox.controller.js';
import { webhookTestables } from '../src/controllers/whatsapp-webhook.controller.js';
import { Contact } from '../src/models/contact.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import { inboundContent, isServiceWindowOpen, persistInboundMessage, sendInboxReply } from '../src/services/whatsapp/inbox.service.js';
import * as connectionContext from '../src/services/whatsapp/connection-context.service.js';

const oid = (value: number) => `64b${String(value).padStart(21, '0')}`;
const W1 = oid(1); const W2 = oid(2); const A1 = oid(3); const P1 = oid(4); const C1 = oid(5); const V1 = oid(6);

afterEach(() => vi.restoreAllMocks());

function invoke(handler: RequestHandler, request: Record<string, unknown>) { return new Promise<{ status: number; body: any }>((resolve, reject) => { let status = 200; const response = { status(code: number) { status = code; return this; }, json(body: unknown) { resolve({ status, body }); return this; } }; handler(request as never, response as never, reject); }); }

function memoryModels() {
  const contacts: any[] = []; const conversations: any[] = []; const messages: any[] = []; let sequence = 20;
  const same = (a: unknown, b: unknown) => String(a) === String(b);
  const matches = (row: Record<string, unknown>, filter: Record<string, unknown>) => Object.entries(filter).every(([key, value]) => same(row[key], value));
  const models = {
    WhatsAppPhoneNumber: { find: (filter: any) => ({ limit: () => ({ lean: async () => [{ _id: P1, workspaceId: W1, whatsappAccountId: A1, phoneNumberId: filter.phoneNumberId }] }) }) },
    WhatsAppAccount: { findOne: () => ({ lean: async () => ({ _id: A1, workspaceId: W1, wabaId: '1000000000000001' }) }) },
    Contact: { findOne: (filter: any) => ({ lean: async () => contacts.find((row) => matches(row, filter)) ?? null }), create: async (value: any) => { const row = { _id: oid(sequence++), ...value }; contacts.push(row); return row; } },
    Conversation: {
      findOneAndUpdate: async (filter: any, update: any) => { let row = conversations.find((item) => matches(item, filter)); if (!row) { row = { _id: oid(sequence++), ...update.$setOnInsert }; conversations.push(row); } Object.assign(row, update.$set ?? {}); return row; },
      findOne: async (filter: any) => conversations.find((row) => matches(row, filter)) ?? null,
      updateOne: async (filter: any, update: any) => { const row = conversations.find((item) => matches(item, filter)); if (!row) return { modifiedCount: 0 }; Object.assign(row, update.$set ?? {}); for (const [key, value] of Object.entries(update.$inc ?? {})) row[key] = Number(row[key] ?? 0) + Number(value); return { modifiedCount: 1 }; },
    },
    WhatsAppMessage: { create: async (value: any) => { if (messages.some((row) => row.metaMessageId === value.metaMessageId)) throw Object.assign(new Error('duplicate'), { code: 11000 }); const row = { _id: oid(sequence++), ...value }; messages.push(row); return row; } },
  };
  return { models, contacts, conversations, messages };
}

const value = { metadata: { phone_number_id: '2000000000000001' }, contacts: [{ wa_id: '919876543210', profile: { name: 'Customer' } }] };
const inbound = (id: string, text = 'Hello') => ({ id, from: '919876543210', timestamp: '1790380800', type: 'text', text: { body: text } });

describe('WhatsApp Inbox migration', () => {
  it('maps supported inbound content safely', () => {
    expect(inboundContent(inbound('wamid.one'))).toMatchObject({ messageType: 'TEXT', text: 'Hello' });
    expect(inboundContent({ type: 'image', image: { id: '123', caption: 'Photo' } })).toMatchObject({ messageType: 'IMAGE', text: 'Photo' });
  });

  it('creates an UNKNOWN-consent contact, conversation, message and unread count', async () => {
    const store = memoryModels();
    const result = await persistInboundMessage({ wabaId: '1000000000000001', value, message: inbound('wamid.inbound-one'), models: store.models as never });
    expect(result.outcome).toBe('created'); expect(store.contacts[0]).toMatchObject({ workspaceId: W1, whatsappConsent: { status: 'UNKNOWN' } }); expect(store.messages[0]).toMatchObject({ direction: 'INBOUND', status: 'RECEIVED', sendSource: 'INBOX' }); expect(store.conversations[0].unreadCount).toBe(1);
  });

  it('is idempotent by Meta message ID and does not increment unread twice', async () => {
    const store = memoryModels(); const message = inbound('wamid.duplicate');
    await persistInboundMessage({ wabaId: '1000000000000001', value, message, models: store.models as never });
    const duplicate = await persistInboundMessage({ wabaId: '1000000000000001', value, message, models: store.models as never });
    expect(duplicate.outcome).toBe('duplicate'); expect(store.messages).toHaveLength(1); expect(store.conversations[0].unreadCount).toBe(1);
  });

  it('reuses the conversation for subsequent inbound messages', async () => {
    const store = memoryModels();
    const first = await persistInboundMessage({ wabaId: '1000000000000001', value, message: inbound('wamid.first'), models: store.models as never });
    const second = await persistInboundMessage({ wabaId: '1000000000000001', value, message: inbound('wamid.second'), models: store.models as never });
    expect(second.conversationId).toBe(first.conversationId); expect(store.conversations).toHaveLength(1); expect(store.conversations[0].unreadCount).toBe(2);
  });

  it('enforces the 24-hour customer-service window', () => {
    const now = Date.now(); expect(isServiceWindowOpen(new Date(now - 23 * 60 * 60 * 1_000), now)).toBe(true); expect(isServiceWindowOpen(new Date(now - 25 * 60 * 60 * 1_000), now)).toBe(false); expect(isServiceWindowOpen(undefined, now)).toBe(false);
  });

  it('fails closed when live transport is disabled', () => {
    const live = env.CAMPAIGN_LIVE_SEND_ENABLED; const transport = env.CAMPAIGN_TRANSPORT;
    try { env.CAMPAIGN_LIVE_SEND_ENABLED = 'false'; env.CAMPAIGN_TRANSPORT = 'meta'; expect(() => assertInboxLiveSendEnabled()).toThrowError(expect.objectContaining({ code: 'LIVE_SEND_DISABLED' })); env.CAMPAIGN_LIVE_SEND_ENABLED = 'true'; env.CAMPAIGN_TRANSPORT = 'disabled'; expect(() => assertInboxLiveSendEnabled()).toThrowError(expect.objectContaining({ code: 'TRANSPORT_NOT_CONFIGURED' })); } finally { env.CAMPAIGN_LIVE_SEND_ENABLED = live; env.CAMPAIGN_TRANSPORT = transport; }
  });

  it('persists a mocked accepted Inbox reply and returned wamid', async () => {
    vi.spyOn(WhatsAppPhoneNumber, 'findOne').mockReturnValue({ lean: async () => ({ _id: P1, phoneNumberId: '2000000000000001' }) } as never);
    const persist = vi.spyOn(WhatsAppMessage, 'findOneAndUpdate').mockResolvedValue({ _id: oid(9), conversationId: V1, metaMessageId: 'wamid.outbound-inbox', status: 'ACCEPTED' } as never);
    vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue({ _id: V1, workspaceId: W1 } as never);
    const dependency = vi.fn().mockResolvedValue({ messages: [{ id: 'wamid.outbound-inbox', message_status: 'accepted' }] });
    await sendInboxReply({ workspaceId: W1, accountId: A1, accessToken: 'test-only', conversation: { _id: V1, phoneNumberId: '2000000000000001', customerPhone: '+919876543210', contactId: C1 }, text: 'Reply', dependency });
    expect(dependency).toHaveBeenCalledWith('2000000000000001', 'test-only', expect.objectContaining({ to: '919876543210', type: 'text' })); expect(persist.mock.calls[0]?.[1]).toMatchObject({ $setOnInsert: { sendSource: 'INBOX', status: 'ACCEPTED' } });
  });

  it('rejects empty outbound reply text before a provider call', async () => {
    const dependency = vi.fn(); await expect(sendInboxReply({ workspaceId: W1, accountId: A1, accessToken: 'test', conversation: { _id: V1, phoneNumberId: '1', customerPhone: '+919876543210' }, text: ' ', dependency })).rejects.toMatchObject({ code: 'INVALID_REPLY' }); expect(dependency).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace message history', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: A1 } } as never);
    vi.spyOn(Conversation, 'findOne').mockReturnValue({ lean: async () => null } as never);
    await expect(invoke(listConversationMessages, { workspaceContext: { workspaceId: W2 }, params: { id: V1 }, query: {} })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    expect(Conversation.findOne).toHaveBeenCalledWith({ _id: V1, workspaceId: W2, whatsappAccountId: A1 });
  });

  it('marks read only inside the resolved workspace', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: A1 } } as never);
    const update = vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue({ _id: V1, status: 'OPEN', lastMessageAt: new Date(), unreadCount: 0, toObject() { return this; } } as never);
    const response = await invoke(markConversationRead, { workspaceContext: { workspaceId: W1 }, params: { id: V1 }, query: {} });
    expect(response.body).toMatchObject({ success: true, data: { unreadCount: 0 } }); expect(update.mock.calls[0]?.[0]).toEqual({ _id: V1, workspaceId: W1, whatsappAccountId: A1 });
  });

  it('uses stable conversation cursors', () => {
    const row = { _id: V1, lastMessageAt: new Date('2026-09-29T10:00:00.000Z') }; expect(decodeConversationCursor(encodeConversationCursor(row))).toEqual({ id: V1, at: row.lastMessageAt }); expect(decodeConversationCursor('invalid')).toBeNull();
  });

  it.each([['ACCEPTED', 'SENT'], ['SENT', 'DELIVERED'], ['DELIVERED', 'READ'], ['SENT', 'FAILED']])('preserves webhook status progression %s to %s', (current, incoming) => { expect(webhookTestables.canAdvanceMessage(current, incoming as never)).toBe(true); });
});
