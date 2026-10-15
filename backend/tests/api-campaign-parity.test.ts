import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ApiCampaign } from '../src/models/api-campaign.model.js';
import { ApiCampaignExecution } from '../src/models/api-campaign-execution.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';
import { apiCampaignOptions, bodyVariableCount, canTransitionApiCampaign, getExecution, listApiCampaigns, listExecutions } from '../src/controllers/api-campaign.controller.js';
import { classifyApiCampaignFailure, safeApiCampaignFailure } from '../src/services/api-campaign/worker.service.js';
import { ProviderSendError } from '../src/services/whatsapp/transport.js';
import { cleanAttributes, cleanTags, retryApiCampaignExecution, serializeExecution, triggerApiCampaign, triggerFingerprint, validateTriggerMedia } from '../src/services/api-campaign/trigger.service.js';
import { MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { AppError } from '../src/utils/app-error.js';
import { trigger } from '../src/controllers/api-campaign-trigger.controller.js';
import * as triggerService from '../src/services/api-campaign/trigger.service.js';
import { apiKeyAuth } from '../src/middleware/api-key-auth.js';
import * as connectionContext from '../src/services/whatsapp/connection-context.service.js';
import * as sendReadiness from '../src/services/api-campaign/send-readiness.service.js';

const workspaceId = '64b000000000000000000001';
const campaignId = '64b000000000000000000002';
const executionId = '64b000000000000000000003';
const credentialId = '64b000000000000000000004';
const body = { campaign: 'payment_success', destination: '+15551234567', templateParams: [] };
const campaign = { _id: campaignId, workspaceId, slug: 'payment_success', status: 'LIVE', templateParameterSchema: [], templateSnapshot: { category: 'UTILITY', components: [{ type: 'BODY', text: 'Ready' }] } };
afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: campaignId } } as never);
  vi.spyOn(sendReadiness, 'assertApiCampaignAssetsReady').mockResolvedValue(undefined);
});

