import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

vi.mock('../src/config/env.js', () => ({ env: { NODE_ENV: 'test', REDIS_URL: '', WHATSAPP_API_VERSION: 'v23.0' } }));
vi.mock('../src/config/api-campaign-queue.js', () => ({ apiCampaignJobId: (id: string, n = 0) => `api-campaign-execution-${id}${n ? `-retry-${n}` : ''}`, enqueueApiCampaignExecution: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/api-campaign/send-readiness.service.js', () => ({ assertApiCampaignAssetsReady: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../src/services/whatsapp/consent-scope.service.js', () => ({ hasSenderConsent: () => true }));
vi.mock('../src/services/whatsapp/send-approved-template.service.js', () => ({ sendApprovedTemplateMessage: vi.fn() }));

import { ApiCampaign } from '../src/models/api-campaign.model.js';
import { ApiCampaignExecution } from '../src/models/api-campaign-execution.model.js';
import { Contact } from '../src/models/contact.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';
import { MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { sendApprovedTemplateMessage } from '../src/services/whatsapp/send-approved-template.service.js';
import { classifyApiCampaignFailure, processApiCampaignJob, reconcileApiCampaignExecutions } from '../src/services/api-campaign/worker.service.js';
import { trackApiCampaignMessage } from '../src/services/api-campaign/tracking.service.js';
import { previewApiCampaignRetry, retryApiCampaignExecution } from '../src/services/api-campaign/trigger.service.js';
import { enqueueApiCampaignExecution } from '../src/config/api-campaign-queue.js';

const workspaceId = new Types.ObjectId();
const accountId = new Types.ObjectId();
const templateId = new Types.ObjectId();
const campaignId = new Types.ObjectId();
const executionId = new Types.ObjectId();
const contactId = new Types.ObjectId();
const q = <T>(value: T) => ({ then: (resolve: (value: T) => unknown) => Promise.resolve(value).then(resolve), lean: async () => value, sort() { return this; }, limit() { return this; } });
const job = (id: string, retrySequence = 1) => ({ id, data: { executionId: String(executionId), retrySequence } }) as never;
let execution: Record<string, unknown>;
let messages: Array<Record<string, unknown>>;

function update(value: Record<string, unknown>) {
  Object.assign(execution, value.$set as object ?? {});
  for (const key of Object.keys(value.$unset as object ?? {})) delete execution[key];
  for (const [key, amount] of Object.entries(value.$inc as object ?? {})) execution[key] = Number(execution[key] ?? 0) + Number(amount);
  for (const [key, pushed] of Object.entries(value.$push as object ?? {})) execution[key] = [...(execution[key] as unknown[] ?? []), ...((pushed as { $each: unknown[] }).$each ?? [])];
}

beforeEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks();
  const block = () => { throw new Error('Unexpected outbound network request'); };
  vi.stubGlobal('fetch', vi.fn(block));
  vi.spyOn(net, 'connect').mockImplementation(block as never);
  vi.spyOn(net, 'createConnection').mockImplementation(block as never);
  vi.spyOn(tls, 'connect').mockImplementation(block as never);
  vi.spyOn(http, 'request').mockImplementation(block as never);
  vi.spyOn(https, 'request').mockImplementation(block as never);
  execution = { _id: executionId, workspaceId, apiCampaignId: campaignId, contactId, destination: '+10000000000', status: 'QUEUED', retrySequence: 1, attempts: 1, submissionState: 'NOT_SUBMITTED', senderAccountId: accountId, senderPhoneNumberId: 'test-phone', senderTemplateId: templateId, resolvedTemplateParams: [], attemptHistory: [] };
  messages = [];
  vi.spyOn(ApiCampaignExecution, 'findOneAndUpdate').mockImplementation(async (filter: never, value: never) => {
    const f = filter as Record<string, unknown>;
    if (f.status !== execution.status || (f.retrySequence !== undefined && (typeof f.retrySequence === 'object' ? !(f.retrySequence as { $in: unknown[] }).$in.includes(execution.retrySequence) : f.retrySequence !== execution.retrySequence)) || (f.submissionState && (typeof f.submissionState === 'object' ? !(f.submissionState as { $in: unknown[] }).$in.includes(execution.submissionState) : f.submissionState !== execution.submissionState))) return null;
    update(value as Record<string, unknown>); return { ...execution } as never;
  });
  vi.spyOn(ApiCampaignExecution, 'updateOne').mockImplementation(async (_filter: never, value: never) => { update(value as Record<string, unknown>); return { acknowledged: true } as never; });
  vi.spyOn(ApiCampaignExecution, 'findOne').mockImplementation(() => q({ ...execution }) as never);
  vi.spyOn(ApiCampaignExecution, 'find').mockImplementation((filter: never) => q((filter as { status: string }).status === 'SENDING' && execution.status === 'SENDING' ? [{ ...execution }] : []) as never);
  vi.spyOn(ApiCampaign, 'findOne').mockImplementation(() => q({ _id: campaignId, workspaceId, status: 'LIVE', whatsappAccountId: accountId, phoneNumberId: 'test-phone', templateId, templateSnapshot: { category: 'MARKETING' } }) as never);
  vi.spyOn(Contact, 'findOne').mockImplementation(() => q({ _id: contactId, workspaceId, status: 'ACTIVE', phoneE164: execution.destination, whatsappConsent: { status: 'OPTED_IN' } }) as never);
  vi.spyOn(WhatsAppMessage, 'find').mockImplementation((filter: never) => {
    const f = filter as Record<string, unknown>;
    return q(messages.filter(message => String(message.workspaceId) === String(f.workspaceId) && (f.apiCampaignRetryExecutionId
      ? String(message.apiCampaignRetryExecutionId) === String(f.apiCampaignRetryExecutionId) && message.apiCampaignRetrySequence === f.apiCampaignRetrySequence
      : String(message.apiCampaignExecutionId) === String(f.apiCampaignExecutionId)))) as never;
  });
});

describe('isolated API Campaign retry', () => {
  it('classifies explicit throttles with provider wait, permanent 4xx and ambiguous timeout', () => {
    const throttle = classifyApiCampaignFailure(new MetaGraphError('Rate limited', 429, '4', { code: 4, retryAfterMs: 60_000 }), true, 1);
    expect(throttle.retrySafety).toBe('SAFE'); expect(throttle.autoRetry).toBe(true); expect(throttle.nextEligibleRetryAt).toBeInstanceOf(Date);
    const unknownWait = classifyApiCampaignFailure(new MetaGraphError('Rate limited', 429, '4', { code: 4 }), true, 1);
    expect(unknownWait.autoRetry).toBe(false); expect(unknownWait.retryRestriction).toBe('PROVIDER_WAIT_UNKNOWN');
    expect(classifyApiCampaignFailure(new MetaGraphError('Approval required', 400, '131037', { code: 131037 }), true).retrySafety).toBe('PERMANENT');
    expect(classifyApiCampaignFailure(new MetaGraphError('Timed out', 502, 'META_TIMEOUT'), true).retrySafety).toBe('UNCERTAIN');
  });
  it('concurrent workers use one atomic claim and one retry message correlation', async () => {
    vi.mocked(sendApprovedTemplateMessage).mockImplementation(async input => { input.onProviderSubmit?.(); return { recordId: new Types.ObjectId(), messageId: 'wamid.retry', acceptedAt: new Date() } as never; });
    await Promise.all([processApiCampaignJob(job('one')), processApiCampaignJob(job('two'))]);
    expect(sendApprovedTemplateMessage).toHaveBeenCalledTimes(1);
    expect(vi.mocked(sendApprovedTemplateMessage).mock.calls[0]![0]).toMatchObject({ apiCampaignRetryExecutionId: executionId, apiCampaignRetrySequence: 1 });
    expect(execution.status).toBe('ACCEPTED');
  });
  it('restart before acceptance becomes uncertain and cannot resend', async () => {
    Object.assign(execution, { status: 'SENDING', submissionState: 'SUBMITTING', updatedAt: new Date(0) });
    await reconcileApiCampaignExecutions();
    expect(execution.status).toBe('FAILED'); expect(execution.retrySafety).toBe('UNCERTAIN');
    await processApiCampaignJob(job('restart'));
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });
  it('restart after persisted acceptance recovers the matching retry message', async () => {
    Object.assign(execution, { status: 'SENDING', submissionState: 'SUBMITTING', updatedAt: new Date(0) });
    messages.push({ _id: new Types.ObjectId(), workspaceId, apiCampaignRetryExecutionId: executionId, apiCampaignRetrySequence: 1, metaMessageId: 'wamid.retry', status: 'ACCEPTED' });
    await reconcileApiCampaignExecutions();
    expect(execution.status).toBe('ACCEPTED'); expect(execution.metaMessageId).toBe('wamid.retry');
    expect(sendApprovedTemplateMessage).not.toHaveBeenCalled();
  });
  it('delayed older webhook cannot overwrite the current attempt', async () => {
    Object.assign(execution, { status: 'ACCEPTED', metaMessageId: 'wamid.retry' });
    await trackApiCampaignMessage({ workspaceId, apiCampaignExecutionId: executionId, metaMessageId: 'wamid.old' }, 'READ', new Date());
    expect(execution.status).toBe('ACCEPTED');
    await trackApiCampaignMessage({ workspaceId, apiCampaignRetryExecutionId: executionId, metaMessageId: 'wamid.retry' }, 'DELIVERED', new Date());
    expect(execution.status).toBe('DELIVERED');
  });
  it('allows a definitive webhook 429 with a provider ID, while retaining its failure evidence', async () => {
    Object.assign(execution, { status: 'ACCEPTED', submissionState: 'ACCEPTED', metaMessageId: 'wamid.throttled', whatsappMessageId: new Types.ObjectId(), attempts: 1 });
    await trackApiCampaignMessage({ workspaceId, apiCampaignExecutionId: executionId, metaMessageId: 'wamid.throttled' }, 'FAILED', new Date(), { failureCode: '429', failureTitle: 'Rate limited' });
    expect(execution.failureSource).toBe('META_WEBHOOK');
    const input = { workspaceId: String(workspaceId), campaignId: String(campaignId), executionId: String(executionId) };
    expect((await previewApiCampaignRetry(input)).eligible).toBe(true);
    await retryApiCampaignExecution(input);
    expect(execution.status).toBe('QUEUED');
    expect(execution.attemptHistory).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: 'wamid.throttled', failureCode: '429' })]));
  });
  it('blocks ambiguous provider IDs, pending and successful executions', async () => {
    const input = { workspaceId: String(workspaceId), campaignId: String(campaignId), executionId: String(executionId) };
    Object.assign(execution, { status: 'FAILED', retrySafety: 'SAFE', submissionState: 'UNCERTAIN', metaMessageId: 'wamid.unknown', failureCode: '429' });
    expect((await previewApiCampaignRetry(input)).eligible).toBe(false);
    Object.assign(execution, { submissionState: 'ACCEPTED', failureSource: undefined });
    expect((await previewApiCampaignRetry(input)).reason).toBe('PROVIDER_OUTCOME_UNCERTAIN');
    for (const status of ['ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'QUEUED']) {
      execution.status = status;
      expect((await previewApiCampaignRetry(input)).eligible).toBe(false);
    }
  });
  it('recovers only the current retry sequence and rejects legacy or duplicate matches', async () => {
    Object.assign(execution, { status: 'SENDING', submissionState: 'SUBMITTING', updatedAt: new Date(0), retrySequence: 2 });
    messages.push({ _id: new Types.ObjectId(), workspaceId, apiCampaignRetryExecutionId: executionId, apiCampaignRetrySequence: 1, metaMessageId: 'wamid.old', status: 'ACCEPTED' });
    await reconcileApiCampaignExecutions();
    expect(execution.status).toBe('FAILED'); expect(execution.retrySafety).toBe('UNCERTAIN');
    Object.assign(execution, { status: 'SENDING', submissionState: 'SUBMITTING', updatedAt: new Date(0) });
    messages.push({ _id: new Types.ObjectId(), workspaceId, apiCampaignRetryExecutionId: executionId, apiCampaignRetrySequence: 2, metaMessageId: 'wamid.current', status: 'ACCEPTED' });
    await reconcileApiCampaignExecutions();
    expect(execution.metaMessageId).toBe('wamid.current');
    Object.assign(execution, { status: 'SENDING', submissionState: 'SUBMITTING', updatedAt: new Date(0) });
    messages.push({ _id: new Types.ObjectId(), workspaceId, apiCampaignRetryExecutionId: executionId, apiCampaignRetrySequence: 2, metaMessageId: 'wamid.duplicate', status: 'ACCEPTED' });
    await reconcileApiCampaignExecutions();
    expect(execution.status).toBe('FAILED'); expect(execution.retrySafety).toBe('UNCERTAIN');
  });
  it('manual retry claims once; repeated click is a replay and creates one queue job', async () => {
    Object.assign(execution, { status: 'FAILED', retrySafety: 'SAFE', submissionState: 'NOT_SUBMITTED', failureCode: '4', nextEligibleRetryAt: new Date(0) });
    const input = { workspaceId: String(workspaceId), campaignId: String(campaignId), executionId: String(executionId) };
    expect((await previewApiCampaignRetry(input)).eligible).toBe(true);
    expect((await retryApiCampaignExecution(input)).replay).toBe(false);
    expect((await retryApiCampaignExecution(input)).replay).toBe(true);
    expect(enqueueApiCampaignExecution).toHaveBeenCalledTimes(1);
  });
  it('wrong sender binding or opted-out contact blocks manual retry', async () => {
    Object.assign(execution, { status: 'FAILED', retrySafety: 'SAFE', submissionState: 'NOT_SUBMITTED', failureCode: '4' });
    const input = { workspaceId: String(workspaceId), campaignId: String(campaignId), executionId: String(executionId) };
    vi.mocked(ApiCampaign.findOne).mockImplementationOnce(() => q({ whatsappAccountId: new Types.ObjectId(), phoneNumberId: 'another-phone', templateId }) as never);
    expect((await previewApiCampaignRetry(input)).reason).toBe('ORIGINAL_SENDER_OR_TEMPLATE_CHANGED');
    vi.mocked(Contact.findOne).mockImplementationOnce(() => q({ status: 'ACTIVE', phoneE164: execution.destination, whatsappConsent: { status: 'OPTED_OUT' } }) as never);
    expect((await previewApiCampaignRetry(input)).reason).toBe('CONSENT_OR_CONTACT');
  });
  it('blocks a disconnected sender and a cross-workspace execution', async () => {
    Object.assign(execution, { status: 'FAILED', retrySafety: 'SAFE', submissionState: 'NOT_SUBMITTED', failureCode: '4' });
    const input = { workspaceId: String(workspaceId), campaignId: String(campaignId), executionId: String(executionId) };
    const { assertApiCampaignAssetsReady } = await import('../src/services/api-campaign/send-readiness.service.js');
    vi.mocked(assertApiCampaignAssetsReady).mockRejectedValueOnce(new Error('Disconnected sender'));
    expect((await previewApiCampaignRetry(input)).reason).toBe('SENDER_OR_TEMPLATE_UNAVAILABLE');
    vi.mocked(ApiCampaignExecution.findOne).mockImplementationOnce(() => q(null) as never);
    await expect(previewApiCampaignRetry({ ...input, workspaceId: String(new Types.ObjectId()) })).rejects.toMatchObject({ code: 'EXECUTION_NOT_FOUND' });
  });
});
