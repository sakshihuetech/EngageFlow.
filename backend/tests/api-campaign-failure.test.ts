import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiCampaign } from '../src/models/api-campaign.model.js';
import { ApiCampaignExecution } from '../src/models/api-campaign-execution.model.js';
import { Contact } from '../src/models/contact.model.js';
import { WhatsAppMessage } from '../src/models/whatsapp-message.model.js';
import * as sender from '../src/services/whatsapp/send-approved-template.service.js';
import { MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { processApiCampaignJob } from '../src/services/api-campaign/worker.service.js';
import { trackApiCampaignMessage } from '../src/services/api-campaign/tracking.service.js';
import { getExecution, listExecutions } from '../src/controllers/api-campaign.controller.js';
import { withStoredProviderFailures } from '../src/services/api-campaign/execution-failure.service.js';
import * as connectionContext from '../src/services/whatsapp/connection-context.service.js';
import * as sendReadiness from '../src/services/api-campaign/send-readiness.service.js';

const workspaceId = '64b000000000000000000001';
const campaignId = '64b000000000000000000002';
const executionId = '64b000000000000000000003';
const execution = { _id: executionId, apiCampaignId: campaignId, workspaceId, contactId: campaignId, destination: '+15551234567', resolvedTemplateParams: [], status: 'SENDING', senderAccountId: campaignId, senderPhoneNumberId: '123', senderTemplateId: campaignId, retrySequence: 0, attempts: 1 };

afterEach(() => vi.restoreAllMocks());

function workerSetup(campaign: unknown) {
  const claim = vi.spyOn(ApiCampaignExecution, 'findOneAndUpdate').mockResolvedValue(execution as never);
  vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ lean: async () => campaign } as never);
  vi.spyOn(Contact, 'findOne').mockReturnValue({ lean: async () => ({ _id: campaignId, workspaceId, status: 'ACTIVE', phoneE164: execution.destination, whatsappConsent: { status: 'OPTED_IN' } }) } as never);
  vi.spyOn(sendReadiness, 'assertApiCampaignAssetsReady').mockResolvedValue(undefined);
  vi.spyOn(ApiCampaignExecution, 'updateOne').mockResolvedValue({} as never);
  vi.spyOn(WhatsAppMessage, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) } as never);
  return claim;
}

