import { createHash, randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { Campaign } from '../models/campaign.model.js';
import { CampaignRecipient } from '../models/campaign-recipient.model.js';
import { Contact } from '../models/contact.model.js';
import { Segment } from '../models/segment.model.js';
import { WhatsAppAccount } from '../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../models/whatsapp-template.model.js';
import type { AudienceDefinition } from '../services/broadcast/audience.service.js';
import { normalizeWhatsAppPhone } from '../services/broadcast/phone.js';
import {
  campaignReadiness, cancelCampaign, launchCampaign, pauseCampaign, resumeCampaign,
  type CampaignRecord,
} from '../services/broadcast/execution.service.js';
import { analyticsFromCampaign } from '../services/broadcast/tracking.service.js';
import { parseCursorPagination } from '../services/broadcast/pagination.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { listWorkspaceTemplates } from '../services/whatsapp/template.service.js';
import { safeAttributeKey } from '../services/broadcast/parameter-mapping.service.js';
import { resolveAccountView } from '../services/whatsapp/account-view.service.js';
import { confirmFailedBroadcastRetry, previewFailedBroadcastRetry } from '../services/broadcast/retry.service.js';
import { retryExclusion } from '../services/broadcast/retry-classification.service.js';
import { safeFailureText } from '../services/broadcast/safety.js';

const campaignStatuses = new Set(['DRAFT', 'SNAPSHOTTING', 'READY', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PAUSED', 'CANCELLED', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED']);
const recipientStatuses = new Set(['PENDING', 'QUEUED', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'RETRY_WAIT', 'FAILED', 'SKIPPED', 'CANCELLED']);

function workspaceId(request: Request) {
  if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authentication is not configured.');
  return request.workspaceContext.workspaceId;
}

function objectId(value: unknown, label: string) {
  if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new AppError(400, 'INVALID_ID', `${label} is invalid.`);
  return value;
}

function idempotencyKey(request: Request) {
  const supplied = request.header('Idempotency-Key') ?? (typeof request.body?.idempotencyKey === 'string' ? request.body.idempotencyKey : '');
  const key = supplied.trim() || randomUUID();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid campaign idempotency key.');
  return key;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function creationFingerprint(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function smallObject(value: unknown, label: string) {
  const object = value ?? {};
  if (!object || typeof object !== 'object' || Array.isArray(object) || JSON.stringify(object).length > 30_000) {
    throw new AppError(400, 'INVALID_PAYLOAD', `${label} must be a small object.`);
  }
  return object as Record<string, unknown>;
}

function validTimezone(value: unknown) {
  const timezone = typeof value === 'string' && value.trim() ? value.trim() : 'UTC';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: timezone }).format();
  } catch {
    throw new AppError(400, 'INVALID_TIMEZONE', 'Invalid IANA timezone.');
  }
  return timezone;
}

async function resolveAudience(body: Record<string, unknown>, workspace: string): Promise<{ definition: AudienceDefinition; count: number }> {
  const raw = body.audienceDefinition && typeof body.audienceDefinition === 'object' && !Array.isArray(body.audienceDefinition)
    ? body.audienceDefinition as Record<string, unknown> : {};
  const source = String(raw.source ?? 'CONTACTS').toUpperCase();
  if (source === 'SEGMENT') {
    const segmentId = objectId(raw.segmentId, 'Segment');
    const segment = await Segment.findOne({ _id: segmentId, workspaceId: workspace, status: 'ACTIVE' }).lean();
    if (!segment) throw new AppError(404, 'SEGMENT_NOT_FOUND', 'Segment was not found in this workspace.');
    return { definition: { source: 'SEGMENT', segmentId }, count: segment.estimatedCount ?? 0 };
  }
  if (source === 'CONTACTS') {
    const ids = Array.isArray(raw.contactIds) ? [...new Set(raw.contactIds.map(String))] : [];
    if (ids.length > 1_000 || ids.some((id) => !mongoose.isValidObjectId(id))) throw new AppError(400, 'INVALID_AUDIENCE', 'Audience contact selection is invalid or too large.');
    const count = ids.length ? await Contact.countDocuments({ _id: { $in: ids }, workspaceId: workspace, status: 'ACTIVE' }) : 0;
    if (count !== ids.length) throw new AppError(400, 'INVALID_AUDIENCE', 'Audience contains unavailable or cross-workspace contacts.');
    return { definition: { source: 'CONTACTS', contactIds: ids }, count };
  }
  if (source === 'PASTED') {
    const values = Array.isArray(raw.phones) ? raw.phones : [];
    if (values.length > 1_000) throw new AppError(400, 'INVALID_AUDIENCE', 'Pasted audience is too large for a draft.');
    const phones = [...new Set(values.map(normalizeWhatsAppPhone))];
    return { definition: { source: 'PASTED', phones }, count: phones.length };
  }
  throw new AppError(400, 'INVALID_AUDIENCE', 'Audience source is unsupported.');
}

