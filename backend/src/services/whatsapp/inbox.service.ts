import type { Types } from 'mongoose';
import { Contact } from '../../models/contact.model.js';
import { Conversation } from '../../models/conversation.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { AppError } from '../../utils/app-error.js';
import { normalizeWhatsAppPhone } from '../broadcast/phone.js';
import { sendTextMessage } from './meta-graph.service.js';

export function safeInboxText(value: unknown, max = 4_096) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '';
}
function inboundTime(value: unknown) { const seconds = Number(value); const date = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000) : new Date(); return Number.isNaN(date.getTime()) ? new Date() : date; }
export function inboundContent(message: Record<string, unknown>) {
  const type = String(message.type ?? 'unknown').toUpperCase();
  if (type === 'TEXT') {
    const textRoot = message.text && typeof message.text === 'object' ? message.text as Record<string, unknown> : {};
    const text = safeInboxText(textRoot.body);
    return text ? { messageType: 'TEXT', text, preview: text.slice(0, 240) } : null;
  }
  const supported = ['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO', 'LOCATION', 'CONTACTS'];
  const messageType = supported.includes(type) ? type : 'UNKNOWN';
  const key = String(message.type ?? '').toLowerCase();
  const source = message[key] && typeof message[key] === 'object' ? message[key] as Record<string, unknown> : {};
  const mediaMetadata = { ...(safeInboxText(source.id, 128) ? { id: safeInboxText(source.id, 128) } : {}), ...(safeInboxText(source.mime_type, 120) ? { mimeType: safeInboxText(source.mime_type, 120) } : {}), ...(safeInboxText(source.filename, 240) ? { fileName: safeInboxText(source.filename, 240) } : {}), ...(safeInboxText(source.caption, 1_024) ? { caption: safeInboxText(source.caption, 1_024) } : {}) };
  const caption = 'caption' in mediaMetadata ? String(mediaMetadata.caption) : '';
  return { messageType, ...(caption ? { text: caption } : {}), mediaMetadata, preview: `[${messageType}]${caption ? ` ${caption}` : ''}`.slice(0, 240) };
}

interface InboxModels { Contact: any; Conversation: any; WhatsAppMessage: any; WhatsAppPhoneNumber: any; WhatsAppAccount: any; }
const defaultModels: InboxModels = { Contact, Conversation, WhatsAppMessage, WhatsAppPhoneNumber, WhatsAppAccount };

