import { createHash } from 'node:crypto';
import mongoose, { type Types } from 'mongoose';
import { env } from '../../config/env.js';
import { Campaign } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { Contact } from '../../models/contact.model.js';
import { Segment } from '../../models/segment.model.js';
import { AppError } from '../../utils/app-error.js';
import { canBypassCampaignConsent, logConsentBypass } from './consent.service.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';
import { resolveParameterMapping, validateParameterMapping, type ParameterMapping, type ContactParameterContext, ParameterResolutionError } from './parameter-mapping.service.js';

export type AudienceDefinition =
  | { source: 'CONTACTS'; contactIds: string[] }
  | { source: 'SEGMENT'; segmentId: string }
  | { source: 'PASTED'; phones: string[] }
  | { source: 'RETARGET'; sourceCampaignId: string };

export interface CampaignAudienceSource {
  _id: Types.ObjectId | string;
  workspaceId: Types.ObjectId | string;
  whatsappAccountId?: Types.ObjectId | string;
  audienceDefinition?: AudienceDefinition;
  parameterMapping?: Record<string, unknown>;
  mediaMapping?: Record<string, unknown>;
  templateSnapshot?: { components?: unknown[] };
}

interface ContactSource {
  _id: Types.ObjectId | string;
  name: string;
  phoneE164: string;
  email?: string;
  tags?: string[];
  attributes?: Record<string, unknown>;
  status: string;
  whatsappConsent?: { status: string; accountId?: Types.ObjectId | string; timestamp?: Date; source?: string; evidence?: string };
}

export function recipientKey(campaignId: string, identity: string) {
  return createHash('sha256').update(`${campaignId}|${identity}`).digest('hex');
}

export function createContactRecipient(campaign: CampaignAudienceSource, contact: ContactSource, mapping?: ParameterMapping) {
  const campaignId = String(campaign._id);
  let phone: string;
  let failure: { code: string; message: string } | undefined;
  try {
    phone = normalizeWhatsAppPhone(contact.phoneE164);
  } catch {
    phone = contact.phoneE164.trim() || `invalid-${String(contact._id)}`;
    failure = { code: 'INVALID_PHONE', message: 'Contact phone is not valid E.164.' };
  }
  if (contact.status !== 'ACTIVE') failure = { code: 'CONTACT_INACTIVE', message: 'Contact is blocked or deleted.' };
  const consent = contact.whatsappConsent ?? { status: 'UNKNOWN' };
  if (!hasSenderConsent(consent, campaign.whatsappAccountId)) {
    const bypassed = !failure && canBypassCampaignConsent();
    if (bypassed) logConsentBypass(campaignId, phone, 'snapshot');
    else failure = { code: 'CONSENT_NOT_OPTED_IN', message: 'WhatsApp consent is not opted in.' };
  }
  let resolvedParameters: Record<string, unknown> = campaign.parameterMapping ?? {};
  if (mapping) {
    try { resolvedParameters = resolveParameterMapping(mapping, contact); }
    catch (error) { if (error instanceof ParameterResolutionError && !failure) failure = { code: error.code, message: error.message }; else if (!(error instanceof ParameterResolutionError)) throw error; }
  }
  return {
    workspaceId: campaign.workspaceId,
    campaignId: campaign._id,
    contactId: contact._id,
    recipientPhone: phone,
    recipientKey: recipientKey(campaignId, `contact:${String(contact._id)}`),
    contactSnapshot: { name: contact.name, tags: contact.tags ?? [], attributes: contact.attributes ?? {} },
    consentSnapshot: consent,
    resolvedParameters,
    status: failure ? 'SKIPPED' : 'PENDING',
    attemptCount: 0,
    submissionState: 'NOT_SUBMITTED',
    ...(failure ? { failureCode: failure.code, failureMessage: failure.message, failedAt: new Date() } : {}),
  };
}

