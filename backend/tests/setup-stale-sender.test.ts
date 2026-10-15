import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetaConnection } from '../src/models/meta-connection.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import { assertApiCampaignAssetsReady } from '../src/services/api-campaign/send-readiness.service.js';
import { validateCampaignAssets } from '../src/services/broadcast/execution.service.js';
import { sendApprovedTemplateMessage } from '../src/services/whatsapp/send-approved-template.service.js';

const workspaceId = '64b000000000000000000001';
const accountId = '64b000000000000000000002';
const connectionId = '64b000000000000000000003';
const phoneId = '64b000000000000000000004';
const templateId = '64b000000000000000000005';
const sender = { workspaceId, whatsappAccountId: accountId, whatsappPhoneNumberId: phoneId, phoneNumberId: 'provider-phone', templateId };

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('stale phone send gates', () => {
  it('blocks API, Broadcast and the shared sender before any transport call', async () => {
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound request'); }));
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountId, connectionId }) } as never);
    vi.spyOn(MetaConnection, 'findOne').mockReturnValue({ lean: async () => ({ _id: connectionId }) } as never);
    const findPhone = vi.spyOn(WhatsAppPhoneNumber, 'findOne').mockReturnValue({ lean: async () => ({ _id: phoneId, phoneNumberId: 'provider-phone', registrationStatus: 'UNAVAILABLE', codeVerificationStatus: 'VERIFIED' }) } as never);
    await expect(assertApiCampaignAssetsReady(sender as never)).rejects.toMatchObject({ code: 'API_CAMPAIGN_PHONE_UNAVAILABLE' });
    await expect(validateCampaignAssets({ ...sender, whatsAppTemplateId: templateId } as never)).rejects.toMatchObject({ code: 'PHONE_NOT_READY' });
    const sendTemplate = vi.fn();
    await expect(sendApprovedTemplateMessage({ workspaceId, whatsappAccountId: accountId, phoneNumberId: 'provider-phone', templateRecordId: templateId, recipient: '+15551234567' }, { requiresCredential: false, sendTemplate })).rejects.toMatchObject({ code: 'PHONE_NOT_READY' });
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(findPhone).toHaveBeenCalledTimes(3);
  });
});