function serializeCampaign(input: unknown) {
  const row = input as Record<string, unknown> & { _id: unknown };
  return {
    id: String(row._id),
    name: row.name,
    channel: row.channel,
    type: row.type,
    status: row.status,
    whatsappAccountId: row.whatsappAccountId ? String(row.whatsappAccountId) : undefined,
    phoneNumberId: row.phoneNumberId,
    whatsAppTemplateId: row.whatsAppTemplateId ? String(row.whatsAppTemplateId) : undefined,
    templateSnapshot: row.templateSnapshot,
    parameterMapping: row.parameterMapping ?? {},
    mediaMapping: row.mediaMapping ?? {},
    audienceDefinition: row.audienceDefinition,
    audienceSnapshotCount: row.audienceSnapshotCount ?? 0,
    sourceCampaignId: row.sourceCampaignId ? String(row.sourceCampaignId) : undefined,
    retargetingFilter: row.retargetingFilter,
    retargetingSourceAccountId: row.retargetingSourceAccountId ? String(row.retargetingSourceAccountId) : undefined,
    retargetingSourceWabaId: row.retargetingSourceWabaId,
    snapshotAt: row.snapshotAt,
    sendMode: row.sendMode,
    scheduledAt: row.scheduledAt,
    timezone: row.timezone,
    counters: row.counters,
    launchKey: row.launchKey,
    retryBatchId: row.retryBatchId,
    retryRequestedAt: row.retryRequestedAt,
    retryLastError: row.retryLastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function workspaceCampaign(request: Request, allowHistory = false) {
  const id = objectId(request.params.id, 'Campaign');
  const view = await resolveAccountView(workspaceId(request), allowHistory ? request.query.view : undefined, allowHistory ? request.query.accountId : undefined);
  const campaign = await Campaign.findOne({ _id: id, workspaceId: workspaceId(request), whatsappAccountId: view.account._id });
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Campaign was not found.');
  return campaign;
}

function asyncController(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
}

export const broadcastOptions = asyncController(async (request, response) => {
  const workspace = workspaceId(request);
  const accounts = await WhatsAppAccount.find({ workspaceId: workspace, status: 'CONNECTED' }).limit(2).lean();
  if (accounts.length !== 1) {
    response.json(successResponse(request, { configured: false, reason: accounts.length ? 'MULTIPLE_WHATSAPP_ACCOUNTS' : 'NO_WHATSAPP_ACCOUNT', templates: [], segments: [] }));
    return;
  }
  const active = await resolveAccountView(workspace);
  if (String(accounts[0]!._id) !== String(active.account._id)) throw new AppError(409, 'ACCOUNT_MISMATCH', 'Broadcast options do not match the active WhatsApp account.');
  const [phones, templates, segments, attributeContacts] = await Promise.all([
    WhatsAppPhoneNumber.find({ workspaceId: workspace, whatsappAccountId: accounts[0]!._id }).limit(2).lean(),
    listWorkspaceTemplates(workspace, { status: 'APPROVED' }),
    Segment.find({ workspaceId: workspace, status: 'ACTIVE' }).sort({ name: 1 }).limit(100).lean(),
    Contact.find({ workspaceId: workspace, status: 'ACTIVE' }).select('attributes').sort({ _id: -1 }).limit(500).lean(),
  ]);
  const attributeKeys = new Set<string>();
  const visit = (value: unknown, path: string, depth: number) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return;
    for (const [key, item] of Object.entries(value)) {
      const next = `${path}.${key}`;
      if (!safeAttributeKey(next)) continue;
      if (item && typeof item === 'object' && !Array.isArray(item)) visit(item, next, depth + 1);
      else if (typeof item === 'string' || typeof item === 'number') attributeKeys.add(next);
    }
  };
  for (const contact of attributeContacts) visit(contact.attributes, 'attributes', 1);
  const configured = phones.length === 1;
  response.json(successResponse(request, {
    configured,
    reason: configured ? undefined : phones.length ? 'MULTIPLE_SENDING_PHONES' : 'NO_SENDING_PHONE',
    templates: templates.map((template) => ({ id: template.id, name: template.name, language: template.language, category: template.category, components: template.components })),
    segments: segments.map((segment) => ({ id: String(segment._id), name: segment.name, type: segment.type, estimatedCount: segment.estimatedCount ?? 0 })),
    attributeKeys: [...attributeKeys].sort().slice(0, 200),
  }));
});

export const listBroadcasts = asyncController(async (request, response) => {
  const { limit, cursor } = parseCursorPagination(request.query);
  const view = await resolveAccountView(workspaceId(request), request.query.view, request.query.accountId);
  const filter: Record<string, unknown> = { workspaceId: workspaceId(request), whatsappAccountId: view.account._id };
  if (typeof request.query.status === 'string' && request.query.status) {
    const status = request.query.status.toUpperCase();
    if (!campaignStatuses.has(status)) throw new AppError(400, 'INVALID_STATUS', 'Invalid campaign status filter.');
    filter.status = status;
  }
  if (typeof request.query.search === 'string' && request.query.search.trim()) {
    filter.name = { $regex: request.query.search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  }
  if (cursor) filter._id = { $lt: cursor };
  const rows = await Campaign.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const items = rows.slice(0, limit);
  response.json(successResponse(request, { items: items.map(serializeCampaign), nextCursor: rows.length > limit ? String(items.at(-1)?._id) : null }));
});

export const createBroadcast = asyncController(async (request, response) => {
  const workspace = workspaceId(request);
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  if ('workspaceId' in body || 'whatsappAccountId' in body || 'phoneNumberId' in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and sender identifiers are server-controlled.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 160) throw new AppError(400, 'INVALID_NAME', 'A campaign name between 1 and 160 characters is required.');
  const accounts = await WhatsAppAccount.find({ workspaceId: workspace, status: 'CONNECTED' }).limit(2).lean();
  if (accounts.length !== 1) throw new AppError(409, 'WHATSAPP_ACCOUNT_UNAVAILABLE', accounts.length ? 'Exactly one WhatsApp account must be selected.' : 'No connected WhatsApp account is available.');
  const active = await resolveAccountView(workspace);
  if (String(accounts[0]!._id) !== String(active.account._id)) throw new AppError(409, 'ACCOUNT_MISMATCH', 'Broadcast sender does not match the active WhatsApp account.');
  const phones = await WhatsAppPhoneNumber.find({ workspaceId: workspace, whatsappAccountId: accounts[0]!._id }).limit(2).lean();
  if (phones.length !== 1) throw new AppError(409, 'PHONE_UNAVAILABLE', phones.length ? 'Exactly one sending phone must be selected.' : 'The connected account has no phone.');
  const templateId = objectId(body.whatsAppTemplateId, 'WhatsApp template');
  const template = await WhatsAppTemplate.findOne({ _id: templateId, workspaceId: workspace, whatsappAccountId: accounts[0]!._id, status: 'APPROVED', isActive: true }).lean();
  if (!template) throw new AppError(409, 'TEMPLATE_UNAVAILABLE', 'Campaigns require an approved WhatsApp template.');
  const audience = await resolveAudience(body, workspace);
  const key = idempotencyKey(request);
  const draft = {
    workspaceId: workspace,
    whatsappAccountId: accounts[0]!._id,
    phoneNumberId: phones[0]!.phoneNumberId,
    name,
    channel: 'WHATSAPP' as const,
    type: 'BROADCAST' as const,
    status: 'DRAFT' as const,
    whatsAppTemplateId: template._id,
    templateSnapshot: { metaTemplateId: template.metaTemplateId, name: template.name, language: template.language, category: template.category, status: template.status, components: template.components ?? [], capturedAt: new Date() },
    parameterMapping: smallObject(body.parameterMapping, 'Parameter mapping'),
    mediaMapping: smallObject(body.mediaMapping, 'Media mapping'),
    audienceDefinition: audience.definition,
    audienceSnapshotCount: audience.count,
    sendMode: 'DRAFT' as const,
    timezone: validTimezone(body.timezone),
  };
  const fingerprint = creationFingerprint({
    workspaceId: workspace,
    whatsappAccountId: String(accounts[0]!._id),
    phoneNumberId: phones[0]!.phoneNumberId,
    name,
    whatsAppTemplateId: String(template._id),
    parameterMapping: draft.parameterMapping,
    mediaMapping: draft.mediaMapping,
    audienceDefinition: draft.audienceDefinition,
    timezone: draft.timezone,
  });
  const existing = await Campaign.findOne({ workspaceId: workspace, idempotencyKey: key }).select('+creationFingerprint');
  if (existing) {
    if (existing.creationFingerprint !== fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This idempotency key belongs to a different campaign request.');
    response.setHeader('Idempotent-Replay', 'true');
    response.json(successResponse(request, serializeCampaign(existing.toObject())));
    return;
  }
  try {
    const campaign = new Campaign({ ...draft, idempotencyKey: key, creationFingerprint: fingerprint, createdBy: 'DEVELOPMENT_UI' });
    await campaign.save();
    response.status(201).json(successResponse(request, serializeCampaign(campaign.toObject())));
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const recovered = await Campaign.findOne({ workspaceId: workspace, idempotencyKey: key }).select('+creationFingerprint');
    if (!recovered || recovered.creationFingerprint !== fingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Campaign creation conflicts with an existing request.');
    response.setHeader('Idempotent-Replay', 'true');
    response.json(successResponse(request, serializeCampaign(recovered.toObject())));
  }
});

export const getBroadcast = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request, true);
  response.json(successResponse(request, serializeCampaign(campaign.toObject())));
});

export const updateBroadcast = asyncController(async (request, response) => {
  const workspace = workspaceId(request);
  const campaign = await workspaceCampaign(request);
  if (campaign.sourceCampaignId) throw new AppError(409, 'RETARGET_SNAPSHOT_IMMUTABLE', 'Retargeting draft audience snapshots cannot be edited.');
  if (campaign.status !== 'DRAFT') throw new AppError(409, 'INVALID_CAMPAIGN_STATE', 'Only DRAFT campaigns can be edited.');
  const body = request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {};
  if ('workspaceId' in body || 'whatsappAccountId' in body || 'phoneNumberId' in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and sender identifiers are server-controlled.');
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 160) throw new AppError(400, 'INVALID_NAME', 'A campaign name between 1 and 160 characters is required.');
  const account = await WhatsAppAccount.findOne({ _id: campaign.whatsappAccountId, workspaceId: workspace, status: 'CONNECTED' }).lean();
  if (!account) throw new AppError(409, 'WHATSAPP_ACCOUNT_UNAVAILABLE', 'The campaign WhatsApp account is unavailable.');
  const phone = await WhatsAppPhoneNumber.findOne({ workspaceId: workspace, whatsappAccountId: account._id, phoneNumberId: campaign.phoneNumberId }).lean();
  if (!phone) throw new AppError(409, 'PHONE_UNAVAILABLE', 'The campaign sending phone is unavailable.');
  const templateId = objectId(body.whatsAppTemplateId, 'WhatsApp template');
  const template = await WhatsAppTemplate.findOne({ _id: templateId, workspaceId: workspace, whatsappAccountId: account._id, status: 'APPROVED', isActive: true }).lean();
  if (!template) throw new AppError(409, 'TEMPLATE_UNAVAILABLE', 'Campaigns require an approved WhatsApp template.');
  const audience = await resolveAudience(body, workspace);
  campaign.set({
    name,
    whatsAppTemplateId: template._id,
    templateSnapshot: { metaTemplateId: template.metaTemplateId, name: template.name, language: template.language, category: template.category, status: template.status, components: template.components ?? [], capturedAt: new Date() },
    parameterMapping: smallObject(body.parameterMapping, 'Parameter mapping'),
    mediaMapping: smallObject(body.mediaMapping, 'Media mapping'),
    audienceDefinition: audience.definition,
    audienceSnapshotCount: audience.count,
    timezone: validTimezone(body.timezone),
    updatedBy: 'DEVELOPMENT_UI',
  });
  await campaign.save();
  response.json(successResponse(request, serializeCampaign(campaign.toObject())));
});

export function broadcastDuplicateDraft(source: Awaited<ReturnType<typeof workspaceCampaign>>, audience: Awaited<ReturnType<typeof resolveAudience>>) {
  return {
    workspaceId: source.workspaceId,
    whatsappAccountId: source.whatsappAccountId,
    phoneNumberId: source.phoneNumberId,
    name: `${source.name.slice(0, 153)} (Copy)`,
    channel: 'WHATSAPP',
    type: 'BROADCAST',
    status: 'DRAFT',
    ...(source.whatsAppTemplateId ? { whatsAppTemplateId: source.whatsAppTemplateId } : {}),
    ...(source.templateSnapshot ? { templateSnapshot: source.templateSnapshot } : {}),
    ...(source.parameterMapping ? { parameterMapping: source.parameterMapping } : {}),
    ...(source.mediaMapping ? { mediaMapping: source.mediaMapping } : {}),
    audienceDefinition: audience.definition,
    audienceSnapshotCount: audience.count,
    sendMode: 'DRAFT',
    timezone: source.timezone,
    createdBy: 'DEVELOPMENT_UI',
  };
}

export const duplicateBroadcast = asyncController(async (request, response) => {
  const source = await workspaceCampaign(request);
  if (source.sourceCampaignId) throw new AppError(409, 'RETARGET_SNAPSHOT_IMMUTABLE', 'Retargeting drafts cannot be duplicated.');
  const audience = await resolveAudience({ audienceDefinition: source.audienceDefinition }, workspaceId(request));
  const copy = new Campaign(broadcastDuplicateDraft(source, audience));
  await copy.save();
  response.status(201).json(successResponse(request, serializeCampaign(copy.toObject())));
});

export const broadcastReadiness = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request);
  response.json(successResponse(request, await campaignReadiness(campaign as CampaignRecord)));
});

