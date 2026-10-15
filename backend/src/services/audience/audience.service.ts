import mongoose, { type Types } from 'mongoose';
import { Campaign } from '../../models/campaign.model.js';
import { Contact } from '../../models/contact.model.js';
import { Segment } from '../../models/segment.model.js';
import { AppError } from '../../utils/app-error.js';
import { segmentFilter } from '../broadcast/audience.service.js';
import { normalizeWhatsAppPhone } from '../broadcast/phone.js';

export const consentStatuses = ['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'] as const;
export const contactStatuses = ['ACTIVE', 'BLOCKED', 'DELETED'] as const;
export const segmentFields = ['tags', 'status', 'source', 'whatsappConsent.status', 'attributes.lifecycleStage', 'attributes.leadScore', 'attributes.ecommerceData.totalSpend', 'attributes.ecommerceData.totalOrders', 'attributes.saasData.plan', 'attributes.saasData.mrr'] as const;
export const segmentOperators = ['CONTAINS', 'NOT_CONTAINS', 'EQ', 'NE', 'GT', 'LT'] as const;
export const nonTerminalCampaignStatuses = ['DRAFT', 'SNAPSHOTTING', 'READY', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PAUSED'] as const;

function cleanText(value: unknown, label: string, max: number, required = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (required && !text) throw new AppError(400, 'INVALID_AUDIENCE_INPUT', `${label} is required.`);
  if (text.length > max) throw new AppError(400, 'INVALID_AUDIENCE_INPUT', `${label} is too long.`);
  return text;
}

export function cleanTags(value: unknown) {
  if (value !== undefined && !Array.isArray(value)) throw new AppError(400, 'INVALID_TAGS', 'Tags must be an array.');
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const tag = cleanText(raw, 'Tag', 80);
    const key = tag.toLocaleLowerCase();
    if (tag && !seen.has(key)) { seen.add(key); tags.push(tag); }
  }
  return tags.slice(0, 50);
}

const forbiddenAttributeKey = /^(?:__proto__|prototype|constructor|password|secret|token|credential)$/i;

function validateAttributeValue(value: unknown, depth = 0): void {
  if (depth > 6) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes are too deeply nested.');
  if (Array.isArray(value)) {
    if (value.length > 100) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attribute arrays are too large.');
    value.forEach((item) => validateAttributeValue(item, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes must be plain JSON values.');
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/.test(key) || forbiddenAttributeKey.test(key)) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes contain an unsafe key.');
      validateAttributeValue(item, depth + 1);
    }
    return;
  }
  if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes must contain JSON values.');
}

export function cleanAttributes(value: unknown) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes must be a small object.');
  if (JSON.stringify(value).length > 20_000) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Contact attributes must be a small object.');
  validateAttributeValue(value);
  return value as Record<string, unknown>;
}

export function cleanConsent(value: unknown) {
  if (typeof value === 'boolean') return { status: value ? 'OPTED_IN' as const : 'UNKNOWN' as const };
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status = String(source.status ?? 'UNKNOWN').toUpperCase();
  if (!consentStatuses.includes(status as typeof consentStatuses[number])) throw new AppError(400, 'INVALID_CONSENT', 'Invalid WhatsApp consent status.');
  let timestamp: Date | undefined;
  if (source.timestamp !== undefined && source.timestamp !== '') {
    timestamp = new Date(String(source.timestamp));
    if (Number.isNaN(timestamp.getTime())) throw new AppError(400, 'INVALID_CONSENT', 'Consent timestamp is invalid.');
  }
  const consentSource = cleanText(source.source, 'Consent source', 120);
  const evidence = cleanText(source.evidence, 'Consent evidence', 500);
  return { status: status as typeof consentStatuses[number], ...(timestamp ? { timestamp } : {}), ...(consentSource ? { source: consentSource } : {}), ...(evidence ? { evidence } : {}), ...(status === 'OPTED_IN' && mongoose.isValidObjectId(source.accountId) ? { accountId: source.accountId as string } : {}) };
}

export function contactCreatePayload(body: Record<string, unknown>) {
  const email = cleanText(body.email, 'Email', 254).toLowerCase();
  return {
    name: cleanText(body.name, 'Contact name', 160, true),
    phoneE164: normalizeWhatsAppPhone(body.phoneE164 ?? body.phone),
    ...(email ? { email } : {}),
    tags: cleanTags(body.tags),
    attributes: cleanAttributes(body.attributes ?? body.customAttributes),
    source: cleanText(body.source, 'Source', 120) || 'MANUAL',
    whatsappConsent: cleanConsent(body.whatsappConsent),
  };
}

export function contactUpdatePayload(body: Record<string, unknown>) {
  if ('workspaceId' in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'workspaceId is server-controlled.');
  const update: Record<string, unknown> = {};
  if ('name' in body) update.name = cleanText(body.name, 'Contact name', 160, true);
  if ('phoneE164' in body || 'phone' in body) update.phoneE164 = normalizeWhatsAppPhone(body.phoneE164 ?? body.phone);
  if ('email' in body) update.email = cleanText(body.email, 'Email', 254).toLowerCase() || undefined;
  if ('tags' in body) update.tags = cleanTags(body.tags);
  if ('attributes' in body || 'customAttributes' in body) update.attributes = cleanAttributes(body.attributes ?? body.customAttributes);
  if ('source' in body) update.source = cleanText(body.source, 'Source', 120) || 'MANUAL';
  if ('whatsappConsent' in body) update.whatsappConsent = cleanConsent(body.whatsappConsent);
  if ('status' in body) {
    const status = String(body.status).toUpperCase();
    if (!['ACTIVE', 'BLOCKED'].includes(status)) throw new AppError(400, 'INVALID_CONTACT_STATUS', 'Invalid contact status.');
    update.status = status;
  }
  if (!Object.keys(update).length) throw new AppError(400, 'EMPTY_UPDATE', 'Provide at least one contact field to update.');
  return update;
}