describe('API Campaign Batch 2 parity', () => {
  it('mounts both external trigger aliases without falling into the route-not-found handler', async () => {
    const app = createApp();
    const legacy = await request(app).post('/api/v1/whatsapp/api-campaigns/trigger').send(body);
    const current = await request(app).post('/api/v1/campaigns/trigger').send(body);
    expect(legacy.status).not.toBe(404);
    expect(current.status).not.toBe(404);
  });

  it('keeps the V2 response shape on the legacy path and the EngageFlow envelope on the alias', async () => {
    vi.spyOn(triggerService, 'triggerApiCampaign').mockResolvedValue({ replay: true, execution: { _id: executionId, status: 'QUEUED', toObject: () => ({ _id: executionId, apiCampaignId: campaignId, campaignSlug: 'payment_success', status: 'QUEUED' }) } } as never);
    const call = async (baseUrl: string) => {
      const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
      const next = vi.fn();
      await trigger({ baseUrl, body, header: () => 'payment-event-1', workspaceContext: { workspaceId }, apiCredentialId: credentialId, requestId: 'test' } as never, response as never, next);
      expect(next).not.toHaveBeenCalled();
      expect(response.status).toHaveBeenCalledWith(202);
      expect(response.setHeader).toHaveBeenCalledWith('Idempotent-Replay', 'true');
      return response.json.mock.calls[0]?.[0] as Record<string, unknown>;
    };
    const legacy = await call('/api/v1/whatsapp/api-campaigns');
    const current = await call('/api/v1/campaigns');
    expect(legacy).toMatchObject({ accepted: true, idempotent: true, execution: { id: executionId } });
    expect(legacy).not.toHaveProperty('data');
    expect(current).toMatchObject({ success: true, data: { executionId, replay: true } });
  });

  it('returns a V2-style sanitized error body from the legacy trigger controller', async () => {
    vi.spyOn(triggerService, 'triggerApiCampaign').mockRejectedValue(new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This key belongs to another request.'));
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
    const next = vi.fn();
    await trigger({ baseUrl: '/api/v1/whatsapp/api-campaigns', body, header: () => 'payment-event-1', workspaceContext: { workspaceId }, apiCredentialId: credentialId } as never, response as never, next);
    expect(response.status).toHaveBeenCalledWith(409);
    expect(response.json).toHaveBeenCalledWith({ code: 'IDEMPOTENCY_CONFLICT', message: 'This key belongs to another request.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('keeps legacy authentication failures in the V2 error shape', async () => {
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await apiKeyAuth({ baseUrl: '/api/v1/whatsapp/api-campaigns', get: () => undefined } as never, response as never, next);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(response.json).toHaveBeenCalledWith({ code: 'INVALID_API_KEY', message: 'Invalid API key.' });
    expect(next).not.toHaveBeenCalled();
  });

  it('enforces V2 lifecycle transitions, including archived restore to draft only', () => {
    expect(canTransitionApiCampaign(undefined, 'DRAFT')).toBe(true);
    expect(canTransitionApiCampaign('DRAFT', 'LIVE')).toBe(true);
    expect(canTransitionApiCampaign('LIVE', 'PAUSED')).toBe(true);
    expect(canTransitionApiCampaign('PAUSED', 'LIVE')).toBe(true);
    expect(canTransitionApiCampaign('LIVE', 'DRAFT')).toBe(false);
    expect(canTransitionApiCampaign('ARCHIVED', 'LIVE')).toBe(false);
  });

  it('preserves the V2 ALL list filter without dropping workspace scope', async () => {
    const find = vi.spyOn(ApiCampaign, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) } as never);
    const response = { json: vi.fn() };
    listApiCampaigns({ workspaceContext: { workspaceId }, params: {}, query: { status: 'ALL' }, requestId: 'test' } as never, response as never, vi.fn());
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    expect(find).toHaveBeenCalledWith({ workspaceId, whatsappAccountId: campaignId });
  });

  it('rejects gaps in body variables and incompatible media before enqueue', () => {
    expect(bodyVariableCount([{ type: 'BODY', text: '{{1}} and {{2}}' }])).toBe(2);
    expect(() => bodyVariableCount([{ type: 'BODY', text: '{{2}}' }])).toThrow(/sequential/);
    expect(() => validateTriggerMedia(campaign, { type: 'IMAGE', url: 'https://example.com/image' })).toThrow(/no media/);
    expect(() => validateTriggerMedia({ templateSnapshot: { components: [{ type: 'HEADER', format: 'IMAGE' }] } }, undefined)).toThrow(/requires media/);
  });

  it('keeps unsupported approved templates from breaking the entire campaign editor', async () => {
    vi.spyOn(WhatsAppAccount, 'find').mockReturnValue({ limit: () => ({ lean: async () => [{ _id: campaignId, name: 'Account' }] }) } as never);
    vi.spyOn(WhatsAppPhoneNumber, 'find').mockReturnValue({ limit: () => ({ lean: async () => [] }) } as never);
    vi.spyOn(WhatsAppTemplate, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [
      { _id: executionId, whatsappAccountId: campaignId, name: 'Unsupported', language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: '{{2}}' }] },
      { _id: credentialId, whatsappAccountId: campaignId, name: 'Supported', language: 'en_US', category: 'UTILITY', components: [{ type: 'BODY', text: '{{1}}' }] },
    ] }) }) } as never);
    const response = { json: vi.fn() };
    apiCampaignOptions({ workspaceContext: { workspaceId }, params: {}, query: {}, requestId: 'test' } as never, response as never, vi.fn());
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    expect(response.json.mock.calls[0]?.[0].data.templates).toMatchObject([{ id: credentialId, parameterCount: 1 }]);
  });

  it('bounds and sanitizes contact enrichment fields', () => {
    expect(cleanTags(['VIP', 'vip', 'Customer'])).toEqual(['VIP', 'Customer']);
    expect(cleanAttributes({ tier: { level: 2 } })).toEqual({ tier: { level: 2 } });
    expect(() => cleanAttributes({ access_token: 'private' })).toThrow(/Unsafe attribute/);
    expect(() => cleanTags(Array.from({ length: 51 }, (_, index) => `tag-${index}`))).toThrow(/50 tags/);
  });

  it('keeps sensitive enrichment out of dashboard execution responses', () => {
    const row = { _id: executionId, apiCampaignId: campaignId, campaignSlug: 'payment_success', attributes: { customerCode: 'private-value' }, media: { url: 'https://example.com/private' }, failureMessage: 'Bearer secret-token failed at https://example.com/private' };
    const dashboard = serializeExecution(row);
    expect(dashboard).not.toHaveProperty('attributes');
    expect(dashboard).not.toHaveProperty('media');
    expect(JSON.stringify(dashboard)).not.toContain('secret-token');
    expect(serializeExecution(row, true)).toHaveProperty('attributes');
  });

  it('pages executions within the route campaign and workspace, ignoring a conflicting query campaign', async () => {
    vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({ _id: campaignId }) }) } as never);
    const find = vi.spyOn(ApiCampaignExecution, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [
      { _id: '64b000000000000000000010', apiCampaignId: campaignId, status: 'QUEUED' },
      { _id: '64b000000000000000000009', apiCampaignId: campaignId, status: 'FAILED' },
      { _id: '64b000000000000000000008', apiCampaignId: campaignId, status: 'FAILED' },
    ] }) }) } as never);
    const response = { json: vi.fn() };
    const next = vi.fn();
    listExecutions({ workspaceContext: { workspaceId }, params: { id: campaignId }, query: { limit: '2', campaignId: credentialId }, requestId: 'test' } as never, response as never, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
    expect(ApiCampaign.findOne).toHaveBeenCalledWith({ _id: campaignId, workspaceId, whatsappAccountId: campaignId });
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: expect.anything(), apiCampaignId: campaignId }));
    expect(response.json.mock.calls[0]?.[0]).toMatchObject({ data: { items: [{ id: '64b000000000000000000010' }, { id: '64b000000000000000000009' }], nextCursor: '64b000000000000000000009' } });
  });

  it('scopes execution detail to both campaign and workspace', async () => {
    vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ lean: async () => ({ _id: campaignId }) } as never);
    const find = vi.spyOn(ApiCampaignExecution, 'findOne').mockReturnValue({ lean: async () => ({ _id: executionId, apiCampaignId: campaignId, status: 'FAILED' }) } as never);
    const response = { json: vi.fn() };
    const next = vi.fn();
    getExecution({ workspaceContext: { workspaceId }, params: { id: campaignId, executionId }, query: {}, requestId: 'test' } as never, response as never, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalled());
    expect(find).toHaveBeenCalledWith({ _id: executionId, apiCampaignId: campaignId, workspaceId });
  });

  it('re-enqueues only a matching RECEIVED replay, with no new execution', async () => {
    const execution = { _id: executionId, workspaceId, apiCampaignId: campaignId, requestFingerprint: triggerFingerprint({ destination: body.destination, params: [], userName: undefined, tags: [], attributes: {}, media: undefined, source: 'EXTERNAL_API' }), status: 'RECEIVED' };
    vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ lean: async () => campaign } as never);
    vi.spyOn(ApiCampaignExecution, 'findOne').mockReturnValue({ select: async () => execution } as never);
    const claimed = vi.spyOn(ApiCampaignExecution, 'findOneAndUpdate').mockImplementation(async (_filter, update) => ({ ...execution, status: 'QUEUED', queuedAt: (update as { $set: { queuedAt: Date } }).$set.queuedAt }) as never);
    const created = vi.spyOn(ApiCampaignExecution, 'create');
    const enqueue = vi.fn(async () => undefined);
    const result = await triggerApiCampaign({ workspaceId, credentialId, idempotencyKey: 'payment-event-1', body }, { enqueue });
    expect(result.replay).toBe(true);
    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith({ executionId });
    expect(created).not.toHaveBeenCalled();
    expect(claimed).toHaveBeenCalledOnce();
  });

  it('restores RECEIVED after an enqueue outage so the same key can safely replay', async () => {
    const execution = { _id: executionId, workspaceId, apiCampaignId: campaignId, requestFingerprint: triggerFingerprint({ destination: body.destination, params: [], userName: undefined, tags: [], attributes: {}, media: undefined, source: 'EXTERNAL_API' }), status: 'RECEIVED' };
    vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ lean: async () => campaign } as never);
    vi.spyOn(ApiCampaignExecution, 'findOne').mockReturnValue({ select: async () => execution } as never);
    vi.spyOn(ApiCampaignExecution, 'findOneAndUpdate').mockImplementation(async (_filter, update) => ({ ...execution, status: 'QUEUED', queuedAt: (update as { $set: { queuedAt: Date } }).$set.queuedAt }) as never);
    const rollback = vi.spyOn(ApiCampaignExecution, 'updateOne').mockResolvedValue({} as never);
    const enqueue = vi.fn().mockRejectedValueOnce(new Error('Redis offline')).mockResolvedValueOnce(undefined);
    const input = { workspaceId, credentialId, idempotencyKey: 'payment-event-1', body };
    await expect(triggerApiCampaign(input, { enqueue })).rejects.toMatchObject({ code: 'QUEUE_UNAVAILABLE' });
    expect(rollback).toHaveBeenCalledWith(expect.objectContaining({ _id: executionId, workspaceId, status: 'QUEUED' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'RECEIVED' }) }));
    const replay = await triggerApiCampaign(input, { enqueue });
    expect(replay.replay).toBe(true);
    expect(enqueue).toHaveBeenCalledTimes(2);
  });

  it('blocks manual retry after ambiguous provider submission', async () => {
    vi.spyOn(ApiCampaignExecution, 'findOne').mockResolvedValue({ _id: executionId, status: 'FAILED', retrySafety: 'UNCERTAIN', metaMessageId: 'wamid.provider', whatsappMessageId: campaignId } as never);
    await expect(retryApiCampaignExecution({ workspaceId, campaignId, executionId })).rejects.toMatchObject({ code: 'RETRY_BLOCKED' });
  });

  it('blocks legacy permanent 131042 failures even without a provider ID', async () => {
    const original = { _id: executionId, status: 'FAILED', failureCode: '131042', campaignSlug: 'payment_success', destination: body.destination, resolvedTemplateParams: [], tags: [], attributes: {}, source: 'EXTERNAL_API' };
    vi.spyOn(ApiCampaignExecution, 'findOne').mockResolvedValue(original as never);
    const create = vi.spyOn(ApiCampaignExecution, 'create');
    const enqueue = vi.fn(async () => undefined);
    await expect(retryApiCampaignExecution({ workspaceId, campaignId, executionId }, { enqueue })).rejects.toMatchObject({ code: 'RETRY_BLOCKED' });
    expect(create).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('classifies explicit provider rejection as safe and ambiguous submission as uncertain', () => {
    expect(classifyApiCampaignFailure(new AppError(409, 'INVALID_TEMPLATE', 'Unavailable'), false)).toMatchObject({ failureCategory: 'VALIDATION', retrySafety: 'PERMANENT', autoRetry: false });
    expect(classifyApiCampaignFailure(new MetaGraphError('Rejected', 400, 'META_REJECTED', { code: 131042 }), true)).toMatchObject({ failureCategory: 'META_PERMANENT', retrySafety: 'PERMANENT', autoRetry: false });
    expect(classifyApiCampaignFailure(new Error('timeout'), true)).toMatchObject({ failureCategory: 'META_TRANSIENT', retrySafety: 'UNCERTAIN', autoRetry: false });
    expect(classifyApiCampaignFailure(new ProviderSendError('Transport disabled', 503, 'META_TRANSPORT_DISABLED'), true)).toMatchObject({ failureCategory: 'META_TRANSIENT', retrySafety: 'UNCERTAIN', autoRetry: false });
    expect(safeApiCampaignFailure(new MetaGraphError('Rejected', 400, '131042', { code: 131042 }))).toMatchObject({ failureCode: '131042', failureTitle: 'Payment setup required' });
    expect(JSON.stringify(safeApiCampaignFailure(new AppError(409, 'INVALID_MEDIA', 'Bearer secret-token is unavailable at https://example.com/secret')))).not.toContain('secret-token');
  });
});
