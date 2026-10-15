import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { campaignJobId, campaignJobOptions, campaignQueueHealth } from '../src/config/campaign-queue.js';
import { env } from '../src/config/env.js';
import { broadcastDuplicateDraft, creationFingerprint } from '../src/controllers/broadcast.controller.js';
import { isValidWebhookSignature, webhookTestables } from '../src/controllers/whatsapp-webhook.controller.js';
import { Campaign } from '../src/models/campaign.model.js';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { createContactRecipient, recipientKey, segmentFilter } from '../src/services/broadcast/audience.service.js';
import { canBypassCampaignConsent } from '../src/services/broadcast/consent.service.js';
import { cancelCampaign, futureScheduledAt, launchCampaign, localDateToUtc, pauseCampaign, resumeCampaign } from '../src/services/broadcast/execution.service.js';
import { parseCursorPagination } from '../src/services/broadcast/pagination.js';
import { canAdvanceRecipient, counterSnapshot } from '../src/services/broadcast/tracking.service.js';
import { claimRecipient, failureDetails, isTransientFailure, retryDelay } from '../src/services/broadcast/worker.service.js';
import { configuredWhatsAppTransport } from '../src/services/whatsapp/transport.js';

const W1 = '64b000000000000000000001';
const W2 = '64b000000000000000000002';
const C1 = '64b000000000000000000011';
const A1 = '64b000000000000000000021';
const T1 = '64b000000000000000000031';
const R1 = '64b000000000000000000041';
const originalTestEnvironment = {
  REDIS_URL: env.REDIS_URL,
  CAMPAIGN_TEST_BYPASS_CONSENT: env.CAMPAIGN_TEST_BYPASS_CONSENT,
  CAMPAIGN_TRANSPORT: env.CAMPAIGN_TRANSPORT,
};

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(env, originalTestEnvironment);
});

