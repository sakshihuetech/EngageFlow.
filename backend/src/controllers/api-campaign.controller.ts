import mongoose from 'mongoose';
import type { NextFunction, Request, Response } from 'express';
import { ApiCampaign } from '../models/api-campaign.model.js';
import { ApiCampaignExecution } from '../models/api-campaign-execution.model.js';
import { WhatsAppAccount } from '../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../models/whatsapp-template.model.js';
import { MetaConnection } from '../models/meta-connection.model.js';
import { AppError } from '../utils/app-error.js';
import { resolveAccountView } from '../services/whatsapp/account-view.service.js';
import { successResponse } from '../utils/api-response.js';
import { normalizeSlug, previewApiCampaignRetry, retryApiCampaignExecution, serializeExecution } from '../services/api-campaign/trigger.service.js';
import { withStoredProviderFailures } from '../services/api-campaign/execution-failure.service.js';

const states = new Set(['DRAFT', 'LIVE', 'PAUSED', 'ARCHIVED']);
const executionStates = new Set(['RECEIVED', 'QUEUED', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED', 'REJECTED']);
const transitions: Record<string, string[]> = { DRAFT: ['DRAFT', 'LIVE', 'ARCHIVED'], LIVE: ['LIVE', 'PAUSED', 'ARCHIVED'], PAUSED: ['PAUSED', 'LIVE', 'ARCHIVED'], ARCHIVED: ['ARCHIVED'] };
export function canTransitionApiCampaign(previous: string | undefined, next: string) {
  return states.has(next) && (previous ? Boolean(transitions[previous]?.includes(next)) : ['DRAFT', 'LIVE'].includes(next));
}
const workspaceId = (request: Request) => request.workspaceContext!.workspaceId;
const asyncController = (handler: (request: Request, response: Response) => Promise<void>) => (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next);
async function visibleApiCampaign(request: Request, allowHistory = false) {
  const view = await resolveAccountView(workspaceId(request), allowHistory ? request.query.view : undefined, allowHistory ? request.query.accountId : undefined);
  const row = await ApiCampaign.findOne({ _id: validId(request.params.id, 'Campaign'), workspaceId: workspaceId(request), whatsappAccountId: view.account._id }).lean();
  if (!row) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'API campaign not found.');
  return row;
}
function validId(value: unknown, label: string) { if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new AppError(400, 'INVALID_ID', `${label} is invalid.`); return value; }
function serialize(row: Record<string, unknown> & { _id: unknown }) { return { id: String(row._id), name: row.name, slug: row.slug, status: row.status, description: row.description, whatsappAccountId: String(row.whatsappAccountId), whatsappPhoneNumberId: String(row.whatsappPhoneNumberId), phoneNumberId: row.phoneNumberId, templateId: String(row.templateId), templateSnapshot: row.templateSnapshot, templateParameterSchema: row.templateParameterSchema ?? [], triggerCount: row.triggerCount ?? 0, lastTriggeredAt: row.lastTriggeredAt, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
export function bodyVariableCount(components: unknown) { const body = Array.isArray(components) ? components.find((value) => value && typeof value === 'object' && (value as Record<string, unknown>).type === 'BODY') as Record<string, unknown> | undefined : undefined; const text = String(body?.text ?? ''); const placeholders = [...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]); if (placeholders.some((value) => !/^[1-9]\d*$/.test(value!))) throw new AppError(409, 'UNSUPPORTED_TEMPLATE', 'Template body variables must be numbered.'); const positions = [...new Set(placeholders.map(Number))].sort((a, b) => a - b); if (positions.some((value, index) => value !== index + 1)) throw new AppError(409, 'UNSUPPORTED_TEMPLATE', 'Template body variables must be sequential.'); return positions.length; }
function validateTemplateShape(template: { components?: unknown[] }) { const components = template.components ?? []; const header = components.find((value) => (value as Record<string, unknown>)?.type === 'HEADER') as Record<string, unknown> | undefined; if (/\{\{\d+\}\}/.test(String(header?.text ?? ''))) throw new AppError(409, 'UNSUPPORTED_TEMPLATE', 'Dynamic header parameters are not supported by API Campaigns.'); const buttons = components.find((value) => (value as Record<string, unknown>)?.type === 'BUTTONS') as { buttons?: Array<{ url?: string }> } | undefined; if (buttons?.buttons?.some((button) => String(button.url ?? '').includes('{{'))) throw new AppError(409, 'UNSUPPORTED_TEMPLATE', 'Dynamic button parameters are not supported by API Campaigns.'); }
async function resolveAssets(workspace: string, body: Record<string, unknown>, existing?: Record<string, unknown>) {
  const accountId = String(body.whatsappAccountId ?? existing?.whatsappAccountId ?? '');
  const active = await resolveAccountView(workspace);
  if (accountId !== String(active.account._id)) throw new AppError(409, 'ACCOUNT_MISMATCH', 'Select the currently connected WhatsApp account.');
  const account = await WhatsAppAccount.findOne({ _id: validId(accountId, 'WhatsApp account'), workspaceId: workspace, status: 'CONNECTED' }).lean();
  if (!account) throw new AppError(400, 'INVALID_ACCOUNT', 'WhatsApp account is unavailable.');
  const connection = await MetaConnection.findOne({ _id: account.connectionId, workspaceId: workspace, provider: 'meta', status: 'CONNECTED' }).lean();
  if (!connection) throw new AppError(409, 'WHATSAPP_NOT_CONNECTED', 'The WhatsApp account connection is unavailable.');
  const phoneId = String(body.whatsappPhoneNumberId ?? existing?.whatsappPhoneNumberId ?? '');
  const phone = await WhatsAppPhoneNumber.findOne({ _id: validId(phoneId, 'WhatsApp phone'), workspaceId: workspace, whatsappAccountId: account._id }).lean();
  if (!phone) throw new AppError(400, 'INVALID_PHONE', 'WhatsApp phone is unavailable.');
  const templateId = String(body.templateId ?? existing?.templateId ?? '');
  const template = await WhatsAppTemplate.findOne({ _id: validId(templateId, 'Template'), workspaceId: workspace, whatsappAccountId: account._id, status: 'APPROVED', isActive: true }).lean();
  if (!template) throw new AppError(400, 'INVALID_TEMPLATE', 'Approved WhatsApp template is unavailable.');
  validateTemplateShape(template);
  return { account, phone, template, parameterCount: bodyVariableCount(template.components) };
}
function ensureSendReady(phone: { registrationStatus?: string | null; codeVerificationStatus?: string | null }) { if (!['CONNECTED', 'REGISTERED'].includes(String(phone.registrationStatus ?? '').toUpperCase()) || String(phone.codeVerificationStatus ?? '').toUpperCase() !== 'VERIFIED') throw new AppError(409, 'PHONE_NOT_READY', 'Selected WhatsApp phone is not send-ready.'); }
async function buildCampaign(workspace: string, body: Record<string, unknown>, existing?: Record<string, unknown>) {
  if ('workspaceId' in body || 'phoneNumberId' in body) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and provider phone identifiers are server-controlled.');
  const name = body.name === undefined ? String(existing?.name ?? '') : String(body.name).trim();
  if (!name || name.length > 160) throw new AppError(400, 'INVALID_NAME', 'A valid campaign name is required.');
  const slug = body.slug === undefined ? String(existing?.slug ?? '') : normalizeSlug(body.slug);
  if (existing && slug !== existing.slug && body.confirmSlugChange !== true) throw new AppError(409, 'SLUG_CONFIRMATION_REQUIRED', 'Confirm the breaking slug change.');
  const status = String(body.status ?? existing?.status ?? 'DRAFT').toUpperCase() as 'DRAFT' | 'LIVE' | 'PAUSED' | 'ARCHIVED';
  if (!canTransitionApiCampaign(existing ? String(existing.status) : undefined, status)) throw new AppError(409, 'INVALID_STATUS_TRANSITION', `Cannot transition API Campaign to ${status}.`);
  const assets = await resolveAssets(workspace, body, existing);
  if (existing && (String(existing.whatsappAccountId) !== String(assets.account._id) || String(existing.phoneNumberId) !== assets.phone.phoneNumberId) && body.confirmSenderChange !== true) {
    throw new AppError(409, 'SENDER_CHANGE_CONFIRMATION_REQUIRED', 'Confirm the WhatsApp sender change and select an approved template on the new account.');
  }
  if (status === 'LIVE') ensureSendReady(assets.phone);
  const templateChanged = existing && String(existing.templateId) !== String(assets.template._id);
  const requestedSchema = body.templateParameterSchema ?? (templateChanged ? undefined : existing?.templateParameterSchema);
  if (requestedSchema !== undefined && (!Array.isArray(requestedSchema) || requestedSchema.length !== assets.parameterCount)) throw new AppError(400, 'INVALID_PARAMETER_SCHEMA', `Template parameter schema requires exactly ${assets.parameterCount} entries.`);
  const schema = Array.from({ length: assets.parameterCount }, (_, index) => { const raw = Array.isArray(requestedSchema) && requestedSchema[index] && typeof requestedSchema[index] === 'object' ? requestedSchema[index] as Record<string, unknown> : {}; return { position: index + 1, name: String(raw.name ?? `parameter_${index + 1}`).trim().slice(0, 80), required: true, ...(raw.example ? { example: String(raw.example).slice(0, 200) } : {}) }; });
  return { name, slug, status, description: body.description === undefined ? String(existing?.description ?? '') : String(body.description).trim().slice(0, 1_000), whatsappAccountId: assets.account._id, whatsappPhoneNumberId: assets.phone._id, phoneNumberId: assets.phone.phoneNumberId, templateId: assets.template._id, templateSnapshot: { metaTemplateId: assets.template.metaTemplateId, name: assets.template.name, language: assets.template.language, category: assets.template.category, status: assets.template.status, components: assets.template.components ?? [], capturedAt: new Date() }, templateParameterSchema: schema };
}

export const listApiCampaigns = asyncController(async (request, response) => { const view = await resolveAccountView(workspaceId(request), request.query.view, request.query.accountId); const limit = Math.min(Math.max(Number(request.query.limit) || 25, 1), 100); const filter: Record<string, unknown> = { workspaceId: workspaceId(request), whatsappAccountId: view.account._id }; const status = String(request.query.status ?? '').toUpperCase(); if (status && status !== 'ALL') { if (!states.has(status)) throw new AppError(400, 'INVALID_STATUS', 'Invalid status filter.'); filter.status = status; } else if (!status && request.query.archived !== 'true') filter.status = { $ne: 'ARCHIVED' }; if (request.query.cursor) filter._id = { $lt: validId(String(request.query.cursor), 'Cursor') }; const rows = await ApiCampaign.find(filter).sort({ _id: -1 }).limit(limit + 1).lean(); const items = rows.slice(0, limit); response.json(successResponse(request, { items: items.map((row) => serialize(row as never)), nextCursor: rows.length > limit ? String(items.at(-1)!._id) : null })); });
export const apiCampaignOptions = asyncController(async (request, response) => {
  const workspace = workspaceId(request);
  const active = await resolveAccountView(workspace);
  const accounts = [active.account];
  const ids = accounts.map((row) => row._id);
  const [phones, templates] = await Promise.all([
    WhatsAppPhoneNumber.find({ workspaceId: workspace, whatsappAccountId: { $in: ids } }).limit(200).lean(),
    WhatsAppTemplate.find({ workspaceId: workspace, whatsappAccountId: { $in: ids }, status: 'APPROVED', isActive: true }).sort({ name: 1 }).limit(500).lean(),
  ]);
  const templateOptions = templates.flatMap((row) => {
    try {
      validateTemplateShape(row);
      const parameterCount = bodyVariableCount(row.components);
      const header = row.components?.find((component) => (component as { type?: string }).type === 'HEADER') as { format?: string } | undefined;
      const mediaType = ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header?.format)) ? header?.format : undefined;
      return [{ id: String(row._id), accountId: String(row.whatsappAccountId), name: row.name, language: row.language, category: row.category, parameterCount, mediaType }];
    } catch { return []; }
  });
  response.json(successResponse(request, {
    accounts: accounts.map((row) => ({ id: String(row._id), name: row.name ?? 'WhatsApp account' })),
    phones: phones.map((row) => ({ id: String(row._id), accountId: String(row.whatsappAccountId), label: row.displayPhoneNumber ?? row.verifiedName ?? 'Sending phone', sendReady: ['CONNECTED', 'REGISTERED'].includes(String(row.registrationStatus ?? '').toUpperCase()) && String(row.codeVerificationStatus ?? '').toUpperCase() === 'VERIFIED' })),
    templates: templateOptions,
  }));
});
export const getApiCampaign = asyncController(async (request, response) => { const row = await visibleApiCampaign(request, true); response.json(successResponse(request, serialize(row as never))); });
export const createApiCampaign = asyncController(async (request, response) => { const values = await buildCampaign(workspaceId(request), request.body ?? {}); const row = await ApiCampaign.create({ workspaceId: workspaceId(request), ...values }); response.status(201).json(successResponse(request, serialize(row.toObject() as never))); });
export const updateApiCampaign = asyncController(async (request, response) => { await visibleApiCampaign(request); const current = await ApiCampaign.findOne({ _id: validId(request.params.id, 'Campaign'), workspaceId: workspaceId(request) }); if (!current) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'API campaign not found.'); const values = await buildCampaign(workspaceId(request), request.body ?? {}, current.toObject() as never); const changed = String(current.whatsappAccountId) !== String(values.whatsappAccountId) || current.phoneNumberId !== values.phoneNumberId; if (changed) current.senderChangeHistory.push({ at: new Date(), requestId: request.requestId, fromAccountId: current.whatsappAccountId, toAccountId: values.whatsappAccountId, fromPhoneNumberId: current.phoneNumberId, toPhoneNumberId: values.phoneNumberId, fromTemplateId: current.templateId, toTemplateId: values.templateId }); current.set(values); await current.save(); response.json(successResponse(request, serialize(current.toObject() as never))); });
export const archiveApiCampaign = asyncController(async (request, response) => { const campaign = await visibleApiCampaign(request); const row = await ApiCampaign.findOneAndUpdate({ _id: campaign._id, workspaceId: workspaceId(request), whatsappAccountId: campaign.whatsappAccountId, status: { $ne: 'ARCHIVED' } }, { $set: { status: 'ARCHIVED' } }, { new: true }); if (!row) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'API campaign not found.'); response.json(successResponse(request, serialize(row.toObject() as never))); });
export const restoreApiCampaign = asyncController(async (request, response) => { const campaign = await visibleApiCampaign(request); const row = await ApiCampaign.findOneAndUpdate({ _id: campaign._id, workspaceId: workspaceId(request), whatsappAccountId: campaign.whatsappAccountId, status: 'ARCHIVED' }, { $set: { status: 'DRAFT' } }, { new: true }); if (!row) throw new AppError(409, 'INVALID_STATUS_TRANSITION', 'Only archived campaigns can be restored.'); response.json(successResponse(request, serialize(row.toObject() as never))); });
export const apiCampaignAnalytics = asyncController(async (request, response) => { const campaign = await visibleApiCampaign(request, true); const id = String(campaign._id); const rows = await ApiCampaignExecution.aggregate<{ _id: string; count: number }>([{ $match: { workspaceId: campaign.workspaceId, apiCampaignId: campaign._id } }, { $group: { _id: '$status', count: { $sum: 1 } } }]); const counters: Record<string, number> = { total: 0, received: 0, queued: 0, sending: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0 }; for (const row of rows) { counters.total! += row.count; const key = row._id.toLowerCase(); if (key in counters) counters[key]! += row.count; if (['REJECTED', 'SKIPPED'].includes(row._id)) counters.failed! += row.count; } response.json(successResponse(request, { campaignId: id, counters })); });
export const listExecutions = asyncController(async (request, response) => {
  const view = await resolveAccountView(workspaceId(request), request.query.view, request.query.accountId);
  const limit = Math.min(Math.max(Number(request.query.limit) || 25, 1), 100);
  const filter: Record<string, unknown> = { workspaceId: new mongoose.Types.ObjectId(workspaceId(request)) };
  if (request.params.id || request.query.campaignId) {
    const campaignId = validId(request.params.id ?? String(request.query.campaignId), 'Campaign');
    const campaign = await ApiCampaign.findOne({ _id: campaignId, workspaceId: workspaceId(request), whatsappAccountId: view.account._id }).select('_id').lean();
    if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'API campaign not found.');
    filter.apiCampaignId = campaign._id;
  }
  if (request.query.status) { const status = String(request.query.status).toUpperCase(); if (!executionStates.has(status)) throw new AppError(400, 'INVALID_STATUS', 'Invalid execution status.'); filter.status = status; }
  if (request.query.cursor) filter._id = { $lt: new mongoose.Types.ObjectId(validId(String(request.query.cursor), 'Cursor')) };
  const rows = filter.apiCampaignId
    ? await ApiCampaignExecution.find(filter).sort({ _id: -1 }).limit(limit + 1).lean()
    : await ApiCampaignExecution.aggregate([
      { $match: filter }, { $sort: { _id: -1 } },
      { $lookup: { from: 'apicampaigns', localField: 'apiCampaignId', foreignField: '_id', as: 'campaignScope' } },
      { $match: { 'campaignScope.workspaceId': filter.workspaceId, 'campaignScope.whatsappAccountId': view.account._id } },
      { $limit: limit + 1 }, { $project: { campaignScope: 0 } },
    ]);
  const page = await withStoredProviderFailures(rows.slice(0, limit), workspaceId(request));
  response.json(successResponse(request, { items: page.map((row) => serializeExecution(row as never)), nextCursor: rows.length > limit ? String(page.at(-1)!._id) : null }));
});
export const getExecution = asyncController(async (request, response) => { const campaign = await visibleApiCampaign(request, true); const row = await ApiCampaignExecution.findOne({ _id: validId(request.params.executionId, 'Execution'), apiCampaignId: campaign._id, workspaceId: workspaceId(request) }).lean(); if (!row) throw new AppError(404, 'EXECUTION_NOT_FOUND', 'API campaign execution not found.'); response.json(successResponse(request, serializeExecution((await withStoredProviderFailures([row], workspaceId(request)))[0]! as never))); });
export const retryExecutionPreview = asyncController(async (request, response) => { await visibleApiCampaign(request); const result = await previewApiCampaignRetry({ workspaceId: workspaceId(request), campaignId: validId(request.params.id, 'Campaign'), executionId: validId(request.params.executionId, 'Execution') }); response.json(successResponse(request, { eligible: result.eligible, reason: result.reason, nextEligibleRetryAt: result.nextEligibleRetryAt, failureCode: result.failureCode, failureSubcode: result.failureSubcode, failureTitle: result.failureTitle, failureMessage: result.failureMessage, attempts: result.execution.attempts })); });
export const retryExecution = asyncController(async (request, response) => { await visibleApiCampaign(request); const result = await retryApiCampaignExecution({ workspaceId: workspaceId(request), campaignId: validId(request.params.id, 'Campaign'), executionId: validId(request.params.executionId, 'Execution'), ...(request.get('Idempotency-Key') ? { retryKey: request.get('Idempotency-Key')! } : {}) }); response.status(202).json(successResponse(request, { accepted: !['FAILED', 'REJECTED'].includes(result.execution!.status), idempotent: result.replay, execution: serializeExecution(result.execution!.toObject() as never) })); });
