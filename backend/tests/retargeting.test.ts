import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { requireRetargetingAccess } from '../src/middleware/require-retargeting-access.js';
import { Campaign } from '../src/models/campaign.model.js';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { Contact } from '../src/models/contact.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';
import { createRetargetDraft, recheckRetargetSource, retargetExclusion, retargetOutcome, retargetPreview, retargetSenderStillBound, retargetTemplates } from '../src/services/broadcast/retargeting.service.js';
import { recheckConsent } from '../src/services/broadcast/worker.service.js';

const workspaceId = '64b000000000000000000001';
const accountId = '64b000000000000000000002';
const phone = '+919999999999';
const contact = { status: 'ACTIVE', phoneE164: phone, name: 'Test', whatsappConsent: { status: 'OPTED_IN', accountId, source: 'form', evidence: 'test evidence' } };
const base = { status: 'READ', recipientPhone: phone, contactId: '64b000000000000000000003' };
const originalBypass = env.CAMPAIGN_TEST_BYPASS_CONSENT;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); env.CAMPAIGN_TEST_BYPASS_CONSENT = originalBypass; });

describe('retargeting outcomes and isolation', () => {
  it('uses read above delivered above failed and excludes ambiguous failures', () => {
    expect(retargetOutcome({ status: 'FAILED', readAt: new Date(), deliveredAt: new Date(), failedAt: new Date(), failureSource: 'META_WEBHOOK' })).toBe('READ');
    expect(retargetOutcome({ status: 'FAILED', deliveredAt: new Date(), failedAt: new Date(), failureSource: 'META_WEBHOOK' })).toBe('DELIVERED');
    expect(retargetOutcome({ status: 'FAILED', failedAt: new Date(), failureSource: 'META_WEBHOOK', submissionState: 'ACCEPTED' })).toBe('FAILED');
    expect(retargetOutcome({ status: 'FAILED', failedAt: new Date(), failureSource: 'META_API', submissionState: 'UNCERTAIN' })).toBe('UNVERIFIED');
    expect(retargetOutcome({ status: 'FAILED', failedAt: new Date(), failureSource: 'WORKER' })).toBe('UNVERIFIED');
  });

  it('selects READ, DELIVERED_NOT_READ and confirmed FAILED only', () => {
    expect(retargetExclusion(base as never, contact as never, 'READ', accountId, new Set())).toBeNull();
    expect(retargetExclusion({ ...base, status: 'DELIVERED' } as never, contact as never, 'DELIVERED_NOT_READ', accountId, new Set())).toBeNull();
    expect(retargetExclusion({ ...base, status: 'FAILED', failedAt: new Date(), failureSource: 'META_WEBHOOK' } as never, contact as never, 'FAILED', accountId, new Set())).toBeNull();
    expect(retargetExclusion({ ...base, status: 'ACCEPTED' } as never, contact as never, 'FAILED', accountId, new Set())).toBe('UNVERIFIED_OUTCOME');
  });

  it('deduplicates, rejects opt-outs, inactive contacts, wrong WABA and changed phones', () => {
    const seen = new Set<string>();
    expect(retargetExclusion(base as never, contact as never, 'READ', accountId, seen)).toBeNull();
    expect(retargetExclusion(base as never, contact as never, 'READ', accountId, seen)).toBe('DUPLICATE');
    expect(retargetExclusion(base as never, { ...contact, optedOutAt: new Date() } as never, 'READ', accountId, new Set())).toBe('CONSENT_UNAVAILABLE');
    expect(retargetExclusion(base as never, { ...contact, status: 'BLOCKED' } as never, 'READ', accountId, new Set())).toBe('CONTACT_INACTIVE');
    expect(retargetExclusion(base as never, contact as never, 'READ', workspaceId, new Set())).toBe('CONSENT_UNAVAILABLE');
    expect(retargetExclusion(base as never, { ...contact, phoneE164: '+918888888888' } as never, 'READ', accountId, new Set())).toBe('PHONE_CHANGED');
  });

  it('declares source linkage and immutable recipient lineage without changing existing indexes', () => {
    expect(Campaign.schema.path('sourceCampaignId')).toBeDefined();
    expect(Campaign.schema.path('retargetingFilter')).toBeDefined();
    expect(CampaignRecipient.schema.path('sourceRecipientId')).toBeDefined();
    expect(Campaign.schema.indexes().find(([keys]) => keys.workspaceId === 1 && keys.idempotencyKey === 1)?.[1].unique).toBe(true);
  });

  it('denies localhost, spoofed headers and public tunnel requests before workspace or database access', () => {
    for (const environment of ['development', 'production']) {
      for (const origin of ['http://localhost:5173', 'https://example-5173.devtunnels.ms']) {
        const next = vi.fn();
        requireRetargetingAccess({ headers: { origin, 'x-workspace-id': workspaceId }, socket: { remoteAddress: '127.0.0.1' }, env: environment } as never, {} as never, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'RETARGETING_AUTH_REQUIRED', statusCode: 503 }));
      }
    }
  });

  it('returns fail-closed HTTP errors for read and write endpoints before touching data', async () => {
    const find = vi.spyOn(Campaign, 'findOne');
    const app = createApp();
    const path = '/api/campaigns/64b000000000000000000010/retargeting';
    const preview = await request(app).get(`${path}/preview?filter=READ`).set('Origin', 'https://example-5173.devtunnels.ms');
    const draft = await request(app).post(`${path}/draft`).set('Origin', 'http://localhost:5173').set('Idempotency-Key', 'test-key-123').send({ filter: 'READ' });
    expect(preview.status).toBe(503);
    expect(preview.body.error.code).toBe('RETARGETING_AUTH_REQUIRED');
    expect(draft.status).toBe(503);
    expect(draft.body.error.code).toBe('RETARGETING_AUTH_REQUIRED');
    expect(find).not.toHaveBeenCalled();
  });

  it('disallows development consent bypass for retargeted recipients at worker recheck', async () => {
    env.CAMPAIGN_TEST_BYPASS_CONSENT = 'true';
    vi.spyOn(Contact, 'findOne').mockReturnValue({ lean: async () => ({ status: 'ACTIVE', phoneE164: phone, whatsappConsent: { status: 'UNKNOWN' } }) } as never);
    const result = await recheckConsent({ workspaceId, campaignId: '64b000000000000000000010', whatsappAccountId: accountId, contactId: base.contactId, recipientPhone: phone, strictConsent: true });
    expect(result).toMatchObject({ eligible: false, code: 'CONSENT_NOT_OPTED_IN' });
  });

  it('blocks an opt-out recorded after the retargeting snapshot', async () => {
    vi.spyOn(Contact, 'findOne').mockReturnValue({ lean: async () => ({ status: 'ACTIVE', phoneE164: phone, optedOutAt: new Date(), whatsappConsent: contact.whatsappConsent }) } as never);
    await expect(recheckConsent({ workspaceId, campaignId: '64b000000000000000000010', whatsappAccountId: accountId, contactId: base.contactId, recipientPhone: phone, strictConsent: true }))
      .resolves.toMatchObject({ eligible: false, code: 'CONSENT_OPTED_OUT' });
  });

  it('rechecks the exact source recipient and skips a late read of a delivered-not-read recipient', async () => {
    const sourceId = new mongoose.Types.ObjectId('64b000000000000000000010');
    const recipientId = new mongoose.Types.ObjectId('64b000000000000000000030');
    const find = vi.spyOn(CampaignRecipient, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({ status: 'READ', readAt: new Date() }) }) } as never);
    expect(await recheckRetargetSource(workspaceId, sourceId, recipientId, 'DELIVERED_NOT_READ')).toBe(false);
    expect(find).toHaveBeenCalledWith({ _id: recipientId, workspaceId, campaignId: sourceId });
    expect(await recheckRetargetSource(workspaceId, sourceId, undefined, 'READ')).toBe(false);
    expect(find).toHaveBeenCalledOnce();
  });

  it('fails closed when original WABA binding is missing or disconnected', async () => {
    const exists = vi.spyOn(WhatsAppAccount, 'exists').mockResolvedValue(null);
    expect(await retargetSenderStillBound(workspaceId, accountId, 'old-waba')).toBe(false);
    expect(exists).toHaveBeenCalledWith({ _id: accountId, workspaceId, status: 'CONNECTED', wabaId: 'old-waba' });
    expect(await retargetSenderStillBound(workspaceId, accountId, undefined)).toBe(false);
    expect(exists).toHaveBeenCalledOnce();
  });

  it('counts exclusions and cursor-pages masked eligible recipients without an active sender lookup', async () => {
    const sourceId = new mongoose.Types.ObjectId('64b000000000000000000010');
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const first = new mongoose.Types.ObjectId('64b000000000000000000031');
    const second = new mongoose.Types.ObjectId('64b000000000000000000032');
    const contactOne = new mongoose.Types.ObjectId('64b000000000000000000041');
    const contactTwo = new mongoose.Types.ObjectId('64b000000000000000000042');
    vi.spyOn(Campaign, 'findOne').mockReturnValue({ lean: async () => ({ _id: sourceId, whatsappAccountId: accountObjectId, status: 'COMPLETED', type: 'BROADCAST', name: 'Source' }) } as never);
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountObjectId }) } as never);
    const rows = [
      { _id: first, contactId: contactOne, recipientPhone: phone, status: 'READ' },
      { _id: second, contactId: contactTwo, recipientPhone: '+918888888888', status: 'READ' },
      { _id: new mongoose.Types.ObjectId('64b000000000000000000033'), status: 'ACCEPTED', recipientPhone: '+917777777777' },
    ];
    vi.spyOn(CampaignRecipient, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => rows }) }) } as never);
    vi.spyOn(Contact, 'find').mockReturnValue({ lean: async () => [
      { _id: contactOne, ...contact },
      { _id: contactTwo, ...contact, phoneE164: '+918888888888' },
    ] } as never);
    const firstPage = await retargetPreview({ workspaceId, sourceCampaignId: String(sourceId), filter: 'READ', limit: 1 });
    expect(firstPage).toMatchObject({ total: 3, eligible: 2, exclusions: { UNVERIFIED_OUTCOME: 1 }, nextCursor: String(first) });
    expect(firstPage.items[0]?.phone).not.toBe(phone);
    const nextPage = await retargetPreview({ workspaceId, sourceCampaignId: String(sourceId), filter: 'READ', cursor: String(first), limit: 1 });
    expect(nextPage.items).toHaveLength(1);
    expect(nextPage.items[0]?.sourceRecipientId).toBe(String(second));
  });

  it('lists only structurally compatible approved templates on the original WABA', async () => {
    const sourceId = new mongoose.Types.ObjectId('64b000000000000000000010');
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    vi.spyOn(Campaign, 'findOne').mockReturnValue({ lean: async () => ({ _id: sourceId, whatsappAccountId: accountObjectId, status: 'COMPLETED', type: 'BROADCAST', parameterMapping: {}, mediaMapping: {} }) } as never);
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountObjectId }) } as never);
    const find = vi.spyOn(WhatsAppTemplate, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [
      { _id: new mongoose.Types.ObjectId('64b000000000000000000021'), name: 'simple', language: 'en', components: [{ type: 'BODY', text: 'Hello' }] },
      { _id: new mongoose.Types.ObjectId('64b000000000000000000022'), name: 'needs_variable', language: 'en', components: [{ type: 'BODY', text: 'Hello {{1}}' }] },
    ] }) }) } as never);
    const templates = await retargetTemplates(workspaceId, String(sourceId));
    expect(templates.map((item) => item.name)).toEqual(['simple']);
    expect(find).toHaveBeenCalledWith({ workspaceId, whatsappAccountId: accountObjectId, status: 'APPROVED', isActive: true });
  });

  it('builds an isolated immutable follow-up draft with mocked Mongo only, never a send or queue job', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound request'); }));
    const sourceId = new mongoose.Types.ObjectId('64b000000000000000000010');
    const accountObjectId = new mongoose.Types.ObjectId(accountId);
    const templateId = new mongoose.Types.ObjectId('64b000000000000000000020');
    const recipientId = new mongoose.Types.ObjectId('64b000000000000000000030');
    const contactId = new mongoose.Types.ObjectId(base.contactId);
    const draftId = new mongoose.Types.ObjectId('64b000000000000000000040');
    const source = { _id: sourceId, workspaceId, whatsappAccountId: accountObjectId, phoneNumberId: 'test-sender', name: 'Source', status: 'COMPLETED', type: 'BROADCAST', parameterMapping: {}, mediaMapping: {}, timezone: 'UTC' };
    vi.spyOn(Campaign, 'findOne').mockImplementation((filter) => filter && '_id' in filter ? { lean: async () => source } as never : { select: async () => null } as never);
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountObjectId, workspaceId, wabaId: 'test-waba' }) } as never);
    vi.spyOn(WhatsAppTemplate, 'findOne').mockReturnValue({ lean: async () => ({ _id: templateId, name: 'approved_test', language: 'en', category: 'MARKETING', status: 'APPROVED', metaTemplateId: 'template-test', components: [{ type: 'BODY', text: 'Hello' }] }) } as never);
    const findRecipients = vi.spyOn(CampaignRecipient, 'find').mockReturnValueOnce({ sort: () => ({ limit: () => ({ lean: async () => [{ _id: recipientId, contactId, recipientPhone: phone, status: 'READ' }] }) }) } as never)
      .mockReturnValueOnce({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) } as never);
    vi.spyOn(Contact, 'find').mockReturnValue({ lean: async () => [{ _id: contactId, ...contact }] } as never);
    const create = vi.spyOn(Campaign, 'create').mockResolvedValue([{ _id: draftId }] as never);
    const insert = vi.spyOn(CampaignRecipient, 'insertMany').mockResolvedValue([] as never);
    const update = vi.spyOn(Campaign, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({ withTransaction: async (fn: () => Promise<void>) => fn(), endSession: async () => undefined } as never);
    const result = await createRetargetDraft({ workspaceId, sourceCampaignId: String(sourceId), filter: 'READ', templateId: String(templateId), name: 'Follow-up', idempotencyKey: 'retarget-test-key' });
    expect(result).toMatchObject({ campaignId: String(draftId), idempotent: false, snapshotCount: 1 });
    expect(findRecipients).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, campaignId: sourceId }));
    expect(create).toHaveBeenCalledWith([expect.objectContaining({ status: 'DRAFT', sourceCampaignId: sourceId, whatsappAccountId: accountObjectId, retargetingSourceWabaId: 'test-waba', retargetingFilter: 'READ', audienceDefinition: { source: 'RETARGET', sourceCampaignId: String(sourceId) } })], expect.anything());
    expect(insert).toHaveBeenCalledWith([expect.objectContaining({ campaignId: draftId, sourceRecipientId: recipientId, sourceStatus: 'READ', recipientPhone: phone, status: 'PENDING', consentSnapshot: expect.objectContaining({ accountId, status: 'OPTED_IN' }) })], expect.anything());
    expect(update).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });
});