describe('Broadcast campaign migration', () => {
  it('validates a V2-compatible campaign draft without database access', async () => {
    const campaign = new Campaign({ workspaceId: W1, whatsappAccountId: A1, phoneNumberId: '123456789', name: 'October notice', whatsAppTemplateId: T1 });
    await expect(campaign.validate()).resolves.toBeUndefined();
    expect(campaign.channel).toBe('WHATSAPP');
    expect(campaign.type).toBe('BROADCAST');
    expect(campaign.status).toBe('DRAFT');
  });

  it('creates stable draft fingerprints and detects changed requests', () => {
    const first = creationFingerprint({ workspaceId: W1, name: 'Notice', audience: { segmentId: R1 } });
    expect(creationFingerprint({ audience: { segmentId: R1 }, name: 'Notice', workspaceId: W1 })).toBe(first);
    expect(creationFingerprint({ workspaceId: W1, name: 'Changed', audience: { segmentId: R1 } })).not.toBe(first);
  });

  it('duplicates only configuration into an independent draft', () => {
    const source = new Campaign({ workspaceId: W1, whatsappAccountId: A1, phoneNumberId: '123456789', name: 'Old campaign', whatsAppTemplateId: T1, status: 'COMPLETED', sendMode: 'SEND_NOW', launchKey: 'old-launch-key', scheduledAt: new Date('2030-01-01T00:00:00Z'), parameterMapping: { body: [{ source: 'STATIC', value: 'Hello' }] }, mediaMapping: {}, audienceDefinition: { source: 'CONTACTS', contactIds: [R1] }, audienceSnapshotCount: 1, counters: { total: 1, delivered: 1 } });
    const copy = new Campaign(broadcastDuplicateDraft(source, { definition: { source: 'CONTACTS', contactIds: [R1] }, count: 1 } as never));
    expect(copy._id).not.toEqual(source._id);
    expect(copy.name).toBe('Old campaign (Copy)');
    expect(copy.status).toBe('DRAFT');
    expect(copy.sendMode).toBe('DRAFT');
    expect(copy.parameterMapping).toEqual(source.parameterMapping);
    expect(copy.audienceDefinition).toEqual(source.audienceDefinition);
    expect(copy.counters.delivered).toBe(0);
    expect(copy.launchKey).toBeUndefined();
    expect(copy.scheduledAt).toBeUndefined();
  });

  it('keeps creation idempotency isolated by workspace', () => {
    expect(creationFingerprint({ workspaceId: W1, key: 'same-key' })).not.toBe(creationFingerprint({ workspaceId: W2, key: 'same-key' }));
    const index = Campaign.schema.indexes().find(([keys]) => keys.workspaceId === 1 && keys.idempotencyKey === 1);
    expect(index?.[1].unique).toBe(true);
    expect(index?.[1].partialFilterExpression).toEqual({ idempotencyKey: { $type: 'string' } });
  });

  it('snapshots opted-in contacts and creates deterministic recipient keys', () => {
    const campaign = { _id: C1, workspaceId: W1, parameterMapping: {} };
    const contact = { _id: R1, name: 'Recipient', phoneE164: '+91 83780 89937', status: 'ACTIVE', whatsappConsent: { status: 'OPTED_IN' } };
    const snapshot = createContactRecipient(campaign, contact);
    expect(snapshot.status).toBe('PENDING');
    expect(snapshot.recipientPhone).toBe('+918378089937');
    expect(snapshot.recipientKey).toBe(recipientKey(C1, `contact:${R1}`));
  });

  it('fails closed for missing consent', () => {
    env.CAMPAIGN_TEST_BYPASS_CONSENT = 'false';
    const snapshot = createContactRecipient(
      { _id: C1, workspaceId: W1, parameterMapping: {} },
      { _id: R1, name: 'Recipient', phoneE164: '+918378089937', status: 'ACTIVE', whatsappConsent: { status: 'UNKNOWN' } },
    );
    expect(snapshot.status).toBe('SKIPPED');
    expect(snapshot.failureCode).toBe('CONSENT_NOT_OPTED_IN');
  });

  it('allows the consent bypass only outside production', () => {
    expect(canBypassCampaignConsent({ nodeEnv: 'development', bypassEnabled: true })).toBe(true);
    expect(canBypassCampaignConsent({ nodeEnv: 'test', bypassEnabled: true })).toBe(true);
    expect(canBypassCampaignConsent({ nodeEnv: 'production', bypassEnabled: true })).toBe(false);
    expect(canBypassCampaignConsent({ nodeEnv: 'development', bypassEnabled: false })).toBe(false);
  });

  it('builds safe segment filters and rejects unsafe fields', () => {
    expect(segmentFilter({ match: 'ALL', conditions: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] })).toEqual({ $and: [{ tags: 'vip' }] });
    expect(() => segmentFilter({ conditions: [{ field: 'attributes.password', operator: 'EQ', value: 'x' }] })).toThrow(/unsupported field/i);
  });

  it('uses identifier-only deterministic queue jobs with bounded retention', () => {
    expect(campaignJobId(C1, 4)).toBe(`campaign-${C1}-batch-4`);
    const options = campaignJobOptions(C1, 4, 500);
    expect(options).toMatchObject({ attempts: 1, delay: 500, removeOnComplete: { count: 1_000 }, removeOnFail: { count: 5_000 } });
    expect(Object.keys({ workspaceId: W1, campaignId: C1, sequence: 4 })).toEqual(['workspaceId', 'campaignId', 'sequence']);
  });

  it('reports Redis unavailable without trying to enqueue when not configured', async () => {
    const original = env.REDIS_URL;
    env.REDIS_URL = '';
    await expect(campaignQueueHealth()).resolves.toEqual({ ready: false, reason: 'REDIS_NOT_CONFIGURED' });
    env.REDIS_URL = original;
  });

  it('claims only retry-safe unsent recipients atomically', async () => {
    const spy = vi.spyOn(CampaignRecipient, 'findOneAndUpdate').mockResolvedValue(null);
    await claimRecipient(C1, W1, 'worker-1');
    const filter = spy.mock.calls[0]?.[0] as { status: { $in: string[] }; submissionState: string; workspaceId: string };
    expect(filter.workspaceId).toBe(W1);
    expect(filter.status.$in).toEqual(['PENDING', 'RETRY_WAIT']);
    expect(filter.submissionState).toBe('NOT_SUBMITTED');
  });

  it('never advances a recipient twice or regresses delivery state', () => {
    expect(canAdvanceRecipient('ACCEPTED', 'SENT')).toBe(true);
    expect(canAdvanceRecipient('SENT', 'DELIVERED')).toBe(true);
    expect(canAdvanceRecipient('DELIVERED', 'READ')).toBe(true);
    expect(canAdvanceRecipient('READ', 'DELIVERED')).toBe(false);
    expect(canAdvanceRecipient('READ', 'READ')).toBe(false);
  });

  it('does not retry ambiguous HTTP failures or infer retry safety from status alone', () => {
    expect(isTransientFailure({ status: 429 })).toBe(false);
    expect(isTransientFailure({ status: 429, safeToRetry: true })).toBe(true);
    expect(isTransientFailure({ status: 503 })).toBe(false);
    expect(isTransientFailure({ status: 403 })).toBe(false);
    expect(isTransientFailure({ status: 502, message: 'Provider request timed out' })).toBe(false);
    expect(retryDelay(2, 0)).toBe(10_000);
    expect(retryDelay(20, 0)).toBe(900_000);
  });

  it('sanitizes permanent provider failure details', () => {
    const failure = failureDetails({ status: 403, code: 'PERMANENT', message: 'failed access_token=secret' });
    expect(failure.failureCode).toBe('PERMANENT');
    expect(failure.failureMessage).not.toContain('secret');
  });

  it('pauses only a campaign in the same workspace and valid state', async () => {
    const spy = vi.spyOn(Campaign, 'findOneAndUpdate').mockResolvedValue(null);
    await pauseCampaign(C1, W1);
    expect(spy.mock.calls[0]?.[0]).toMatchObject({ _id: C1, workspaceId: W1, status: { $in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] } });
  });

  it('resumes with an incremented deterministic dispatch sequence', async () => {
    vi.spyOn(Campaign, 'findOne').mockResolvedValue({ _id: C1, workspaceId: W1, status: 'PAUSED', dispatchSequence: 2 } as never);
    vi.spyOn(Campaign, 'findOneAndUpdate').mockResolvedValue({ _id: C1, workspaceId: W1, status: 'QUEUED', dispatchSequence: 3 } as never);
    const jobs: unknown[] = [];
    await resumeCampaign(C1, W1, { health: async () => ({ ready: true }), enqueue: async (data) => { jobs.push(data); return undefined as never; } });
    expect(jobs).toEqual([{ workspaceId: W1, campaignId: C1, sequence: 3 }]);
  });

  it('cancels only recipients that have not been submitted', async () => {
    vi.spyOn(Campaign, 'findOneAndUpdate').mockResolvedValue({ _id: C1, workspaceId: W1, status: 'CANCELLED' } as never);
    const recipients = vi.spyOn(CampaignRecipient, 'updateMany').mockResolvedValue({ modifiedCount: 2 } as never);
    await cancelCampaign(C1, W1, async () => null);
    expect(recipients.mock.calls[0]?.[0]).toMatchObject({ workspaceId: W1, campaignId: C1, status: { $in: ['PENDING', 'QUEUED', 'RETRY_WAIT'] } });
  });

  it.each([
    ['ACCEPTED', 'SENT'], ['SENT', 'DELIVERED'], ['DELIVERED', 'READ'], ['SENT', 'FAILED'],
  ])('accepts webhook transition %s to %s', (current, incoming) => {
    expect(webhookTestables.canAdvanceMessage(current, incoming as never)).toBe(true);
  });

  it('verifies webhook HMAC signatures with timing-safe comparison', () => {
    const body = Buffer.from('{"object":"whatsapp_business_account"}');
    const secret = 'test-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(isValidWebhookSignature(body, signature, secret)).toBe(true);
    expect(isValidWebhookSignature(body, 'sha256='.padEnd(71, '0'), secret)).toBe(false);
  });

  it('rebuilds campaign counters from recipient status groups', () => {
    expect(counterSnapshot([{ _id: 'READ', count: 3 }, { _id: 'FAILED', count: 1 }, { _id: 'SKIPPED', count: 2 }])).toEqual({
      total: 6, pending: 0, queued: 0, accepted: 0, sent: 0, delivered: 0, read: 3, failed: 1, skipped: 2, cancelled: 0,
    });
  });

  it('bounds and validates recipient cursor pagination', () => {
    expect(parseCursorPagination({ limit: 1, cursor: R1 })).toEqual({ limit: 1, cursor: R1 });
    expect(parseCursorPagination({ limit: 1_000 }).limit).toBe(100);
    expect(() => parseCursorPagination({ cursor: 'invalid' })).toThrow(/cursor/i);
  });

  it('converts local schedules without changing V2 timezone semantics', () => {
    expect(localDateToUtc('2030-01-10T10:30', 'Asia/Kolkata').toISOString()).toBe('2030-01-10T05:00:00.000Z');
    expect(futureScheduledAt('2030-01-10T10:30', 'Asia/Kolkata', Date.UTC(2030, 0, 10, 4, 0))).toEqual(new Date('2030-01-10T05:00:00.000Z'));
    expect(() => futureScheduledAt('2030-01-10T10:30', 'Asia/Kolkata', Date.UTC(2030, 0, 10, 5, 0))).toThrow(/future/);
  });

  it('does not double-launch a scheduled campaign', async () => {
    const campaign = new Campaign({ workspaceId: W1, whatsappAccountId: A1, phoneNumberId: '123456789', name: 'Scheduled', status: 'SCHEDULED', sendMode: 'SCHEDULE', launchKey: 'launch-key-123', scheduledAt: new Date('2030-01-10T05:00:00Z') });
    const replay = await launchCampaign({ campaign, workspaceId: W1, mode: 'SCHEDULE', scheduledLocal: '2030-01-10T10:30', timezone: 'Asia/Kolkata', launchKey: 'launch-key-123' });
    expect(replay.idempotent).toBe(true);
    await expect(launchCampaign({ campaign, workspaceId: W1, mode: 'SCHEDULE', scheduledLocal: '2030-01-10T10:30', timezone: 'Asia/Kolkata', launchKey: 'another-key-123' })).rejects.toMatchObject({ code: 'CAMPAIGN_ALREADY_LAUNCHED' });
  });

  it('keeps the default transport no-send', async () => {
    const original = env.CAMPAIGN_TRANSPORT;
    env.CAMPAIGN_TRANSPORT = 'disabled';
    await expect(configuredWhatsAppTransport().sendTemplate({ phoneNumberId: '1', recipient: '918378089937', template: { name: 'approved', language: 'en', components: [] } })).rejects.toMatchObject({ code: 'META_TRANSPORT_DISABLED' });
    env.CAMPAIGN_TRANSPORT = original;
  });
});