export function createPastedRecipient(campaign: CampaignAudienceSource, value: string, index: number, contact?: ContactSource, mapping?: ParameterMapping) {
  const campaignId = String(campaign._id);
  let phone: string;
  let failure = { code: 'CONSENT_UNKNOWN', message: 'Pasted recipients require persisted opt-in evidence.' };
  try {
    phone = normalizeWhatsAppPhone(value);
  } catch {
    phone = value.trim() || `invalid-${index}`;
    failure = { code: 'INVALID_PHONE', message: 'Recipient phone is not valid E.164.' };
  }
  if (contact && failure.code !== 'INVALID_PHONE') {
    if (contact.status !== 'ACTIVE') failure = { code: 'CONTACT_INACTIVE', message: 'Matched contact is blocked or deleted.' };
    else if (hasSenderConsent(contact.whatsappConsent, campaign.whatsappAccountId)) failure = { code: '', message: '' };
    else failure = { code: 'CONSENT_NOT_OPTED_IN', message: 'Matched contact has no active WhatsApp opt-in.' };
  }
  const bypassed = failure.code !== 'INVALID_PHONE' && failure.code !== 'CONTACT_INACTIVE' && failure.code !== '' && canBypassCampaignConsent();
  if (bypassed) logConsentBypass(campaignId, phone, 'snapshot');
  let resolvedParameters: Record<string, unknown> = campaign.parameterMapping ?? {};
  if (mapping) {
    try { resolvedParameters = resolveParameterMapping(mapping, contact as ContactParameterContext | undefined); }
    catch (error) { if (error instanceof ParameterResolutionError && (!bypassed && failure.code === '' || bypassed)) failure = { code: error.code, message: error.message }; else if (!(error instanceof ParameterResolutionError)) throw error; }
  }
  const eligible = failure.code === '' || bypassed && failure.code !== 'PARAMETER_RESOLUTION_FAILED';
  return {
    workspaceId: campaign.workspaceId,
    campaignId: campaign._id,
    ...(contact ? { contactId: contact._id } : {}),
    recipientPhone: phone,
    recipientKey: recipientKey(campaignId, `pasted:${phone}`),
    contactSnapshot: contact ? { name: contact.name, tags: contact.tags ?? [], attributes: contact.attributes ?? {} } : {},
    consentSnapshot: contact?.whatsappConsent ?? { status: 'UNKNOWN', source: 'PASTED' },
    resolvedParameters,
    status: eligible ? 'PENDING' : 'SKIPPED',
    attemptCount: 0,
    submissionState: 'NOT_SUBMITTED',
    ...(!eligible ? { failureCode: failure.code, failureMessage: failure.message, failedAt: new Date() } : {}),
  };
}

const allowedFields = /^(tags|status|source|whatsappConsent\.status|attributes\.(lifecycleStage|leadScore|ecommerceData\.(totalSpend|totalOrders)|saasData\.(plan|mrr)))$/;
const blockedField = /(?:^|\.)(__proto__|prototype|constructor|password|secret|token|credential)(?:\.|$)/i;

export function segmentFilter(definition: { match?: string; conditions?: Array<{ field: string; operator: string; value?: unknown }> } = {}): Record<string, unknown> {
  const conditions = (definition.conditions ?? []).map(({ field, operator, value }) => {
    if (!allowedFields.test(field) || blockedField.test(field)) throw new AppError(400, 'INVALID_SEGMENT', 'Segment contains an unsupported field.');
    if (operator === 'EQ') return { [field]: value };
    if (operator === 'NE') return { [field]: { $ne: value } };
    if (operator === 'CONTAINS') return { [field]: value };
    if (operator === 'NOT_CONTAINS') return { [field]: { $ne: value } };
    if (operator === 'GT') return { [field]: { $gt: Number(value) } };
    if (operator === 'LT') return { [field]: { $lt: Number(value) } };
    throw new AppError(400, 'INVALID_SEGMENT', 'Segment contains an unsupported operator.');
  });
  if (!conditions.length) return {};
  return definition.match === 'ANY' ? { $or: conditions } : { $and: conditions };
}

async function upsertBatch(recipients: Array<Record<string, unknown>>) {
  if (!recipients.length) return;
  await CampaignRecipient.bulkWrite(recipients.map((recipient) => ({
    updateOne: {
      filter: {
        workspaceId: recipient.workspaceId,
        campaignId: recipient.campaignId,
        recipientKey: recipient.recipientKey,
      },
      update: { $setOnInsert: recipient },
      upsert: true,
    },
  })) as never, { ordered: false });
}

