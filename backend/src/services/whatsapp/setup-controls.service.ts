import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { MetaConnection } from '../../models/meta-connection.model.js';
import { MetaCredential } from '../../models/meta-credential.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { Workspace } from '../../models/workspace.model.js';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';
import { encryptMetaCredential } from './credential-encryption.js';
import { graphRequest } from './meta-graph.service.js';

type Asset = Record<string, unknown>;
const providerId = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{1,40}$/.test(value)) throw new AppError(400, 'INVALID_PROVIDER_ID', 'Invalid Meta asset identifier.');
  return value;
};
const phoneFields = 'id,display_phone_number,verified_name,quality_rating,status,name_status,code_verification_status';
export async function fetchSetupPhones(wabaId: string, accessToken: string) {
  const phones: Asset[] = []; let after: string | undefined;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ fields: phoneFields, limit: '100', ...(after ? { after } : {}) });
    const result = await graphRequest<{ data?: Asset[]; paging?: { next?: string; cursors?: { after?: string } } }>(`${providerId(wabaId)}/phone_numbers?${query}`, { accessToken });
    if (!Array.isArray(result.data)) throw new AppError(502, 'ASSET_RESPONSE_INCOMPLETE', 'Meta phone list was incomplete; local assets were not changed.');
    phones.push(...result.data);
    if (!result.paging?.next) return phones;
    after = result.paging.cursors?.after;
    if (!after) break;
  }
  throw new AppError(502, 'ASSET_PAGINATION_LIMIT', 'Meta phone pagination did not complete; local assets were not changed.');
}
function phoneUpdate(phone: Asset) {
  return Object.fromEntries(Object.entries({ displayPhoneNumber: phone.display_phone_number, verifiedName: phone.verified_name, qualityRating: phone.quality_rating, registrationStatus: phone.status, codeVerificationStatus: phone.code_verification_status, nameStatus: phone.name_status, lastSyncedAt: new Date() }).filter(([, value]) => value !== undefined));
}
async function transaction<T>(work: (session: mongoose.ClientSession) => Promise<T>) {
  const session = await mongoose.startSession();
  try { let result: T | undefined; await session.withTransaction(async () => { result = await work(session); }); return result!; }
  finally { await session.endSession(); }
}
async function validatedAssets(workspaceId: string, wabaId: string, accessToken: string, selectedPhone?: string) {
  const [waba, phones] = await Promise.all([
    graphRequest<Asset>(`${providerId(wabaId)}?fields=id,name,currency,timezone_id,owner_business_info`, { accessToken }),
    fetchSetupPhones(wabaId, accessToken),
  ]);
  if (String(waba.id) !== wabaId || (selectedPhone && !phones.some(phone => phone.id === selectedPhone))) throw new AppError(403, 'ASSET_OWNERSHIP_MISMATCH', 'Meta did not confirm the selected WABA and phone.');
  phones.forEach(phone => {
    providerId(phone.id);
    if (typeof phone.status !== 'string' || typeof phone.code_verification_status !== 'string') throw new AppError(502, 'ASSET_RESPONSE_INCOMPLETE', 'Meta phone status was incomplete; local assets were not changed.');
  });
  if (await WhatsAppAccount.exists({ wabaId, workspaceId: { $ne: workspaceId } })) throw new AppError(409, 'WABA_ALREADY_ASSIGNED', 'This WABA is assigned to another workspace.');
  for (const phone of phones) if (await WhatsAppPhoneNumber.exists({ phoneNumberId: providerId(phone.id), workspaceId: { $ne: workspaceId } })) throw new AppError(409, 'PHONE_ALREADY_ASSIGNED', 'This phone is assigned to another workspace.');
  return { waba, phones };
}
async function persistAssets(workspaceId: string, wabaId: string, assets: Awaited<ReturnType<typeof validatedAssets>>, mode: string, tokenData?: Asset, expectedConnectionId?: mongoose.Types.ObjectId, subscribed = false) {
  return transaction(async session => {
    // Repeat ownership checks in the transaction before any local changes.
    if (expectedConnectionId && !await MetaConnection.exists({ _id: expectedConnectionId, workspaceId, status: 'CONNECTED' }).session(session)) throw new AppError(409, 'CONNECTION_CHANGED', 'Connection changed during refresh. Reload Setup before retrying.');
    if (await WhatsAppAccount.exists({ wabaId, workspaceId: { $ne: workspaceId } }).session(session)) throw new AppError(409, 'WABA_ALREADY_ASSIGNED', 'This WABA is assigned to another workspace.');
    const business = assets.waba.owner_business_info as Asset | undefined;
    const metadata = Object.fromEntries(Object.entries({ metaBusinessId: business?.id, businessName: business?.name ?? assets.waba.name }).filter(([, value]) => value !== undefined));
    const connection = await MetaConnection.findOneAndUpdate({ workspaceId, provider: 'meta' }, { $set: { status: 'CONNECTED', onboardingMode: mode, ...(subscribed ? { webhookSubscribed: true } : {}), lastSyncedAt: new Date(), ...metadata }, $setOnInsert: { connectedAt: new Date() } }, { upsert: true, new: true, session, runValidators: true });
    const account = await WhatsAppAccount.findOneAndUpdate({ workspaceId, wabaId }, { $set: { connectionId: connection._id, status: 'CONNECTED', ...Object.fromEntries(Object.entries({ name: assets.waba.name, currency: assets.waba.currency, timezone: assets.waba.timezone_id }).filter(([, value]) => value !== undefined)) } }, { upsert: true, new: true, session });
    await WhatsAppAccount.updateMany({ workspaceId, connectionId: connection._id, _id: { $ne: account._id } }, { $set: { status: 'DISCONNECTED' } }, { session });
    for (const phone of assets.phones) {
      if (await WhatsAppPhoneNumber.exists({ phoneNumberId: providerId(phone.id), workspaceId: { $ne: workspaceId } }).session(session)) throw new AppError(409, 'PHONE_ALREADY_ASSIGNED', 'This phone is assigned to another workspace.');
      await WhatsAppPhoneNumber.findOneAndUpdate({ workspaceId, phoneNumberId: providerId(phone.id) }, { $set: { whatsappAccountId: account._id, ...phoneUpdate(phone) } }, { upsert: true, session });
    }
    await WhatsAppPhoneNumber.updateMany({ workspaceId, whatsappAccountId: account._id, phoneNumberId: { $nin: assets.phones.map(phone => providerId(phone.id)) } }, { $set: { registrationStatus: 'UNAVAILABLE', lastSyncedAt: new Date() } }, { session });
    if (tokenData) await MetaCredential.findOneAndUpdate({ workspaceId, connectionId: connection._id }, { $set: { encryptedAccessToken: encryptMetaCredential(String(tokenData.access_token)), tokenType: 'bearer', scopes: Array.isArray(tokenData.scopes) ? tokenData.scopes : typeof tokenData.scope === 'string' ? tokenData.scope.split(',') : [], ...(Number(tokenData.expires_in) > 0 ? { expiresAt: new Date(Date.now() + Number(tokenData.expires_in) * 1000) } : {}) }, ...(!Number(tokenData.expires_in) ? { $unset: { expiresAt: 1 } } : {}) }, { upsert: true, session });
    return { synced: assets.phones.length };
  });
}
export async function completeSetupOnboarding(workspaceId: string, input: Record<string, unknown>) {
  if ('workspaceId' in input || 'accessToken' in input) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'Workspace and credential are resolved on the server.');
  if (!await Workspace.exists({ _id: workspaceId, status: 'ACTIVE' })) throw new AppError(403, 'WORKSPACE_FORBIDDEN', 'Workspace is unavailable.');
  const mode = input.onboardingMode ?? 'STANDARD';
  if (!['STANDARD', 'COEXISTENCE'].includes(String(mode)) || typeof input.code !== 'string' || !input.code || input.code.length > 4096) throw new AppError(400, 'INVALID_ONBOARDING', 'A valid authorization code and onboarding mode are required.');
  const wabaId = providerId(input.wabaId); const phoneId = input.phoneNumberId ? providerId(input.phoneNumberId) : undefined;
  if (!phoneId) throw new AppError(400, 'PHONE_REQUIRED', 'Meta must identify the phone number before it can be connected.');
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.ENCRYPTION_KEY) throw new AppError(503, 'ONBOARDING_NOT_CONFIGURED', 'Meta onboarding is not configured on the server.');
  const tokenData = await graphRequest<Asset>('oauth/access_token', { method: 'POST', accessToken: '', form: { client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, code: input.code } });
  if (typeof tokenData.access_token !== 'string' || !tokenData.access_token) throw new AppError(502, 'CREDENTIAL_MISSING', 'Meta did not return a credential.');
  const assets = await validatedAssets(workspaceId, wabaId, tokenData.access_token, phoneId);
  const selected = assets.phones.find(phone => phone.id === phoneId);
  const ready = Boolean(selected && ['CONNECTED', 'REGISTERED'].includes(String(selected.status ?? '').toUpperCase()) && String(selected.code_verification_status ?? '').toUpperCase() === 'VERIFIED');
  const pendingStandardRegistration = mode === 'STANDARD' && String(selected?.status ?? '').toUpperCase() === 'PENDING';
  if (!ready && !pendingStandardRegistration) throw new AppError(409, 'PHONE_NOT_READY', 'Meta has not confirmed this phone as ready for Cloud API sending. No local connection was changed.');
  const result = await graphRequest<{ success?: boolean }>(`${wabaId}/subscribed_apps`, { method: 'POST', accessToken: tokenData.access_token });
  if (result.success !== true) throw new AppError(502, 'SUBSCRIPTION_UNCONFIRMED', 'Meta did not confirm the webhook subscription.');
  return persistAssets(workspaceId, wabaId, assets, String(mode), tokenData, undefined, true);
}
export async function refreshSetupAssets(workspaceId: string) {
  const context = await resolveConnectedWhatsApp(workspaceId, true);
  const assets = await validatedAssets(workspaceId, context.account.wabaId, context.accessToken!);
  return persistAssets(workspaceId, context.account.wabaId, assets, context.connection.onboardingMode ?? 'STANDARD', undefined, context.connection._id);
}
export async function disconnectSetup(workspaceId: string) {
  return transaction(async session => {
    const connection = await MetaConnection.findOneAndUpdate({ workspaceId, provider: 'meta', status: 'CONNECTED' }, { $set: { status: 'DISCONNECTED' } }, { new: true, session });
    if (connection) await WhatsAppAccount.updateMany({ workspaceId, connectionId: connection._id }, { $set: { status: 'DISCONNECTED' } }, { session });
    return { disconnected: Boolean(connection) };
  });
}
const registrations = new Set<string>();
export async function registerSetupPhone(workspaceId: string, input: Record<string, unknown>) {
  if (Object.keys(input).some(key => key !== 'pin') || typeof input.pin !== 'string' || !/^\d{6}$/.test(input.pin)) throw new AppError(400, 'INVALID_PIN', 'Provide only a six-digit two-step verification PIN.');
  const context = await resolveConnectedWhatsApp(workspaceId, true);
  if ((context.connection.onboardingMode ?? 'STANDARD') !== 'STANDARD') throw new AppError(409, 'RECONNECT_REQUIRED', 'Complete coexistence registration through Embedded Signup.');
  if (context.phones.length !== 1) throw new AppError(409, 'PHONE_SELECTION_REQUIRED', 'Registration requires exactly one connected phone.');
  const phone = context.phones[0]!; const lock = `${workspaceId}:${phone.phoneNumberId}`;
  if (registrations.has(lock)) throw new AppError(409, 'REGISTRATION_IN_PROGRESS', 'Phone registration is already in progress.');
  registrations.add(lock);
  try {
    const before = (await fetchSetupPhones(context.account.wabaId, context.accessToken!)).find(value => value.id === phone.phoneNumberId);
    if (!before) throw new AppError(403, 'PHONE_OWNERSHIP_MISMATCH', 'Meta did not confirm phone ownership.');
    if (!['CONNECTED', 'REGISTERED', 'PENDING'].includes(String(before.status).toUpperCase())) throw new AppError(409, 'UNSUPPORTED_STATE', 'Review the phone registration state in WhatsApp Manager.');
    let registeredNow = false;
    if (String(before.status).toUpperCase() === 'PENDING') {
      const result = await graphRequest<{ success?: boolean }>(`${phone.phoneNumberId}/register`, { method: 'POST', accessToken: context.accessToken!, body: { messaging_product: 'whatsapp', pin: input.pin } });
      if (result.success !== true) throw new AppError(502, 'REGISTRATION_UNCONFIRMED', 'Meta did not confirm phone registration.');
      registeredNow = true;
    }
    const after = registeredNow ? (await fetchSetupPhones(context.account.wabaId, context.accessToken!)).find(value => value.id === phone.phoneNumberId) : before;
    if (!after) throw new AppError(502, 'REFRESH_REQUIRED', 'Registration was accepted, but refreshed phone state is unavailable. Refresh assets before retrying.');
    await WhatsAppPhoneNumber.updateOne({ _id: phone._id, workspaceId, whatsappAccountId: context.account._id }, { $set: phoneUpdate(after) });
    return { registeredNow, state: ['CONNECTED', 'REGISTERED'].includes(String(after.status).toUpperCase()) ? 'REGISTERED' : 'META_STATE_REFRESHED' };
  } finally { registrations.delete(lock); }
}