describe('API Campaign failure persistence', () => {
  it('persists Meta 131042 provider code, title, and message after a definitive rejection', async () => {
    const update = workerSetup({ _id: campaignId, whatsappAccountId: campaignId, phoneNumberId: '123', templateId: campaignId });
    vi.spyOn(sender, 'sendApprovedTemplateMessage').mockImplementation(async (input) => {
      input.onProviderSubmit?.();
      throw new MetaGraphError('Meta rejected the message', 400, '131042', { code: 131042, userTitle: 'Business eligibility payment issue', userMessage: 'Payment setup is required.' });
    });

    await processApiCampaignJob({ data: { executionId } } as never);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ _id: executionId, status: 'SENDING' }), expect.objectContaining({ $set: expect.objectContaining({
      status: 'FAILED', failureCode: '131042', failureTitle: 'Business eligibility payment issue',
      failureMessage: 'Payment setup is required.', failureCategory: 'META_PERMANENT', retrySafety: 'PERMANENT',
    }) }), expect.objectContaining({ new: true }));
  });

  it('persists a clear pre-provider validation reason', async () => {
    const update = workerSetup(null);
    const send = vi.spyOn(sender, 'sendApprovedTemplateMessage');

    await processApiCampaignJob({ data: { executionId } } as never);
    expect(send).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ _id: executionId, status: 'SENDING' }), expect.objectContaining({ $set: expect.objectContaining({
      status: 'FAILED', failureCode: 'CAMPAIGN_NOT_LIVE', failureTitle: 'Campaign is not live or unavailable.',
      failureCategory: 'VALIDATION', retrySafety: 'PERMANENT',
    }) }), expect.objectContaining({ new: true }));
  });

  it('keeps an ambiguous provider submission unsafe to retry', async () => {
    const update = workerSetup({ _id: campaignId, whatsappAccountId: campaignId, phoneNumberId: '123', templateId: campaignId });
    vi.spyOn(sender, 'sendApprovedTemplateMessage').mockImplementation(async (input) => {
      input.onProviderSubmit?.();
      throw new MetaGraphError('Meta Graph API request timed out.', 502, 'META_TIMEOUT');
    });

    await processApiCampaignJob({ data: { executionId } } as never);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ _id: executionId, status: 'SENDING' }), expect.objectContaining({ $set: expect.objectContaining({
      failureCode: 'META_TIMEOUT', failureCategory: 'META_TRANSIENT', retrySafety: 'UNCERTAIN',
    }) }), expect.objectContaining({ new: true }));
  });

  it('copies a later sanitized provider failure into the execution without allowing replay', async () => {
    vi.spyOn(ApiCampaignExecution, 'findOne').mockResolvedValue({ _id: executionId, status: 'ACCEPTED' } as never);
    const update = vi.spyOn(ApiCampaignExecution, 'updateOne').mockResolvedValue({} as never);
    await trackApiCampaignMessage({ apiCampaignExecutionId: executionId, workspaceId }, 'FAILED', new Date(), {
      failureCode: '131042', failureTitle: 'Business eligibility payment issue',
      failureMessage: 'Bearer secret-value blocked at https://example.com/private',
    });
    const set = (update.mock.calls[0]?.[1] as { $set: Record<string, unknown> }).$set;
    expect(set).toMatchObject({ status: 'FAILED', failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureCategory: 'META_PERMANENT', retrySafety: 'PERMANENT', failureSource: 'META_WEBHOOK' });
    expect(JSON.stringify(set)).not.toContain('secret-value');
    expect(JSON.stringify(set)).not.toContain('example.com');
  });

  it('returns persisted failure fields in both list and detail APIs', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: campaignId } } as never);
    vi.spyOn(ApiCampaign, 'findOne').mockReturnValue({ select: () => ({ lean: async () => ({ _id: campaignId }) }), lean: async () => ({ _id: campaignId }) } as never);
    const row = { _id: executionId, apiCampaignId: campaignId, workspaceId, status: 'FAILED', failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment setup is required.', retrySafety: 'UNCERTAIN' };
    vi.spyOn(ApiCampaignExecution, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) } as never);
    vi.spyOn(ApiCampaignExecution, 'findOne').mockReturnValue({ lean: async () => row } as never);
    const response = { json: vi.fn() };
    const next = vi.fn();
    listExecutions({ workspaceContext: { workspaceId }, params: { id: campaignId }, query: {}, requestId: 'test' } as never, response as never, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    expect(response.json.mock.calls[0]?.[0]).toMatchObject({ data: { items: [{ failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment setup is required.' }] } });
    response.json.mockClear();
    getExecution({ workspaceContext: { workspaceId }, params: { id: campaignId, executionId }, query: {}, requestId: 'test' } as never, response as never, next);
    await vi.waitFor(() => expect(response.json).toHaveBeenCalledOnce());
    expect(response.json.mock.calls[0]?.[0]).toMatchObject({ data: { failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment setup is required.' } });
    expect(next).not.toHaveBeenCalled();
  });

  it('reads a pre-fix failed execution reason from its stored provider message without writing data', async () => {
    const row = { _id: executionId, apiCampaignId: campaignId, workspaceId, status: 'FAILED', whatsappMessageId: campaignId, metaMessageId: 'wamid.existing' };
    const provider = { _id: campaignId, metaMessageId: 'wamid.existing', status: 'FAILED', failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment setup is required.' };
    const messageFind = vi.spyOn(WhatsAppMessage, 'find').mockReturnValue({ select: () => ({ lean: async () => [provider] }) } as never);
    const executionUpdate = vi.spyOn(ApiCampaignExecution, 'updateOne');
    const result = await withStoredProviderFailures([row], workspaceId);
    expect(messageFind).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, status: 'FAILED' }));
    expect(result[0]).toMatchObject({ failureCode: '131042', failureTitle: 'Business eligibility payment issue', failureMessage: 'Payment setup is required.', retrySafety: 'PERMANENT' });
    expect(executionUpdate).not.toHaveBeenCalled();
  });
});