export async function persistInboundMessage(input: { wabaId: string; value: Record<string, unknown>; message: Record<string, unknown>; models?: InboxModels }) {
  const models = input.models ?? defaultModels;
  const metaMessageId = safeInboxText(input.message.id, 600);
  if (!/^wamid\.[A-Za-z0-9+/_=-]{1,512}$/.test(metaMessageId)) return { outcome: 'ignored' as const };
  const metadata = input.value.metadata && typeof input.value.metadata === 'object' ? input.value.metadata as Record<string, unknown> : {};
  const phoneNumberId = String(metadata.phone_number_id ?? '').trim();
  if (!/^\d{1,64}$/.test(phoneNumberId)) return { outcome: 'ignored' as const };
  const phones = await models.WhatsAppPhoneNumber.find({ phoneNumberId }).limit(2).lean();
  if (phones.length !== 1) return { outcome: 'unmatched' as const };
  const phone = phones[0]!;
  const account = await models.WhatsAppAccount.findOne({ _id: phone.whatsappAccountId, workspaceId: phone.workspaceId, wabaId: input.wabaId }).lean();
  if (!account) return { outcome: 'unmatched' as const };
  let customerPhone: string;
  try { customerPhone = normalizeWhatsAppPhone(`+${String(input.message.from ?? '').replace(/^\+/, '')}`); } catch { return { outcome: 'ignored' as const }; }
  const content = inboundContent(input.message);
  if (!content) return { outcome: 'ignored' as const };
  const contacts = Array.isArray(input.value.contacts) ? input.value.contacts : [];
  const profile = contacts.find((raw) => raw && typeof raw === 'object' && String((raw as Record<string, unknown>).wa_id ?? '') === String(input.message.from ?? '')) as Record<string, unknown> | undefined;
  const profileValue = profile?.profile && typeof profile.profile === 'object' ? profile.profile as Record<string, unknown> : {};
  const customerName = safeInboxText(profileValue.name, 160);
  let contact = await models.Contact.findOne({ workspaceId: phone.workspaceId, phoneE164: customerPhone }).lean();
  if (!contact) {
    try { contact = await models.Contact.create({ workspaceId: phone.workspaceId, name: customerName || customerPhone, phoneE164: customerPhone, status: 'ACTIVE', source: 'WHATSAPP_INBOUND', whatsappConsent: { status: 'UNKNOWN' } }) as never; }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; contact = await models.Contact.findOne({ workspaceId: phone.workspaceId, phoneE164: customerPhone }).lean(); }
  }
  if (contact?.status === 'DELETED') contact = null;
  const identity = { workspaceId: phone.workspaceId, whatsappAccountId: account._id, phoneNumberId, customerPhone };
  let conversation;
  try {
    conversation = await models.Conversation.findOneAndUpdate(identity, { $setOnInsert: { ...identity, whatsappPhoneNumberId: phone._id, status: 'OPEN', unreadCount: 0, lastMessageAt: inboundTime(input.message.timestamp) }, $set: { ...(contact?._id ? { contactId: contact._id } : {}), ...(customerName ? { customerName } : {}) } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  } catch (error) { if ((error as { code?: number }).code !== 11000) throw error; conversation = await models.Conversation.findOne(identity); }
  if (!conversation) throw new AppError(500, 'INBOX_CONVERSATION_FAILED', 'Inbound conversation could not be resolved.');
  const receivedAt = inboundTime(input.message.timestamp);
  let persisted;
  try {
    const context = input.message.context && typeof input.message.context === 'object' ? input.message.context as Record<string, unknown> : {};
    persisted = await models.WhatsAppMessage.create({ workspaceId: phone.workspaceId, whatsappAccountId: account._id, phoneNumberId, conversationId: conversation._id, ...(contact?._id ? { contactId: contact._id } : {}), direction: 'INBOUND', recipient: customerPhone, metaMessageId, status: 'RECEIVED', sendSource: 'INBOX', messageType: content.messageType, ...(content.text ? { text: content.text } : {}), ...('mediaMetadata' in content && content.mediaMetadata ? { mediaMetadata: content.mediaMetadata } : {}), ...(context.id ? { contextMetaMessageId: safeInboxText(context.id, 600) } : {}), receivedAt });
  } catch (error) { if ((error as { code?: number }).code === 11000) return { outcome: 'duplicate' as const, conversationId: String(conversation._id) }; throw error; }
  await models.Conversation.updateOne({ _id: conversation._id, workspaceId: phone.workspaceId }, { $set: { status: 'OPEN', lastInboundAt: receivedAt, lastMessageAt: receivedAt, lastMessagePreview: content.preview }, $inc: { unreadCount: 1 } });
  return { outcome: 'created' as const, conversationId: String(conversation._id), messageId: String(persisted._id) };
}

export function isServiceWindowOpen(lastInboundAt: Date | string | null | undefined, now = Date.now()) {
  if (!lastInboundAt) return false;
  const time = new Date(lastInboundAt).getTime();
  return Number.isFinite(time) && now - time <= 24 * 60 * 60 * 1_000;
}

export async function sendInboxReply(input: { workspaceId: Types.ObjectId | string; conversation: { _id: Types.ObjectId | string; phoneNumberId: string; customerPhone: string; contactId?: Types.ObjectId | string }; accountId: Types.ObjectId | string; accessToken: string; text: unknown; dependency?: typeof sendTextMessage }) {
  const text = safeInboxText(input.text);
  if (!text || text.length > 4_096) throw new AppError(400, 'INVALID_REPLY', 'Reply text must be between 1 and 4096 characters.');
  const phone = await WhatsAppPhoneNumber.findOne({ workspaceId: input.workspaceId, whatsappAccountId: input.accountId, phoneNumberId: input.conversation.phoneNumberId }).lean();
  if (!phone) throw new AppError(409, 'PHONE_UNAVAILABLE', 'Conversation sending phone is unavailable.');
  const recipient = normalizeWhatsAppPhone(input.conversation.customerPhone).slice(1);
  const result = await (input.dependency ?? sendTextMessage)(phone.phoneNumberId, input.accessToken, { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { preview_url: false, body: text } });
  const metaMessageId = result.messages?.[0]?.id;
  if (!metaMessageId || !/^wamid\.[A-Za-z0-9+/_=.-]{1,512}$/.test(metaMessageId)) throw new AppError(502, 'INVALID_PROVIDER_RESPONSE', 'Meta accepted the request without a valid message identifier.');
  const acceptedAt = new Date();
  const message = await WhatsAppMessage.findOneAndUpdate({ workspaceId: input.workspaceId, whatsappAccountId: input.accountId, metaMessageId }, { $setOnInsert: { workspaceId: input.workspaceId, whatsappAccountId: input.accountId, phoneNumberId: phone.phoneNumberId, conversationId: input.conversation._id, ...(input.conversation.contactId ? { contactId: input.conversation.contactId } : {}), direction: 'OUTBOUND', recipient: String(input.conversation.customerPhone), messageType: 'TEXT', text, metaMessageId, status: 'ACCEPTED', ...(result.messages?.[0]?.message_status ? { metaResponseStatus: result.messages[0].message_status } : {}), sendSource: 'INBOX', acceptedAt } }, { upsert: true, new: true, setDefaultsOnInsert: true });
  const conversation = await Conversation.findOneAndUpdate({ _id: input.conversation._id, workspaceId: input.workspaceId }, { $set: { lastMessageAt: acceptedAt, lastMessagePreview: text } }, { new: true });
  if (!message || !conversation) throw new AppError(500, 'INBOX_PERSISTENCE_FAILED', 'The accepted reply could not be persisted.');
  return { message, conversation };
}
