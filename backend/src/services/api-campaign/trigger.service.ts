import { createHash, randomUUID } from 'node:crypto';
import { ApiCampaign } from '../../models/api-campaign.model.js';
import { ApiCampaignExecution } from '../../models/api-campaign-execution.model.js';
import { ApiCredential } from '../../models/api-credential.model.js';
import { Contact } from '../../models/contact.model.js';
import { enqueueApiCampaignExecution, apiCampaignJobId } from '../../config/api-campaign-queue.js';
import { normalizeWhatsAppPhone } from '../broadcast/phone.js';
import { AppError } from '../../utils/app-error.js';
import { env } from '../../config/env.js';
import { safeApiCampaignFailureText } from './failure-safety.js';
import { assertApiCampaignAssetsReady } from './send-readiness.service.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';

export function normalizeSlug(value: unknown) {
  const slug = String(value ?? '').trim();
  if (!/^[a-z][a-z0-9_]{2,79}$/.test(slug)) throw new AppError(400, 'INVALID_SLUG', 'Slug must be 3-80 lowercase letters, numbers, or underscores and start with a letter.');
  return slug;
}

const attributeKey = /^[A-Za-z][A-Za-z0-9_-]{0,79}$/;
const sensitiveKey = /(secret|password|authorization|credential|api[_-]?key|access[_-]?token|refresh[_-]?token)/i;
const stripControls = (value: string) => Array.from(value, (character) => { const code = character.charCodeAt(0); return code <= 31 || code === 127 ? ' ' : character; }).join('');
function safeAttributeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attributes may be nested at most 4 levels.');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (!Number.isFinite(value)) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attribute numbers must be finite.'); return value; }
  if (typeof value === 'string') { if (value.length > 2_000) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attribute strings must be at most 2000 characters.'); return stripControls(value); }
  if (Array.isArray(value)) { if (value.length > 50) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attribute arrays may contain at most 50 items.'); return value.map((entry) => safeAttributeValue(entry, depth + 1)); }
  if (!value || typeof value !== 'object') throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attributes must contain JSON-safe values.');
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!attributeKey.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || sensitiveKey.test(key)) throw new AppError(400, 'INVALID_ATTRIBUTES', `Unsafe attribute key: ${key}`);
    output[key] = safeAttributeValue(entry, depth + 1);
  }
  return output;
}
export function cleanAttributes(value: unknown) {
  const raw = value === undefined ? {} : value;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attributes must be a small object.');
  const cleaned = safeAttributeValue(raw) as Record<string, unknown>;
  if (JSON.stringify(cleaned).length > 20_000) throw new AppError(400, 'INVALID_ATTRIBUTES', 'Attributes must be a small object.');
  return cleaned;
}
function cleanText(value: unknown, max: number) { return typeof value === 'string' ? stripControls(value).trim().slice(0, max) : ''; }
export function cleanTags(value: unknown) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new AppError(400, 'INVALID_TAGS', 'Tags must be an array of strings.');
  const tags: string[] = [], seen = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== 'string') throw new AppError(400, 'INVALID_TAGS', 'Tags must contain only strings.');
    const tag = cleanText(raw, 81);
    if (tag.length > 80) throw new AppError(400, 'INVALID_TAGS', 'Each tag must be at most 80 characters.');
    if (tag && !seen.has(tag.toLowerCase())) { tags.push(tag); seen.add(tag.toLowerCase()); }
  }
  if (tags.length > 50) throw new AppError(400, 'INVALID_TAGS', 'At most 50 tags may be supplied.');
  return tags;
}
function cleanName(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new AppError(400, 'INVALID_USER_NAME', 'userName must be a string.');
  const result = cleanText(value, 161);
  if (result.length > 160) throw new AppError(400, 'INVALID_USER_NAME', 'userName must be at most 160 characters.');
  return result || undefined;
}
function cleanParams(value: unknown, expected: number) {
  const params = value === undefined ? [] : value;
  if (!Array.isArray(params) || params.length !== expected) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', `templateParams requires exactly ${expected} values.`);
  return params.map((entry) => { const text = typeof entry === 'string' || typeof entry === 'number' ? String(entry).trim() : ''; if (!text || text.length > 1_024) throw new AppError(400, 'INVALID_TEMPLATE_PARAMETERS', 'Template parameters must be non-empty and at most 1024 characters.'); return text; });
}
export function validateTriggerMedia(campaign: { templateSnapshot?: unknown }, value: unknown) {
  const snapshot = campaign.templateSnapshot as { components?: Array<Record<string, unknown>> } | undefined;
  const header = snapshot?.components?.find((component) => component.type === 'HEADER');
  const headerType = String(header?.format ?? 'NONE').toUpperCase(), mediaHeader = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType);
  if (value === undefined) { if (mediaHeader) throw new AppError(400, 'MEDIA_REQUIRED', `${headerType} template requires media.`); return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'INVALID_MEDIA', 'media must be an object.');
  const raw = value as Record<string, unknown>, type = String(raw.type ?? '').toUpperCase();
  if (!mediaHeader || type !== headerType) throw new AppError(409, 'MEDIA_TEMPLATE_MISMATCH', `Selected template requires ${mediaHeader ? headerType.toLowerCase() : 'no'} media header.`);
  const urlValue = typeof raw.url === 'string' ? raw.url.trim() : '';
  let url: URL; try { url = new URL(urlValue); } catch { throw new AppError(400, 'INVALID_MEDIA_URL', 'media.url must be a public HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname || urlValue.length > 2_048) throw new AppError(400, 'INVALID_MEDIA_URL', 'media.url must be a public HTTPS URL.');
  const filename = raw.filename === undefined ? '' : cleanText(raw.filename, 241);
  if (filename && (type !== 'DOCUMENT' || filename.length > 240 || /[\\/]/.test(filename))) throw new AppError(400, 'INVALID_MEDIA_FILENAME', 'media.filename is invalid.');
  return { type: type as 'IMAGE' | 'VIDEO' | 'DOCUMENT', url: url.toString(), ...(filename ? { filename } : {}) };
}
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])) : value; }
export function triggerFingerprint(value: unknown) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }

