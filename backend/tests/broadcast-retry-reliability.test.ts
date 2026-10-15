import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

// This file never imports runtime env, queue clients, Graph transport or DB
// connectors. Every side-effect boundary is mocked before worker import.
vi.mock('../src/config/env.js', () => ({ env: { CAMPAIGN_BATCH_SIZE: 10, CAMPAIGN_TRANSPORT: 'mock', CAMPAIGN_LIVE_SEND_ENABLED: 'true' } }));
vi.mock('../src/config/campaign-queue.js', () => ({ enqueueCampaign: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/broadcast/execution.service.js', () => ({ liveSendEnabled: () => true, transportConfigured: () => true }));
vi.mock('../src/services/broadcast/retry.service.js', () => ({ activateFailedRetryBatch: vi.fn().mockResolvedValue({ inspected: 0, hasMore: false }) }));
vi.mock('../src/services/broadcast/consent.service.js', () => ({ canBypassCampaignConsent: () => false, logConsentBypass: vi.fn() }));
vi.mock('../src/services/whatsapp/consent-scope.service.js', () => ({ hasSenderConsent: () => true }));
vi.mock('../src/services/whatsapp/send-approved-template.service.js', () => ({ buildTemplatePayload: vi.fn().mockReturnValue({}), sendApprovedTemplateMessage: vi.fn() }));

import { Campaign } from '../src/models/campaign.model.js';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { Contact } from '../src/models/contact.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';
import { sendApprovedTemplateMessage } from '../src/services/whatsapp/send-approved-template.service.js';
import { processCampaignJob, reconcileCampaignWork } from '../src/services/broadcast/worker.service.js';
import { propagateMessageStatus } from '../src/services/broadcast/tracking.service.js';

const workspaceId = new Types.ObjectId();
const campaignId = new Types.ObjectId();
const recipientId = new Types.ObjectId();
const accountId = new Types.ObjectId();
const contactId = new Types.ObjectId();
const job = (id: string) => ({ id, data: { workspaceId: String(workspaceId), campaignId: String(campaignId), sequence: 1 } }) as never;
const query = <T>(value: T) => ({ then: (resolve: (value: T) => unknown) => Promise.resolve(value).then(resolve), select() { return this; }, lean: async () => value, sort() { return this; }, limit() { return this; } });

let campaign: Record<string, unknown>;
let recipient: Record<string, unknown>;
let messages: Array<Record<string, unknown>>;

function applyUpdate(target: Record<string, unknown>, update: Record<string, unknown>) {
  Object.assign(target, update.$set as object ?? {});
  for (const key of Object.keys(update.$unset as object ?? {})) delete target[key];
  for (const [key, value] of Object.entries(update.$inc as object ?? {})) target[key] = Number(target[key] ?? 0) + Number(value);
  for (const [key, value] of Object.entries(update.$push as object ?? {})) {
    const push = value as { $each?: unknown[] };
    target[key] = [...(target[key] as unknown[] ?? []), ...(push.$each ?? [])];
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound HTTP request'); }));
  const rejectNetwork = () => { throw new Error('Unexpected outbound network request'); };
  vi.spyOn(net, 'connect').mockImplementation(rejectNetwork as never);
  vi.spyOn(net, 'createConnection').mockImplementation(rejectNetwork as never);
  vi.spyOn(tls, 'connect').mockImplementation(rejectNetwork as never);
  vi.spyOn(http, 'request').mockImplementation(rejectNetwork as never);
  vi.spyOn(https, 'request').mockImplementation(rejectNetwork as never);
  campaign = { _id: campaignId, workspaceId, whatsappAccountId: accountId, phoneNumberId: 'test-phone-id', whatsAppTemplateId: new Types.ObjectId(), retryBatchId: 'test-batch', status: 'PROCESSING', templateSnapshot: { name: 'test', language: 'en_US' }, dispatchSequence: 1 };
  recipient = { _id: recipientId, workspaceId, campaignId, contactId, recipientPhone: '+10000000000', status: 'RETRY_WAIT', submissionState: 'NOT_SUBMITTED', retryBatchId: 'test-batch', attemptCount: 1, attemptHistory: [], resolvedParameters: {} };
  messages = [];
  vi.spyOn(Campaign, 'findOne').mockImplementation((filter: never) => query((filter as { $or?: unknown }).$or ? [] : campaign) as never);
  vi.spyOn(Campaign, 'find').mockImplementation(() => query([]) as never);
  vi.spyOn(Campaign, 'findOneAndUpdate').mockImplementation(async () => { campaign.status = 'PROCESSING'; return campaign as never; });
  vi.spyOn(Campaign, 'updateOne').mockResolvedValue({ acknowledged: true } as never);
  vi.spyOn(CampaignRecipient, 'findOneAndUpdate').mockImplementation(async (filter: never, update: never) => {
    const f = filter as Record<string, unknown>;
    if (f._id && String(f._id) !== String(recipientId)) return null;
    if (typeof f.status === 'string' && recipient.status !== f.status) return null;
    if ((f.status as { $in?: string[] })?.$in && !(f.status as { $in: string[] }).$in.includes(String(recipient.status))) return null;
    if (f.submissionState && f.submissionState !== recipient.submissionState) return null;
    applyUpdate(recipient, update as Record<string, unknown>);
    return { ...recipient } as never;
  });
  vi.spyOn(CampaignRecipient, 'findOne').mockImplementation(() => query({ ...recipient }) as never);
  vi.spyOn(CampaignRecipient, 'find').mockImplementation(() => query(recipient.status === 'SENDING' ? [{ ...recipient }] : []) as never);
  vi.spyOn(CampaignRecipient, 'updateOne').mockImplementation(async (filter: never, update: never) => {
    const f = filter as Record<string, unknown>;
    if (!f.status || f.status === recipient.status) applyUpdate(recipient, update as Record<string, unknown>);
    return { acknowledged: true } as never;
  });
  vi.spyOn(CampaignRecipient, 'updateMany').mockResolvedValue({ acknowledged: true } as never);
  vi.spyOn(CampaignRecipient, 'aggregate').mockImplementation(async () => [{ _id: recipient.status, count: 1 }] as never);
  vi.spyOn(CampaignRecipient, 'exists').mockResolvedValue(null);
  vi.spyOn(Contact, 'findOne').mockImplementation(() => query({ _id: contactId, workspaceId, status: 'ACTIVE', phoneE164: recipient.recipientPhone, whatsappConsent: { status: 'OPTED_IN' } }) as never);
  vi.spyOn(WhatsAppMessage, 'findOne').mockImplementation((filter: never) => {
    const f = filter as Record<string, unknown>;
    return query(messages.find((message) => f.metaMessageId ? message.metaMessageId === f.metaMessageId : f.retryRecipientId ? String(message.retryRecipientId) === String(f.retryRecipientId) : false) ?? null) as never;
  });
});

describe('isolated Broadcast retry reliability', () => {
  it('two workers claim one recipient; only one mocked provider send occurs', async () => {
    vi.mocked(sendApprovedTemplateMessage).mockImplementation(async (input) => {
      input.onProviderSubmit?.();
      await Promise.resolve();
      return { recordId: new Types.ObjectId(), messageId: 'wamid.retry', acceptedAt: new Date() } as never;
    });
    await Promise.all([processCampaignJob(job('worker-a')), processCampaignJob(job('worker-b'))]);
    expect(sendApprovedTemplateMessage).toHaveBeenCalledTimes(1);
    expect(recipient.status).toBe('ACCEPTED');
  });

  it('restart before persisted acceptance marks submission uncertain and never resends', async () => {
    Object.assign(recipient, { status: 'SENDING', submissionState: 'SUBMITTING', leaseUntil: new Date(0) });
    await reconcileCampaignWork();
    expect(recipient.status).toBe('FAILED');
    expect(recipient.retrySafety).toBe('UNCERTAIN');
    await processCampaignJob(job('restart'));
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });

  it('restart after persisted acceptance recovers retry message, not original attempt', async () => {
    Object.assign(recipient, { status: 'SENDING', submissionState: 'SUBMITTING', leaseUntil: new Date(0), metaMessageId: 'wamid.original' });
    messages.push({ _id: new Types.ObjectId(), retryRecipientId: recipientId, metaMessageId: 'wamid.retry', acceptedAt: new Date(), status: 'ACCEPTED' });
    await reconcileCampaignWork();
    expect(recipient.status).toBe('ACCEPTED');
    expect(recipient.metaMessageId).toBe('wamid.retry');
    await processCampaignJob(job('restart'));
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });

  it('late old-attempt webhook cannot overwrite an accepted retry; current attempt advances', async () => {
    Object.assign(recipient, { status: 'ACCEPTED', metaMessageId: 'wamid.retry' });
    const base = { sendSource: 'CAMPAIGN', workspaceId, campaignId, retryRecipientId: recipientId };
    expect((await propagateMessageStatus({ message: { ...base, metaMessageId: 'wamid.original' }, incomingStatus: 'READ' })).outcome).toBe('staleAttempt');
    expect(recipient.status).toBe('ACCEPTED');
    expect((await propagateMessageStatus({ message: { ...base, metaMessageId: 'wamid.retry' }, incomingStatus: 'DELIVERED' })).outcome).toBe('updated');
    expect(recipient.status).toBe('DELIVERED');
    await processCampaignJob(job('after-webhook'));
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });

  it('late success before retry submission cancels the pending retry', async () => {
    Object.assign(recipient, { status: 'RETRY_WAIT', submissionState: 'NOT_SUBMITTED', metaMessageId: 'wamid.original' });
    const message = { sendSource: 'CAMPAIGN', workspaceId, campaignId, campaignRecipientId: recipientId, metaMessageId: 'wamid.original' };
    expect((await propagateMessageStatus({ message, incomingStatus: 'DELIVERED' })).outcome).toBe('updated');
    await processCampaignJob(job('after-delayed-webhook'));
    expect(recipient.status).toBe('DELIVERED');
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });

  it('old-attempt webhook during new provider submission cannot claim the retry status', async () => {
    Object.assign(recipient, { status: 'SENDING', submissionState: 'SUBMITTING', retryBatchId: 'test-batch', metaMessageId: 'wamid.original' });
    const message = { sendSource: 'CAMPAIGN', workspaceId, campaignId, campaignRecipientId: recipientId, metaMessageId: 'wamid.original' };
    expect((await propagateMessageStatus({ message, incomingStatus: 'DELIVERED' })).outcome).toBe('staleAttempt');
    expect(recipient.status).toBe('SENDING');
  });
});
