import type { Types } from 'mongoose';
import { MetaConnection } from '../../models/meta-connection.model.js';
import { MetaCredential } from '../../models/meta-credential.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';
import { normalizeWhatsAppPhone } from '../broadcast/phone.js';
import { decryptMetaCredential } from './credential-encryption.js';
import { configuredWhatsAppTransport, type WhatsAppTransport } from './transport.js';

interface SendApprovedTemplateInput {
  workspaceId: Types.ObjectId | string;
  whatsappAccountId: Types.ObjectId | string;
  phoneNumberId: string;
  templateRecordId: Types.ObjectId | string;
  recipient: string;
  bodyVariables?: string[];
  headerVariables?: string[];
  buttonVariables?: Record<string, string>;
  media?: { type?: unknown; source?: unknown; value?: unknown; fileName?: unknown };
  sendSource?: 'TEST' | 'CAMPAIGN' | 'API_CAMPAIGN';
  campaignId?: Types.ObjectId | string;
  campaignRecipientId?: Types.ObjectId | string;
  retryRecipientId?: Types.ObjectId | string;
  apiCampaignExecutionId?: Types.ObjectId | string;
  apiCampaignRetryExecutionId?: Types.ObjectId | string;
  apiCampaignRetrySequence?: number;
  onProviderSubmit?: () => void;
}

function variableCount(text: unknown, label: string) {
  const placeholders = [...String(text ?? '').matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  if (placeholders.some((value) => !/^\d+$/.test(value!))) throw new AppError(409, 'UNSUPPORTED_TEMPLATE_PARAMETERS', `${label} uses an unsupported variable format.`);
  const numbers = [...new Set(placeholders.map(Number))].sort((a, b) => a - b);
  if (numbers.some((number, index) => number !== index + 1)) throw new AppError(409, 'UNSUPPORTED_TEMPLATE_PARAMETERS', `${label} variables are not sequential.`);
  return numbers.length;
}

function exactVariables(value: unknown, count: number, label: string) {
  const values = cleanVariables(value, label);
  if (values.length !== count) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', `${label} requires exactly ${count} value${count === 1 ? '' : 's'}.`);
  return values;
}

export function buildTemplatePayload(input: {
  template: { name: string; language: string; components?: unknown[] };
  recipient: string;
  bodyVariables?: string[];
  headerVariables?: string[];
  buttonVariables?: Record<string, string>;
  media?: { type?: unknown; source?: unknown; value?: unknown; fileName?: unknown };
}) {
  const components = Array.isArray(input.template.components) ? input.template.components as Array<Record<string, unknown>> : [];
  const outgoing: Array<Record<string, unknown>> = [];
  const header = components.find((item) => item.type === 'HEADER');
  const headerType = String(header?.format ?? 'NONE').toUpperCase();
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType)) {
    const source = String(input.media?.source ?? '').toUpperCase();
    const value = typeof input.media?.value === 'string' ? input.media.value.trim() : '';
    if (String(input.media?.type ?? '').toUpperCase() !== headerType || !['LINK', 'ID'].includes(source) || !value) throw new AppError(400, 'INVALID_TEMPLATE_MEDIA', `${headerType} templates require matching send-time media.`);
    if (source === 'LINK') {
      try { if (new URL(value).protocol !== 'https:') throw new Error(); } catch { throw new AppError(400, 'INVALID_TEMPLATE_MEDIA', 'Media links must use public HTTPS URLs.'); }
    } else if (!/^\d{1,64}$/.test(value)) throw new AppError(400, 'INVALID_TEMPLATE_MEDIA', 'Meta media ID is invalid.');
    const mediaValue: Record<string, unknown> = { [source.toLowerCase()]: value };
    if (headerType === 'DOCUMENT' && input.media?.fileName) mediaValue.filename = String(input.media.fileName).slice(0, 240);
    outgoing.push({ type: 'header', parameters: [{ type: headerType.toLowerCase(), [headerType.toLowerCase()]: mediaValue }] });
  } else if (headerType === 'TEXT') {
    const values = exactVariables(input.headerVariables, variableCount(header?.text, 'Template header'), 'Header variables');
    if (values.length) outgoing.push({ type: 'header', parameters: values.map((text) => ({ type: 'text', text })) });
  } else if (input.media !== undefined) throw new AppError(400, 'INVALID_TEMPLATE_MEDIA', 'This template does not accept send-time media.');
  const body = components.find((item) => item.type === 'BODY');
  if (!body || typeof body.text !== 'string') throw new AppError(409, 'INVALID_TEMPLATE', 'Template body is missing.');
  const bodyValues = exactVariables(input.bodyVariables, variableCount(body.text, 'Template body'), 'Body variables');
  if (bodyValues.length) outgoing.push({ type: 'body', parameters: bodyValues.map((text) => ({ type: 'text', text })) });
  const suppliedButtons = input.buttonVariables ?? {};
  const expected = new Set<string>();
  const buttons = components.find((item) => item.type === 'BUTTONS')?.buttons;
  if (Array.isArray(buttons)) buttons.forEach((raw, index) => {
    const button = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (button.type !== 'URL' || !String(button.url ?? '').includes('{{')) return;
    const key = String(index); expected.add(key);
    const value = suppliedButtons[key];
    if (typeof value !== 'string' || !value.trim() || value.length > 2_000) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', `Button ${index + 1} requires a URL value.`);
    outgoing.push({ type: 'button', sub_type: 'url', index: key, parameters: [{ type: 'text', text: value.trim() }] });
  });
  if (Object.keys(suppliedButtons).some((key) => !expected.has(key))) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', 'Unexpected button values were supplied.');
  return {
    payload: { messaging_product: 'whatsapp', to: input.recipient, type: 'template', template: { name: input.template.name, language: { code: input.template.language }, ...(outgoing.length ? { components: outgoing } : {}) } },
    summary: { bodyVariableCount: bodyValues.length, headerType, mediaReferenceType: input.media ? String(input.media.source).toUpperCase() : undefined },
  };
}