export const broadcastAnalytics = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request, true);
  response.json(successResponse(request, analyticsFromCampaign(campaign)));
});

export const broadcastRecipients = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request, true);
  const { limit, cursor } = parseCursorPagination(request.query);
  const filter: Record<string, unknown> = { workspaceId: workspaceId(request), campaignId: campaign._id };
  if (typeof request.query.status === 'string' && request.query.status) {
    const status = request.query.status.toUpperCase();
    if (!recipientStatuses.has(status)) throw new AppError(400, 'INVALID_STATUS', 'Invalid recipient status filter.');
    filter.status = status;
  }
  if (cursor) filter._id = { $lt: cursor };
  const rows = await CampaignRecipient.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const page = rows.slice(0, limit);
  response.json(successResponse(request, {
    items: page.map((row) => ({
      id: String(row._id), contactId: row.contactId ? String(row.contactId) : undefined,
      recipientPhone: row.recipientPhone, contactName: (row.contactSnapshot as { name?: string } | undefined)?.name,
      status: row.status, attemptCount: row.attemptCount ?? 0, acceptedAt: row.acceptedAt,
      sentAt: row.sentAt, deliveredAt: row.deliveredAt, readAt: row.readAt, failedAt: row.failedAt,
      ...(['FAILED', 'SKIPPED', 'RETRY_WAIT'].includes(row.status) ? { failureCode: safeFailureText(row.failureCode, 64), failureSubcode: row.failureSubcode, failureTitle: safeFailureText(row.failureTitle, 300), failureMessage: safeFailureText(row.failureMessage, 1_000), failureSource: row.failureSource, retrySafety: row.retrySafety, nextEligibleRetryAt: row.nextEligibleRetryAt, retryExclusionReason: row.retryExclusionReason, retryEligibility: retryExclusion(row) } : {}),
      attemptHistory: (row.attemptHistory ?? []).map((attempt) => ({ attempt: attempt.attempt, at: attempt.at, status: attempt.status, failureCode: safeFailureText(attempt.failureCode, 64), failureSubcode: attempt.failureSubcode, failureTitle: safeFailureText(attempt.failureTitle, 300), failureMessage: safeFailureText(attempt.failureMessage, 1_000), failureSource: attempt.failureSource, retrySafety: attempt.retrySafety })),
    })),
    nextCursor: rows.length > limit ? String(page.at(-1)?._id) : null,
  }));
});

