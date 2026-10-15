import type { Types } from 'mongoose';
import { MetaConnection } from '../../models/meta-connection.model.js';
import { MetaCredential } from '../../models/meta-credential.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { Workspace } from '../../models/workspace.model.js';
import { AppError } from '../../utils/app-error.js';
import { decryptMetaCredential } from './credential-encryption.js';

export async function resolveConnectedWhatsApp(workspaceId: Types.ObjectId | string, includeCredential = false) {
  const workspace = await Workspace.findOne({ _id: workspaceId, status: 'ACTIVE' }).lean();
  if (!workspace) throw new AppError(403, 'WORKSPACE_FORBIDDEN', 'Workspace is unavailable.');
  const connection = await MetaConnection.findOne({ workspaceId: workspace._id, provider: 'meta', status: 'CONNECTED' }).lean();
  if (!connection) throw new AppError(409, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp is not connected.');
  const accounts = await WhatsAppAccount.find({ workspaceId: workspace._id, connectionId: connection._id, status: 'CONNECTED' }).limit(2).lean();
  if (accounts.length !== 1) throw new AppError(409, accounts.length ? 'ACCOUNT_SELECTION_REQUIRED' : 'WHATSAPP_ACCOUNT_UNAVAILABLE', accounts.length ? 'Exactly one connected WhatsApp account must be selected.' : 'The connected WhatsApp account is missing.');
  const account = accounts[0]!;
  const phones = await WhatsAppPhoneNumber.find({ workspaceId: workspace._id, whatsappAccountId: account._id, registrationStatus: { $ne: 'UNAVAILABLE' } }).sort({ createdAt: 1 }).lean();
  if (!includeCredential) return { workspace, connection, account, phones };
  const credential = await MetaCredential.findOne({ workspaceId: workspace._id, connectionId: connection._id })
    .select('+encryptedAccessToken.iv +encryptedAccessToken.authTag +encryptedAccessToken.ciphertext')
    .lean();
  if (!credential) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'The Meta credential is missing.');
  if (credential.expiresAt && credential.expiresAt.getTime() <= Date.now()) throw new AppError(401, 'META_CREDENTIAL_EXPIRED', 'The Meta credential has expired.');
  const accessToken = decryptMetaCredential(credential.encryptedAccessToken);
  return { workspace, connection, account, phones, credential, accessToken };
}

export async function getWhatsAppSetupOverview(workspaceId: Types.ObjectId | string) {
  const workspace = await Workspace.findOne({ _id: workspaceId, status: 'ACTIVE' }).lean();
  if (!workspace) throw new AppError(403, 'WORKSPACE_FORBIDDEN', 'Workspace is unavailable.');
  const connection = await MetaConnection.findOne({ workspaceId: workspace._id, provider: 'meta' }).lean();
  if (!connection) return { configured: false, connection: { status: 'NOT_CONFIGURED' }, account: null, phones: [], templateSummary: { total: 0, approved: 0, pending: 0, rejected: 0 }, credential: { configured: false } };
  const account = await WhatsAppAccount.findOne({ workspaceId: workspace._id, connectionId: connection._id, status: 'CONNECTED' }).lean();
  const [phones, credential, templateRows] = await Promise.all([
    account ? WhatsAppPhoneNumber.find({ workspaceId: workspace._id, whatsappAccountId: account._id, registrationStatus: { $ne: 'UNAVAILABLE' } }).sort({ createdAt: 1 }).lean() : [],
    MetaCredential.findOne({ workspaceId: workspace._id, connectionId: connection._id }).select('expiresAt').lean(),
    account ? WhatsAppTemplate.aggregate<{ _id: string; count: number }>([
      { $match: { workspaceId: workspace._id, whatsappAccountId: account._id, isActive: true } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]) : [],
  ]);
  const counts = Object.fromEntries(templateRows.map((row) => [row._id, row.count]));
  return {
    configured: connection.status === 'CONNECTED' && Boolean(account),
    connection: {
      status: connection.status,
      onboardingMode: connection.onboardingMode,
      businessName: connection.businessName,
      metaBusinessId: connection.metaBusinessId,
      webhookSubscribed: Boolean(connection.webhookSubscribed),
      connectedAt: connection.connectedAt,
      lastSyncedAt: connection.lastSyncedAt,
    },
    account: account ? { id: String(account._id), wabaId: account.wabaId, name: account.name, currency: account.currency, timezone: account.timezone, status: account.status } : null,
    phones: phones.map((phone) => ({ id: String(phone._id), phoneNumberId: phone.phoneNumberId, displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName, qualityRating: phone.qualityRating, registrationStatus: phone.registrationStatus, codeVerificationStatus: phone.codeVerificationStatus, nameStatus: phone.nameStatus, lastSyncedAt: phone.lastSyncedAt })),
    credential: { configured: Boolean(credential), expired: Boolean(credential?.expiresAt && credential.expiresAt.getTime() <= Date.now()), expiresAt: credential?.expiresAt },
    templateSummary: { total: templateRows.reduce((sum, row) => sum + row.count, 0), approved: counts.APPROVED ?? 0, pending: counts.PENDING ?? 0, rejected: counts.REJECTED ?? 0 },
  };
}
