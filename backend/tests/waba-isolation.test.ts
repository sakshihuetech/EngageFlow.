import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaConnection } from '../src/models/meta-connection.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';
import { resolveAccountView } from '../src/services/whatsapp/account-view.service.js';
import * as connectionContext from '../src/services/whatsapp/connection-context.service.js';
import { assertApiCampaignAssetsReady } from '../src/services/api-campaign/send-readiness.service.js';
import { hasSenderConsent } from '../src/services/whatsapp/consent-scope.service.js';
import { Campaign } from '../src/models/campaign.model.js';
import { listBroadcasts, launchBroadcast } from '../src/controllers/broadcast.controller.js';
import { Conversation } from '../src/models/conversation.model.js';
import { replyToConversation } from '../src/controllers/inbox.controller.js';
import { env } from '../src/config/env.js';

const workspaceId = '64b000000000000000000001';
const activeId = '64b000000000000000000002';
const oldId = '64b000000000000000000003';
const otherWorkspaceId = '64b000000000000000000004';
const phoneId = '64b000000000000000000005';
const templateId = '64b000000000000000000006';
afterEach(() => vi.restoreAllMocks());

describe('WABA isolation', () => {
  it('defaults to the connected WABA and requires an explicit owned disconnected account for history', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: activeId, wabaId: 'current' } } as never);
    const find = vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: oldId, workspaceId, status: 'DISCONNECTED' }) } as never);
    expect((await resolveAccountView(workspaceId)).account._id).toBe(activeId);
    expect(find).not.toHaveBeenCalled();
    await expect(resolveAccountView(workspaceId, undefined, oldId)).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_VIEW' });
    const history = await resolveAccountView(workspaceId, 'history', oldId);
    expect(history.historical).toBe(true);
    expect(find).toHaveBeenCalledWith({ _id: oldId, workspaceId, status: 'DISCONNECTED' });
    await expect(resolveAccountView(workspaceId, 'history', 'not-an-id')).rejects.toMatchObject({ code: 'INVALID_ACCOUNT_VIEW' });
  });

  it('does not open a disconnected account from another workspace', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: activeId } } as never);
    const find = vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => null } as never);
    await expect(resolveAccountView(workspaceId, 'history', oldId)).rejects.toMatchObject({ code: 'HISTORY_ACCOUNT_NOT_FOUND' });
    expect(find).toHaveBeenCalledWith({ _id: oldId, workspaceId, status: 'DISCONNECTED' });
  });

  it('rejects old API Campaign sender before any phone/template lookup', async () => {
    const findAccount = vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => null } as never);
    const findPhone = vi.spyOn(WhatsAppPhoneNumber, 'findOne');
    await expect(assertApiCampaignAssetsReady({ workspaceId: otherWorkspaceId, whatsappAccountId: oldId, whatsappPhoneNumberId: phoneId, phoneNumberId: 'provider-phone', templateId } as never)).rejects.toMatchObject({ code: 'API_CAMPAIGN_SENDER_DISCONNECTED' });
    expect(findAccount).toHaveBeenCalledWith({ _id: oldId, workspaceId: otherWorkspaceId, status: 'CONNECTED' });
    expect(findPhone).not.toHaveBeenCalled();
  });

  it('rejects a template belonging to a different WABA even with a connected sender', async () => {
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: activeId, connectionId: oldId }) } as never);
    vi.spyOn(MetaConnection, 'findOne').mockReturnValue({ lean: async () => ({ _id: oldId }) } as never);
    vi.spyOn(WhatsAppPhoneNumber, 'findOne').mockReturnValue({ lean: async () => ({ _id: phoneId, registrationStatus: 'CONNECTED', codeVerificationStatus: 'VERIFIED' }) } as never);
    const findTemplate = vi.spyOn(WhatsAppTemplate, 'findOne').mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
    await expect(assertApiCampaignAssetsReady({ workspaceId, whatsappAccountId: activeId, whatsappPhoneNumberId: phoneId, phoneNumberId: 'provider-phone', templateId } as never)).rejects.toMatchObject({ code: 'API_CAMPAIGN_TEMPLATE_UNAVAILABLE' });
    expect(findTemplate).toHaveBeenCalledWith({ _id: templateId, workspaceId, whatsappAccountId: activeId, status: 'APPROVED', isActive: true });
  });

  it('does not promote legacy or other-WABA opt-in to current-WABA consent', () => {
    const evidence = { status: 'OPTED_IN', source: 'form', evidence: 'recorded opt-in' };
    expect(hasSenderConsent(evidence, activeId)).toBe(false);
    expect(hasSenderConsent({ ...evidence, accountId: oldId }, activeId)).toBe(false);
    expect(hasSenderConsent({ ...evidence, accountId: activeId }, activeId)).toBe(true);
    expect(hasSenderConsent({ ...evidence, accountId: activeId, status: 'OPTED_OUT' }, activeId)).toBe(false);
  });

  it('filters Broadcast active and historical pages by the resolved account before pagination', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: activeId } } as never);
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: oldId, workspaceId, status: 'DISCONNECTED' }) } as never);
    const find = vi.spyOn(Campaign, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) } as never);
    const read = async (query: Record<string, string>) => new Promise<void>((resolve, reject) => listBroadcasts({ workspaceContext: { workspaceId }, query, requestId: 'test' } as never, { json: () => { resolve(); } } as never, reject));
    await read({ limit: '25' });
    expect(find).toHaveBeenLastCalledWith({ workspaceId, whatsappAccountId: activeId });
    await read({ view: 'history', accountId: oldId, limit: '25' });
    expect(find).toHaveBeenLastCalledWith({ workspaceId, whatsappAccountId: oldId });
  });

  it('does not launch an old Broadcast or reply to an old Inbox conversation', async () => {
    vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: activeId } } as never);
    const campaignFind = vi.spyOn(Campaign, 'findOne').mockResolvedValue(null);
    const invoke = (handler: typeof launchBroadcast, body: Record<string, unknown> = {}) => new Promise<void>((resolve, reject) => handler({ workspaceContext: { workspaceId }, params: { id: oldId }, query: {}, body, header: () => undefined } as never, { json: () => resolve() } as never, reject));
    await expect(invoke(launchBroadcast)).rejects.toMatchObject({ code: 'CAMPAIGN_NOT_FOUND' });
    expect(campaignFind).toHaveBeenCalledWith({ _id: oldId, workspaceId, whatsappAccountId: activeId });
    const previousLive = env.CAMPAIGN_LIVE_SEND_ENABLED; const previousTransport = env.CAMPAIGN_TRANSPORT;
    try {
      env.CAMPAIGN_LIVE_SEND_ENABLED = 'true'; env.CAMPAIGN_TRANSPORT = 'meta';
      const conversationFind = vi.spyOn(Conversation, 'findOne').mockReturnValue({ lean: async () => null } as never);
      await expect(invoke(replyToConversation as typeof launchBroadcast, { text: 'No send' })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
      expect(conversationFind).toHaveBeenCalledWith({ _id: oldId, workspaceId, whatsappAccountId: activeId });
    } finally { env.CAMPAIGN_LIVE_SEND_ENABLED = previousLive; env.CAMPAIGN_TRANSPORT = previousTransport; }
  });
});