export const retryBroadcastPreview = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request);
  response.json(successResponse(request, await previewFailedBroadcastRetry(campaign)));
});

export const retryBroadcastFailed = asyncController(async (request, response) => {
  if (request.body?.confirm !== true) throw new AppError(400, 'RETRY_CONFIRMATION_REQUIRED', 'Confirm the recipient count and potential additional messaging charges.');
  const campaign = await workspaceCampaign(request);
  const result = await confirmFailedBroadcastRetry(campaign, request.header('Idempotency-Key') ?? request.body?.retryKey);
  response.status(202).json(successResponse(request, result));
});

export const launchBroadcast = asyncController(async (request, response) => {
  const campaign = await workspaceCampaign(request);
  const result = await launchCampaign({
    campaign: campaign as CampaignRecord,
    workspaceId: workspaceId(request),
    mode: request.body?.mode,
    scheduledLocal: request.body?.scheduledLocal,
    timezone: validTimezone(request.body?.timezone ?? campaign.timezone),
    launchKey: request.header('Idempotency-Key') ?? request.body?.launchKey,
  });
  response.status(202).json(successResponse(request, { campaign: serializeCampaign(result.campaign.toObject()), snapshot: result.summary, idempotent: result.idempotent }));
});

export const pauseBroadcast = asyncController(async (request, response) => {
  await workspaceCampaign(request);
  const campaign = await pauseCampaign(objectId(request.params.id, 'Campaign'), workspaceId(request));
  if (!campaign) throw new AppError(409, 'INVALID_CAMPAIGN_STATE', 'Campaign cannot be paused from its current state.');
  response.json(successResponse(request, serializeCampaign(campaign.toObject())));
});

export const resumeBroadcast = asyncController(async (request, response) => {
  await workspaceCampaign(request);
  const campaign = await resumeCampaign(objectId(request.params.id, 'Campaign'), workspaceId(request));
  if (!campaign) throw new AppError(409, 'INVALID_CAMPAIGN_STATE', 'Campaign is not paused.');
  response.status(202).json(successResponse(request, serializeCampaign(campaign.toObject())));
});

export const cancelBroadcast = asyncController(async (request, response) => {
  await workspaceCampaign(request);
  const campaign = await cancelCampaign(objectId(request.params.id, 'Campaign'), workspaceId(request));
  if (!campaign) throw new AppError(409, 'INVALID_CAMPAIGN_STATE', 'Campaign cannot be cancelled from its current state.');
  response.json(successResponse(request, serializeCampaign(campaign.toObject())));
});
