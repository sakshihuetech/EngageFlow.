import mongoose from 'mongoose';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';

export async function resolveAccountView(workspaceId: string, view?: unknown, accountId?: unknown) {
  const { account: active } = await resolveConnectedWhatsApp(workspaceId);
  if (view === undefined || view === '' || view === 'current') {
    if (accountId !== undefined) throw new AppError(400, 'INVALID_ACCOUNT_VIEW', 'Account selection requires the Previous WABA History view.');
    return { account: active, historical: false };
  }
  if (view !== 'history' || typeof accountId !== 'string' || !mongoose.isValidObjectId(accountId)) {
    throw new AppError(400, 'INVALID_ACCOUNT_VIEW', 'Select a valid previous WABA account.');
  }
  const account = await WhatsAppAccount.findOne({ _id: accountId, workspaceId, status: 'DISCONNECTED' }).lean();
  if (!account) throw new AppError(404, 'HISTORY_ACCOUNT_NOT_FOUND', 'Previous WABA history was not found in this workspace.');
  return { account, historical: true };
}

export async function listAccountViews(workspaceId: string) {
  const { account: active } = await resolveConnectedWhatsApp(workspaceId);
  const previous = await WhatsAppAccount.find({ workspaceId, status: 'DISCONNECTED' }).sort({ updatedAt: -1 }).limit(100).lean();
  const phones = await WhatsAppPhoneNumber.find({ workspaceId, whatsappAccountId: { $in: [active._id, ...previous.map((account) => account._id)] } }).select('whatsappAccountId displayPhoneNumber phoneNumberId').lean();
  const serialize = (account: typeof active) => ({
    id: String(account._id), wabaId: account.wabaId, name: account.name,
    senders: phones.filter((phone) => String(phone.whatsappAccountId) === String(account._id)).map((phone) => phone.displayPhoneNumber ?? `Phone ${phone.phoneNumberId}`),
  });
  return { current: serialize(active), previous: previous.map(serialize) };
}