async function materializeContacts(campaign: CampaignAudienceSource, baseFilter: Record<string, unknown>, mapping: ParameterMapping) {
  let cursor: Types.ObjectId | undefined;
  do {
    const filter: Record<string, unknown> = {
      ...baseFilter,
      workspaceId: campaign.workspaceId,
      ...(cursor ? { _id: { ...(typeof baseFilter._id === 'object' ? baseFilter._id : {}), $gt: cursor } } : {}),
    };
    const contacts = await Contact.find(filter as never).sort({ _id: 1 }).limit(env.CAMPAIGN_BATCH_SIZE).lean();
    await upsertBatch(contacts.map((contact) => createContactRecipient(campaign, contact as ContactSource, mapping)));
    cursor = contacts.length === env.CAMPAIGN_BATCH_SIZE ? contacts.at(-1)?._id : undefined;
  } while (cursor);
}

export async function audienceCounts(campaign: CampaignAudienceSource) {
  const rows = await CampaignRecipient.aggregate<{ _id: string; count: number }>([
    { $match: { workspaceId: new mongoose.Types.ObjectId(String(campaign.workspaceId)), campaignId: new mongoose.Types.ObjectId(String(campaign._id)) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  return {
    total: rows.reduce((sum, row) => sum + row.count, 0),
    eligible: byStatus.PENDING ?? 0,
    skipped: byStatus.SKIPPED ?? 0,
    byStatus,
  };
}

export async function snapshotAudience(campaign: CampaignAudienceSource) {
  const { mapping } = validateParameterMapping(campaign.templateSnapshot?.components, campaign.parameterMapping, campaign.mediaMapping);
  const audience = campaign.audienceDefinition ?? { source: 'CONTACTS', contactIds: [] };
  if (audience.source === 'RETARGET') {
    // Immutable recipients were persisted with the draft. Never rebuild from live
    // contacts or the source campaign; worker eligibility is rechecked at send time.
    if (!await CampaignRecipient.exists({ workspaceId: campaign.workspaceId, campaignId: campaign._id, status: 'PENDING' })) {
      throw new AppError(409, 'AUDIENCE_EMPTY', 'The retargeting snapshot has no eligible recipients.');
    }
  } else if (audience.source === 'CONTACTS' && audience.contactIds.length) {
    await materializeContacts(campaign, { _id: { $in: audience.contactIds } }, mapping);
  } else if (audience.source === 'SEGMENT') {
    const segment = await Segment.findOne({ _id: audience.segmentId, workspaceId: campaign.workspaceId, status: 'ACTIVE' }).lean();
    if (!segment) throw new AppError(409, 'AUDIENCE_UNAVAILABLE', 'Campaign segment is unavailable.');
    await materializeContacts(campaign, segmentFilter(segment.definition ?? undefined), mapping);
  } else if (audience.source === 'PASTED') {
    for (let offset = 0; offset < audience.phones.length; offset += env.CAMPAIGN_BATCH_SIZE) {
      const phones = audience.phones.slice(offset, offset + env.CAMPAIGN_BATCH_SIZE);
      const matches = await Contact.find({ workspaceId: campaign.workspaceId, phoneE164: { $in: phones } }).lean();
      const byPhone = new Map(matches.map((contact) => [contact.phoneE164, contact as ContactSource]));
      const rows = phones.map((phone, index) => createPastedRecipient(campaign, phone, offset + index, byPhone.get(phone), mapping));
      await upsertBatch(rows);
    }
  }
  const summary = await audienceCounts(campaign);
  await Campaign.updateOne({ _id: campaign._id, workspaceId: campaign.workspaceId, status: 'SNAPSHOTTING' }, {
    $set: {
      audienceSnapshotCount: summary.total,
      'counters.total': summary.total,
      'counters.pending': summary.eligible,
      'counters.skipped': summary.skipped,
      status: 'READY',
    },
  });
  return summary;
}
