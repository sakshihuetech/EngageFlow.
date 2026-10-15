import type { ApiCampaignDocument } from '../../models/api-campaign.model.js';
import { MetaConnection } from '../../models/meta-connection.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';

export async function assertApiCampaignAssetsReady(campaign: Pick<ApiCampaignDocument, 'workspaceId' | 'whatsappAccountId' | 'whatsappPhoneNumberId' | 'phoneNumberId' | 'templateId'>) {
  const account = await WhatsAppAccount.findOne({ _id: campaign.whatsappAccountId, workspaceId: campaign.workspaceId, status: 'CONNECTED' }).lean();
  if (!account) throw new AppError(409, 'API_CAMPAIGN_SENDER_DISCONNECTED', 'This API Campaign belongs to a disconnected WhatsApp account. Select a current-WABA campaign.');
  const connection = await MetaConnection.findOne({ _id: account.connectionId, workspaceId: campaign.workspaceId, provider: 'meta', status: 'CONNECTED' }).lean();
  if (!connection) throw new AppError(409, 'API_CAMPAIGN_SENDER_DISCONNECTED', 'This API Campaign connection is unavailable.');
  const phone = await WhatsAppPhoneNumber.findOne({ _id: campaign.whatsappPhoneNumberId, workspaceId: campaign.workspaceId, whatsappAccountId: account._id, phoneNumberId: campaign.phoneNumberId }).lean();
  if (!phone || !['CONNECTED', 'REGISTERED'].includes(String(phone.registrationStatus ?? '').toUpperCase()) || String(phone.codeVerificationStatus ?? '').toUpperCase() !== 'VERIFIED') {
    throw new AppError(409, 'API_CAMPAIGN_PHONE_UNAVAILABLE', 'This API Campaign sender is not send-ready.');
  }
  const template = await WhatsAppTemplate.findOne({ _id: campaign.templateId, workspaceId: campaign.workspaceId, whatsappAccountId: account._id, status: 'APPROVED', isActive: true }).select('_id').lean();
  if (!template) throw new AppError(409, 'API_CAMPAIGN_TEMPLATE_UNAVAILABLE', 'This API Campaign template is not approved on its WhatsApp account.');
}