export function restoreUpdate(body: Record<string, unknown>, payload: ReturnType<typeof contactCreatePayload>) {
  const update: Record<string, unknown> = { name: payload.name, status: 'ACTIVE' };
  if ('email' in body) update.email = payload.email;
  if ('tags' in body) update.tags = payload.tags;
  if ('attributes' in body || 'customAttributes' in body) update.attributes = payload.attributes;
  if ('source' in body) update.source = payload.source;
  if ('whatsappConsent' in body && payload.whatsappConsent.status !== 'UNKNOWN') update.whatsappConsent = payload.whatsappConsent;
  return update;
}

export async function createOrRestoreContact(workspaceId: Types.ObjectId | string, body: Record<string, unknown>) {
  const payload = contactCreatePayload(body);
  const update = restoreUpdate(body, payload);
  const restored = await Contact.findOneAndUpdate(
    { workspaceId, phoneE164: payload.phoneE164, status: 'DELETED' },
    { $set: update, ...(update.whatsappConsent && (update.whatsappConsent as { status: string }).status === 'OPTED_IN' ? { $unset: { optedOutAt: 1 } } : {}) },
    { new: true, runValidators: true },
  );
  if (restored) return { contact: restored, restored: true };
  try {
    return { contact: await Contact.create({ workspaceId, ...payload, ...(payload.whatsappConsent.status === 'OPTED_OUT' ? { optedOutAt: payload.whatsappConsent.timestamp ?? new Date() } : {}) }), restored: false };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const raced = await Contact.findOneAndUpdate({ workspaceId, phoneE164: payload.phoneE164, status: 'DELETED' }, { $set: update }, { new: true, runValidators: true });
    if (raced) return { contact: raced, restored: true };
    throw new AppError(409, 'DUPLICATE_CONTACT', 'A contact with this phone number already exists in this workspace.');
  }
}

export function parseSegmentDefinition(body: Record<string, unknown>) {
  const raw = body.definition && typeof body.definition === 'object' && !Array.isArray(body.definition) ? body.definition as Record<string, unknown> : {};
  const match = String(raw.match ?? 'ALL').toUpperCase();
  const conditions = Array.isArray(raw.conditions) ? raw.conditions : [];
  if (!['ALL', 'ANY'].includes(match) || conditions.length > 50) throw new AppError(400, 'INVALID_SEGMENT', 'Invalid segment definition.');
  const normalized = conditions.map((entry) => {
    const condition = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry as Record<string, unknown> : {};
    const field = String(condition.field ?? '');
    const operator = String(condition.operator ?? '').toUpperCase();
    if (!segmentFields.includes(field as typeof segmentFields[number]) || !segmentOperators.includes(operator as typeof segmentOperators[number]) || condition.value === undefined) throw new AppError(400, 'INVALID_SEGMENT', 'Segment contains an unsupported condition.');
    validateAttributeValue(condition.value);
    return { field, operator, value: condition.value };
  });
  return { match: match as 'ALL' | 'ANY', conditions: normalized };
}

export async function segmentPayload(workspaceId: Types.ObjectId | string, body: Record<string, unknown>) {
  if ('workspaceId' in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'workspaceId is server-controlled.');
  const name = cleanText(body.name, 'Segment name', 160, true);
  const type = String(body.type ?? 'DYNAMIC').toUpperCase();
  if (!['STATIC', 'DYNAMIC'].includes(type)) throw new AppError(400, 'INVALID_SEGMENT', 'Invalid segment type.');
  const definition = parseSegmentDefinition(body);
  const estimatedCount = await Contact.countDocuments({ workspaceId, status: 'ACTIVE', ...segmentFilter(definition) });
  return { name, type: type as 'STATIC' | 'DYNAMIC', definition, estimatedCount };
}

export async function deleteSegmentSafely(workspaceId: Types.ObjectId | string, segmentId: string) {
  const existing = await Segment.findOne({ _id: segmentId, workspaceId }).lean();
  if (!existing) throw new AppError(404, 'SEGMENT_NOT_FOUND', 'Segment was not found.');
  const inUse = await Campaign.exists({ workspaceId, 'audienceDefinition.source': 'SEGMENT', 'audienceDefinition.segmentId': existing._id, status: { $in: nonTerminalCampaignStatuses } });
  if (inUse) throw new AppError(409, 'SEGMENT_IN_USE', 'Segment is used by a draft or active campaign and cannot be deleted.');
  const deleted = await Segment.findOneAndDelete({ _id: existing._id, workspaceId });
  if (!deleted) throw new AppError(404, 'SEGMENT_NOT_FOUND', 'Segment was not found.');
  return deleted;
}