async function findOrCreateContact(input: { workspaceId: string; destination: string; userName?: string; tags: string[]; attributes: Record<string, unknown> }) {
  let contact = await Contact.findOne({ workspaceId: input.workspaceId, phoneE164: input.destination });
  if (!contact) {
    try { return await Contact.create({ workspaceId: input.workspaceId, name: input.userName || input.destination, phoneE164: input.destination, tags: input.tags, attributes: input.attributes, source: 'API_CAMPAIGN', status: 'ACTIVE', whatsappConsent: { status: 'UNKNOWN' } }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; contact = await Contact.findOne({ workspaceId: input.workspaceId, phoneE164: input.destination }); }
  }
  if (!contact || contact.status === 'DELETED') return null;
  const set: Record<string, unknown> = {};
  if (input.userName) set.name = input.userName;
  for (const [key, value] of Object.entries(input.attributes)) set[`attributes.${key}`] = value;
  const existingTags = new Set((contact.tags ?? []).map((tag) => String(tag).toLowerCase())), additions = input.tags.filter((tag) => !existingTags.has(tag.toLowerCase()));
  if (!Object.keys(set).length && !additions.length) return contact;
  return Contact.findOneAndUpdate({ _id: contact._id, workspaceId: input.workspaceId, phoneE164: input.destination, status: { $ne: 'DELETED' } }, { ...(Object.keys(set).length ? { $set: set } : {}), ...(additions.length ? { $addToSet: { tags: { $each: additions } } } : {}) }, { new: true, runValidators: true });
}

export interface TriggerDependencies { enqueue?: typeof enqueueApiCampaignExecution }
export async function triggerApiCampaign(input: { workspaceId: string; credentialId?: string; idempotencyKey?: string; body: Record<string, unknown> }, dependencies: TriggerDependencies = {}) {
  if ('workspaceId' in input.body || 'apiCampaignId' in input.body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and campaign IDs are server-controlled.');
  const slug = normalizeSlug(input.body.campaign), destination = normalizeWhatsAppPhone(String(input.body.destination ?? ''));
  const campaign = await ApiCampaign.findOne({ workspaceId: input.workspaceId, slug, status: 'LIVE' }).lean();
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Live API campaign not found.');
  await assertApiCampaignAssetsReady(campaign);
  const params = cleanParams(input.body.templateParams, campaign.templateParameterSchema?.length ?? 0);
  const userName = cleanName(input.body.userName ?? input.body.contactName), tags = cleanTags(input.body.tags), attributes = cleanAttributes(input.body.attributes), media = validateTriggerMedia(campaign, input.body.media), source = cleanText(input.body.source, 120) || 'EXTERNAL_API';
  const idempotencyKey = (input.idempotencyKey || cleanText(input.body.idempotencyKey, 160) || randomUUID()).trim();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(idempotencyKey)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid Idempotency-Key.');
  const requestFingerprint = triggerFingerprint({ destination, params, userName, tags, attributes, media, source });
  let execution = await ApiCampaignExecution.findOne({ workspaceId: input.workspaceId, apiCampaignId: campaign._id, idempotencyKey }).select('+requestFingerprint');
  if (execution && execution.requestFingerprint !== requestFingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key was already used for a different request.');
  const replay = Boolean(execution);
  if (!execution) {
    const contact = await findOrCreateContact({ workspaceId: input.workspaceId, destination, ...(userName ? { userName } : {}), tags, attributes });
    const marketing = String((campaign.templateSnapshot as { category?: string })?.category ?? '').toUpperCase() === 'MARKETING';
    const notSuppressed = Boolean(contact && contact.status === 'ACTIVE' && contact.whatsappConsent?.status !== 'OPTED_OUT');
    const allowed = notSuppressed && (!marketing || hasSenderConsent(contact!.whatsappConsent, campaign.whatsappAccountId)) || env.NODE_ENV !== 'production' && env.API_CAMPAIGN_TEST_BYPASS_CONSENT === 'true' && contact?.status !== 'DELETED';
    const base = { workspaceId: input.workspaceId, apiCampaignId: campaign._id, campaignSlug: slug, destination, senderAccountId: campaign.whatsappAccountId, senderPhoneNumberId: campaign.phoneNumberId, senderTemplateId: campaign.templateId, ...(contact?._id ? { contactId: contact._id } : {}), ...(input.credentialId ? { apiCredentialId: input.credentialId } : {}), requestFingerprint, idempotencyKey, resolvedTemplateParams: params, ...(userName ? { userName } : {}), tags, attributes, source, ...(media ? { media } : {}), status: allowed ? 'RECEIVED' as const : 'REJECTED' as const, ...(allowed ? {} : { failureCode: 'CONSENT_NOT_OPTED_IN', failureTitle: 'Consent required', failureMessage: 'Marketing messages require active WhatsApp consent.', failureCategory: 'VALIDATION' as const, retrySafety: 'UNCERTAIN' as const, failedAt: new Date() }) };
    try { execution = await ApiCampaignExecution.create(base); await ApiCampaign.updateOne({ _id: campaign._id, workspaceId: input.workspaceId }, { $inc: { triggerCount: 1 }, $set: { lastTriggeredAt: new Date() } }); }
    catch (error) { if ((error as { code?: number }).code !== 11000) throw error; execution = await ApiCampaignExecution.findOne({ workspaceId: input.workspaceId, apiCampaignId: campaign._id, idempotencyKey }).select('+requestFingerprint'); if (!execution || execution.requestFingerprint !== requestFingerprint) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key conflicts with another request.'); }
  }
  if (execution.status === 'RECEIVED') {
    const queuedAt = new Date(), jobId = apiCampaignJobId(String(execution._id));
    const claimed = await ApiCampaignExecution.findOneAndUpdate({ _id: execution._id, workspaceId: input.workspaceId, status: 'RECEIVED' }, { $set: { status: 'QUEUED', queuedAt, queueJobId: jobId }, $unset: { failureCategory: '' } }, { new: true });
    if (claimed) {
      execution = claimed;
      try { await (dependencies.enqueue ?? enqueueApiCampaignExecution)({ executionId: String(execution._id) }); }
      catch { await ApiCampaignExecution.updateOne({ _id: execution._id, workspaceId: input.workspaceId, status: 'QUEUED', queuedAt }, { $set: { status: 'RECEIVED', failureCategory: 'QUEUE_SYSTEM', retrySafety: 'SAFE' }, $unset: { queuedAt: '', queueJobId: '' } }); throw new AppError(503, 'QUEUE_UNAVAILABLE', 'API Campaign queue is unavailable. Retry with the same idempotency key.'); }
    }
  }
  return { execution, replay };
}

export async function previewApiCampaignRetry(input: { workspaceId: string; campaignId: string; executionId: string }) {
  const original = await ApiCampaignExecution.findOne({ _id: input.executionId, workspaceId: input.workspaceId, apiCampaignId: input.campaignId });
  if (!original) throw new AppError(404, 'EXECUTION_NOT_FOUND', 'API Campaign execution not found.');
  let reason: string | undefined;
  if (original.status !== 'FAILED') reason = 'EXECUTION_NOT_FAILED';
  else if (original.retrySafety !== 'SAFE' || original.submissionState === 'UNCERTAIN') reason = 'OUTCOME_NOT_RETRY_SAFE';
  else if ((original.attempts ?? 0) >= 5) reason = 'ATTEMPT_LIMIT';
  else if ((original.metaMessageId || original.whatsappMessageId) && !(original.failureSource === 'META_WEBHOOK' && original.submissionState === 'ACCEPTED' && original.failureCode === '429' && original.metaMessageId)) reason = 'PROVIDER_OUTCOME_UNCERTAIN';
  else if (!original.senderAccountId || !original.senderPhoneNumberId || !original.senderTemplateId) reason = 'ORIGINAL_BINDING_UNAVAILABLE';
  else if (original.retryRestriction === 'PROVIDER_WAIT_UNKNOWN') reason = 'PROVIDER_RESTRICTION';
  else if (original.nextEligibleRetryAt && original.nextEligibleRetryAt.getTime() > Date.now()) reason = 'RETRY_AFTER';
  if (!reason) {
    const campaign = await ApiCampaign.findOne({ _id: original.apiCampaignId, workspaceId: input.workspaceId, status: 'LIVE' }).lean();
    if (!campaign || String(campaign.whatsappAccountId) !== String(original.senderAccountId) || campaign.phoneNumberId !== original.senderPhoneNumberId || String(campaign.templateId) !== String(original.senderTemplateId)) reason = 'ORIGINAL_SENDER_OR_TEMPLATE_CHANGED';
    else {
      try { await assertApiCampaignAssetsReady(campaign); } catch { reason = 'SENDER_OR_TEMPLATE_UNAVAILABLE'; }
      const contact = original.contactId ? await Contact.findOne({ _id: original.contactId, workspaceId: input.workspaceId }).lean() : null;
      const marketing = String((campaign.templateSnapshot as { category?: string })?.category ?? '').toUpperCase() === 'MARKETING';
      if (!contact || contact.status !== 'ACTIVE' || contact.phoneE164 !== original.destination || contact.whatsappConsent?.status === 'OPTED_OUT' || (marketing && !hasSenderConsent(contact.whatsappConsent, campaign.whatsappAccountId))) reason = 'CONSENT_OR_CONTACT';
    }
    if (original.apiCredentialId) { const credential = await ApiCredential.findOne({ _id: original.apiCredentialId, workspaceId: input.workspaceId, status: 'ACTIVE' }).lean(); if (!credential) reason = 'CREDENTIAL_UNAVAILABLE'; }
  }
  return { execution: original, eligible: !reason, reason, nextEligibleRetryAt: original.nextEligibleRetryAt, failureCode: original.failureCode, failureSubcode: original.failureSubcode, failureTitle: safeFailureOutput(original.failureTitle, 300), failureMessage: safeFailureOutput(original.failureMessage) };
}

export async function retryApiCampaignExecution(input: { workspaceId: string; campaignId: string; executionId: string; credentialId?: string; retryKey?: string }, dependencies: TriggerDependencies = {}) {
  const preview = await previewApiCampaignRetry(input);
  if (!preview.eligible) {
    if (['QUEUED', 'SENDING'].includes(preview.execution.status)) return { execution: preview.execution, replay: true };
    throw new AppError(409, 'RETRY_BLOCKED', preview.reason ?? 'Execution is not retry-safe.');
  }
  const retryKey = input.retryKey && /^[A-Za-z0-9._:-]{8,160}$/.test(input.retryKey) ? input.retryKey : randomUUID();
  const next = (preview.execution.retrySequence ?? 0) + 1;
  const claimed = await ApiCampaignExecution.findOneAndUpdate({ _id: preview.execution._id, workspaceId: input.workspaceId, apiCampaignId: input.campaignId, status: 'FAILED', retrySafety: 'SAFE', submissionState: preview.execution.submissionState, metaMessageId: preview.execution.metaMessageId ?? null, whatsappMessageId: preview.execution.whatsappMessageId ?? null, retrySequence: preview.execution.retrySequence ?? 0, attempts: { $lt: 5 }, ...(preview.execution.metaMessageId ? { failureSource: 'META_WEBHOOK', failureCode: '429' } : {}) }, { $set: { status: 'QUEUED', submissionState: 'NOT_SUBMITTED', retrySequence: next, retryMode: 'MANUAL', retryRequestKey: retryKey, retryRequestedAt: new Date(), queuedAt: new Date(), queueJobId: apiCampaignJobId(String(preview.execution._id), next) }, $unset: { nextEligibleRetryAt: '', metaMessageId: '', whatsappMessageId: '' } }, { new: true });
  if (!claimed) throw new AppError(409, 'RETRY_ALREADY_STARTED', 'Another retry already claimed this execution.');
  try { await (dependencies.enqueue ?? enqueueApiCampaignExecution)({ executionId: String(claimed._id), retrySequence: next }); } catch { /* durable QUEUED claim is redispatched by worker reconciliation */ }
  return { execution: claimed, replay: false };
}

function safeFailureOutput(value: unknown, max = 1_000) { return typeof value === 'string' ? safeApiCampaignFailureText(value, max) : undefined; }
export function serializeExecution(row: Record<string, unknown> & { _id: unknown }, includeEnrichment = false) {
  return { id: String(row._id), apiCampaignId: String(row.apiCampaignId), campaignSlug: row.campaignSlug, status: row.status, attempts: row.attempts ?? 0, source: row.source, ...(includeEnrichment ? { userName: row.userName, tags: row.tags ?? [], attributes: row.attributes ?? {}, media: row.media } : {}), failureCode: /^[A-Za-z0-9_]{1,64}$/.test(String(row.failureCode ?? '')) ? row.failureCode : undefined, failureSubcode: row.failureSubcode, failureTitle: safeFailureOutput(row.failureTitle, 300), failureMessage: safeFailureOutput(row.failureMessage), failureCategory: row.failureCategory, retrySafety: row.retrySafety, retryExhausted: row.retryExhausted, retryRestriction: row.retryRestriction, nextEligibleRetryAt: row.nextEligibleRetryAt, retryMode: row.retryMode, attemptHistory: Array.isArray(row.attemptHistory) ? row.attemptHistory.map((item: Record<string, unknown>) => ({ attempt: item.attempt, at: item.at, status: item.status, failureCode: item.failureCode, failureSubcode: item.failureSubcode, failureTitle: safeFailureOutput(item.failureTitle, 300), failureMessage: safeFailureOutput(item.failureMessage), retrySafety: item.retrySafety })) : [], receivedAt: row.receivedAt, queuedAt: row.queuedAt, acceptedAt: row.acceptedAt, sentAt: row.sentAt, deliveredAt: row.deliveredAt, readAt: row.readAt, failedAt: row.failedAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