function cleanVariables(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', `${label} must be a bounded array.`);
  return value.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim() || entry.length > 1_024) {
      throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', `${label} values must be non-empty strings.`);
    }
    return entry.trim();
  });
}

export async function sendApprovedTemplateMessage(
  input: SendApprovedTemplateInput,
  transport: WhatsAppTransport = configuredWhatsAppTransport(),
) {
  const recipient = normalizeWhatsAppPhone(input.recipient).slice(1);
  const account = await WhatsAppAccount.findOne({ _id: input.whatsappAccountId, workspaceId: input.workspaceId, status: 'CONNECTED' }).lean();
  if (!account) throw new AppError(409, 'WHATSAPP_ACCOUNT_UNAVAILABLE', 'Campaign WhatsApp account is unavailable.');
  const connection = await MetaConnection.findOne({ _id: account.connectionId, workspaceId: input.workspaceId, provider: 'meta', status: 'CONNECTED' }).lean();
  if (!connection) throw new AppError(409, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp is not connected.');
  const phone = await WhatsAppPhoneNumber.findOne({ workspaceId: input.workspaceId, whatsappAccountId: account._id, phoneNumberId: input.phoneNumberId }).lean();
  if (!phone) throw new AppError(409, 'PHONE_UNAVAILABLE', 'Campaign sending phone is unavailable.');
  if (!['CONNECTED', 'REGISTERED'].includes(String(phone.registrationStatus ?? '').toUpperCase()) || String(phone.codeVerificationStatus ?? '').toUpperCase() !== 'VERIFIED') throw new AppError(409, 'PHONE_NOT_READY', 'Campaign sending phone is not verified and available for Cloud API sending.');
  const template = await WhatsAppTemplate.findOne({
    _id: input.templateRecordId,
    workspaceId: input.workspaceId,
    whatsappAccountId: account._id,
    status: 'APPROVED',
    isActive: true,
  }).lean();
  if (!template) throw new AppError(409, 'TEMPLATE_UNAVAILABLE', 'Campaign template is not approved or available.');
  let accessToken: string | undefined;
  if (transport.requiresCredential) {
    const credential = await MetaCredential.findOne({ workspaceId: input.workspaceId, connectionId: connection._id })
      .select('+encryptedAccessToken.iv +encryptedAccessToken.authTag +encryptedAccessToken.ciphertext').lean();
    if (!credential || (credential.expiresAt && credential.expiresAt.getTime() <= Date.now())) {
      throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is missing or expired.');
    }
    accessToken = decryptMetaCredential(credential.encryptedAccessToken);
  }
  const built = buildTemplatePayload({ template, recipient, ...(input.bodyVariables ? { bodyVariables: input.bodyVariables } : {}), ...(input.headerVariables ? { headerVariables: input.headerVariables } : {}), ...(input.buttonVariables ? { buttonVariables: input.buttonVariables } : {}), ...(input.media ? { media: input.media } : {}) });
  input.onProviderSubmit?.();
  const result = await transport.sendTemplate({
    phoneNumberId: phone.phoneNumberId,
    payload: built.payload,
    ...(accessToken ? { accessToken } : {}),
  });
  if (!/^wamid\.[A-Za-z0-9+/_=.-]{1,512}$/.test(result.messageId)) {
    throw new AppError(502, 'INVALID_PROVIDER_RESPONSE', 'WhatsApp transport returned an invalid message identifier.');
  }
  const acceptedAt = new Date();
  const message = await WhatsAppMessage.findOneAndUpdate(
    { workspaceId: input.workspaceId, whatsappAccountId: account._id, metaMessageId: result.messageId },
    { $setOnInsert: {
      workspaceId: input.workspaceId,
      whatsappAccountId: account._id,
      phoneNumberId: phone.phoneNumberId,
      direction: 'OUTBOUND',
      recipient,
      templateId: template._id,
      metaTemplateId: template.metaTemplateId,
      templateName: template.name,
      language: template.language,
      metaMessageId: result.messageId,
      status: 'ACCEPTED',
      metaResponseStatus: result.responseStatus,
      sendSource: input.sendSource ?? 'CAMPAIGN',
      ...(input.campaignId ? { campaignId: input.campaignId } : {}),
      ...(input.campaignRecipientId ? { campaignRecipientId: input.campaignRecipientId } : {}),
      ...(input.retryRecipientId ? { retryRecipientId: input.retryRecipientId } : {}),
      ...(input.apiCampaignExecutionId ? { apiCampaignExecutionId: input.apiCampaignExecutionId } : {}),
      ...(input.apiCampaignRetryExecutionId ? { apiCampaignRetryExecutionId: input.apiCampaignRetryExecutionId } : {}),
      ...(input.apiCampaignRetrySequence ? { apiCampaignRetrySequence: input.apiCampaignRetrySequence } : {}),
      ...built.summary,
      acceptedAt,
    } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return { recordId: String(message._id), messageId: message.metaMessageId, acceptedAt: message.acceptedAt ?? acceptedAt };
}
