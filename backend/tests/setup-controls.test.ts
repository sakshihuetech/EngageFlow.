import mongoose from 'mongoose';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { MetaConnection } from '../src/models/meta-connection.model.js';
import { MetaCredential } from '../src/models/meta-credential.model.js';
import { Workspace } from '../src/models/workspace.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import * as context from '../src/services/whatsapp/connection-context.service.js';
import * as graph from '../src/services/whatsapp/meta-graph.service.js';
import { completeSetupOnboarding, disconnectSetup, fetchSetupPhones, refreshSetupAssets, registerSetupPhone } from '../src/services/whatsapp/setup-controls.service.js';
import { getBusinessProfile, updateBusinessProfile, updateBusinessPicture, validateBusinessProfile, validPictureSignature } from '../src/services/whatsapp/business-profile.service.js';
import { decryptMetaCredential, encryptMetaCredential } from '../src/services/whatsapp/credential-encryption.js';

const W = '64b000000000000000000001'; const C = '64b000000000000000000002'; const A = '64b000000000000000000003'; const P = '64b000000000000000000004';
vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof import('node:fs/promises')>(), readFile: vi.fn() }));
const connected = { workspace: { _id: W }, connection: { _id: C, onboardingMode: 'STANDARD' }, account: { _id: A, wabaId: '123' }, phones: [{ _id: P, phoneNumberId: '456', verifiedName: 'Business' }], accessToken: 'mock-only' };
beforeEach(() => { vi.spyOn(context, 'resolveConnectedWhatsApp').mockResolvedValue(connected as never); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected outbound network request in Setup tests'); })); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('Setup controls safety', () => {
  it('reads every Meta phone page before reconciliation', async () => {
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ data: [{ id: '456' }], paging: { next: 'next', cursors: { after: 'cursor' } } } as never).mockResolvedValueOnce({ data: [{ id: '789' }] } as never);
    expect((await fetchSetupPhones('123', 'mock-only')).map(phone => phone.id)).toEqual(['456', '789']);
    expect(call.mock.calls[1]?.[0]).toContain('after=cursor');
  });
  it('preserves local assets when Meta refresh fails', async () => {
    vi.spyOn(graph, 'graphRequest').mockRejectedValue(new Error('Mock provider failure'));
    const update = vi.spyOn(WhatsAppPhoneNumber, 'updateMany');
    await expect(refreshSetupAssets(W)).rejects.toThrow('Mock provider failure');
    expect(update).not.toHaveBeenCalled();
  });
  it('completes onboarding only after provider ownership and subscription, encrypting the credential', async () => {
    const original = { app: env.META_APP_ID, secret: env.META_APP_SECRET, encryption: env.ENCRYPTION_KEY };
    env.META_APP_ID = 'mock-app'; env.META_APP_SECRET = 'mock-secret'; env.ENCRYPTION_KEY = 'mock-key';
    const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    vi.spyOn(Workspace, 'exists').mockResolvedValue({ _id: W } as never);
    const noConflict = { session: () => Promise.resolve(null), then: (resolve: (value: null) => unknown) => Promise.resolve(null).then(resolve) };
    vi.spyOn(WhatsAppAccount, 'exists').mockReturnValue(noConflict as never);
    vi.spyOn(WhatsAppPhoneNumber, 'exists').mockReturnValue(noConflict as never);
    vi.spyOn(MetaConnection, 'findOneAndUpdate').mockResolvedValue({ _id: C } as never);
    vi.spyOn(WhatsAppAccount, 'findOneAndUpdate').mockResolvedValue({ _id: A } as never);
    vi.spyOn(WhatsAppAccount, 'updateMany').mockResolvedValue({} as never);
    vi.spyOn(WhatsAppPhoneNumber, 'updateMany').mockResolvedValue({} as never);
    const phone = vi.spyOn(WhatsAppPhoneNumber, 'findOneAndUpdate').mockResolvedValue({} as never);
    const credential = vi.spyOn(MetaCredential, 'findOneAndUpdate').mockResolvedValue({} as never);
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ access_token: 'mock-token', expires_in: 3600 } as never).mockResolvedValueOnce({ id: '123', name: 'Account' } as never).mockResolvedValueOnce({ data: [{ id: '456', status: 'CONNECTED', code_verification_status: 'VERIFIED' }] } as never).mockResolvedValueOnce({ success: true } as never);
    try {
      expect(await completeSetupOnboarding(W, { code: 'mock-code', wabaId: '123', phoneNumberId: '456', onboardingMode: 'STANDARD' })).toEqual({ synced: 1 });
      expect(call.mock.calls[0]?.[1]).toMatchObject({ form: { code: 'mock-code', client_id: 'mock-app' } });
      expect(phone.mock.calls[0]?.[0]).toEqual({ workspaceId: W, phoneNumberId: '456' });
      const update = credential.mock.calls[0]?.[1] as { $set: { encryptedAccessToken: Parameters<typeof decryptMetaCredential>[0] } };
      expect(decryptMetaCredential(update.$set.encryptedAccessToken)).toBe('mock-token');
      expect(session.endSession).toHaveBeenCalled();
    } finally { env.META_APP_ID = original.app; env.META_APP_SECRET = original.secret; env.ENCRYPTION_KEY = original.encryption; }
  });
  it('uses V2-compatible AES-GCM credentials without changing the key contract', () => {
    const previous = env.ENCRYPTION_KEY; env.ENCRYPTION_KEY = 'mock-encryption';
    try { const first = encryptMetaCredential('mock-only'); const second = encryptMetaCredential('mock-only'); expect(first.iv).not.toEqual(second.iv); expect(decryptMetaCredential(first)).toBe('mock-only'); }
    finally { env.ENCRYPTION_KEY = previous; }
  });
  it('rejects workspace override before any onboarding provider call', async () => {
    const call = vi.spyOn(graph, 'graphRequest');
    await expect(completeSetupOnboarding(W, { workspaceId: W })).rejects.toMatchObject({ code: 'SERVER_CONTROLLED_FIELD' });
    expect(call).not.toHaveBeenCalled();
  });
  it('refresh refuses cross-workspace WABA ownership before subscribe/persistence', async () => {
    const call = vi.spyOn(graph, 'graphRequest').mockImplementation(async path => (path.includes('/phone_numbers') ? { data: [{ id: '456', status: 'CONNECTED', code_verification_status: 'VERIFIED' }] } : { id: '123' }) as never);
    const exists = vi.spyOn(WhatsAppAccount, 'exists').mockResolvedValue({ _id: A } as never);
    const update = vi.spyOn(MetaConnection, 'findOneAndUpdate');
    await expect(refreshSetupAssets(W)).rejects.toMatchObject({ code: 'WABA_ALREADY_ASSIGNED' });
    expect(context.resolveConnectedWhatsApp).toHaveBeenCalledWith(W, true);
    expect(exists).toHaveBeenCalledWith({ wabaId: '123', workspaceId: { $ne: W } });
    expect(call.mock.calls.some(([path]) => path.includes('subscribed_apps'))).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });
  it('rejects incomplete provider phone responses without changing local assets', async () => {
    vi.spyOn(graph, 'graphRequest').mockImplementation(async path => (path.includes('/phone_numbers') ? {} : { id: '123' }) as never);
    const update = vi.spyOn(WhatsAppPhoneNumber, 'updateMany');
    await expect(refreshSetupAssets(W)).rejects.toMatchObject({ code: 'ASSET_RESPONSE_INCOMPLETE' });
    expect(update).not.toHaveBeenCalled();
  });
  it('reconciles a valid empty Meta phone list without deleting historical rows or mutating Meta', async () => {
    const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const noConflict = { session: () => Promise.resolve(null), then: (resolve: (value: null) => unknown) => Promise.resolve(null).then(resolve) };
    vi.spyOn(WhatsAppAccount, 'exists').mockReturnValue(noConflict as never);
    vi.spyOn(MetaConnection, 'exists').mockReturnValue({ session: () => Promise.resolve({ _id: C }) } as never);
    vi.spyOn(MetaConnection, 'findOneAndUpdate').mockResolvedValue({ _id: C } as never);
    vi.spyOn(WhatsAppAccount, 'findOneAndUpdate').mockResolvedValue({ _id: A } as never);
    vi.spyOn(WhatsAppAccount, 'updateMany').mockResolvedValue({} as never);
    const unavailable = vi.spyOn(WhatsAppPhoneNumber, 'updateMany').mockResolvedValue({} as never);
    const graphCall = vi.spyOn(graph, 'graphRequest').mockImplementation(async path => (path.includes('/phone_numbers') ? { data: [] } : { id: '123' }) as never);
    expect(await refreshSetupAssets(W)).toEqual({ synced: 0 });
    expect(unavailable).toHaveBeenCalledWith({ workspaceId: W, whatsappAccountId: A, phoneNumberId: { $nin: [] } }, { $set: expect.objectContaining({ registrationStatus: 'UNAVAILABLE' }) }, expect.anything());
    expect(graphCall.mock.calls.every(([, input]) => !input.method || input.method === 'GET')).toBe(true);
  });
  it('does not connect an unverified Meta phone or a Coexistence result without a phone ID', async () => {
    const original = { app: env.META_APP_ID, secret: env.META_APP_SECRET, encryption: env.ENCRYPTION_KEY };
    env.META_APP_ID = 'mock-app'; env.META_APP_SECRET = 'mock-secret'; env.ENCRYPTION_KEY = 'mock-key';
    try {
      const call = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ access_token: 'mock-token' } as never).mockResolvedValueOnce({ id: '123' } as never).mockResolvedValueOnce({ data: [{ id: '456', status: 'CONNECTED', code_verification_status: 'NOT_VERIFIED' }] } as never);
      vi.spyOn(Workspace, 'exists').mockResolvedValue({ _id: W } as never);
      vi.spyOn(WhatsAppAccount, 'exists').mockResolvedValue(null);
      vi.spyOn(WhatsAppPhoneNumber, 'exists').mockResolvedValue(null);
      const update = vi.spyOn(MetaConnection, 'findOneAndUpdate');
      await expect(completeSetupOnboarding(W, { code: 'mock-code', wabaId: '123', phoneNumberId: '456', onboardingMode: 'STANDARD' })).rejects.toMatchObject({ code: 'PHONE_NOT_READY' });
      await expect(completeSetupOnboarding(W, { code: 'mock-code', wabaId: '123', onboardingMode: 'COEXISTENCE' })).rejects.toMatchObject({ code: 'PHONE_REQUIRED' });
      expect(call.mock.calls.some(([path]) => path.includes('subscribed_apps'))).toBe(false);
      expect(update).not.toHaveBeenCalled();
    } finally { env.META_APP_ID = original.app; env.META_APP_SECRET = original.secret; env.ENCRYPTION_KEY = original.encryption; }
  });
  it('stores a Standard pending phone without representing it as send-ready', async () => {
    const original = { app: env.META_APP_ID, secret: env.META_APP_SECRET, encryption: env.ENCRYPTION_KEY };
    env.META_APP_ID = 'mock-app'; env.META_APP_SECRET = 'mock-secret'; env.ENCRYPTION_KEY = 'mock-key';
    try {
      vi.spyOn(mongoose, 'startSession').mockResolvedValue({ withTransaction: async (work: () => Promise<unknown>) => work(), endSession: vi.fn() } as never);
      vi.spyOn(Workspace, 'exists').mockResolvedValue({ _id: W } as never);
      const noConflict = { session: () => Promise.resolve(null), then: (resolve: (value: null) => unknown) => Promise.resolve(null).then(resolve) };
      vi.spyOn(WhatsAppAccount, 'exists').mockReturnValue(noConflict as never);
      vi.spyOn(WhatsAppPhoneNumber, 'exists').mockReturnValue(noConflict as never);
      vi.spyOn(MetaConnection, 'findOneAndUpdate').mockResolvedValue({ _id: C } as never);
      vi.spyOn(WhatsAppAccount, 'findOneAndUpdate').mockResolvedValue({ _id: A } as never);
      vi.spyOn(WhatsAppAccount, 'updateMany').mockResolvedValue({} as never);
      const phone = vi.spyOn(WhatsAppPhoneNumber, 'findOneAndUpdate').mockResolvedValue({} as never);
      vi.spyOn(WhatsAppPhoneNumber, 'updateMany').mockResolvedValue({} as never);
      vi.spyOn(MetaCredential, 'findOneAndUpdate').mockResolvedValue({} as never);
      vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ access_token: 'mock-token' } as never).mockResolvedValueOnce({ id: '123' } as never).mockResolvedValueOnce({ data: [{ id: '456', status: 'PENDING', code_verification_status: 'NOT_VERIFIED' }] } as never).mockResolvedValueOnce({ success: true } as never);
      expect(await completeSetupOnboarding(W, { code: 'mock-code', wabaId: '123', phoneNumberId: '456', onboardingMode: 'STANDARD' })).toEqual({ synced: 1 });
      expect(phone.mock.calls[0]?.[1]).toMatchObject({ $set: { registrationStatus: 'PENDING' } });
    } finally { env.META_APP_ID = original.app; env.META_APP_SECRET = original.secret; env.ENCRYPTION_KEY = original.encryption; }
  });
  it('refresh reuses owned IDs, preserves omitted metadata and never replaces the credential', async () => {
    const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const noConflict = { session: () => Promise.resolve(null), then: (resolve: (value: null) => unknown) => Promise.resolve(null).then(resolve) };
    vi.spyOn(WhatsAppAccount, 'exists').mockReturnValue(noConflict as never);
    vi.spyOn(WhatsAppPhoneNumber, 'exists').mockReturnValue(noConflict as never);
    vi.spyOn(MetaConnection, 'exists').mockReturnValue({ session: () => Promise.resolve({ _id: C }) } as never);
    const connection = vi.spyOn(MetaConnection, 'findOneAndUpdate').mockResolvedValue({ _id: C } as never);
    const account = vi.spyOn(WhatsAppAccount, 'findOneAndUpdate').mockResolvedValue({ _id: A } as never);
    vi.spyOn(WhatsAppAccount, 'updateMany').mockResolvedValue({} as never);
    const unavailable = vi.spyOn(WhatsAppPhoneNumber, 'updateMany').mockResolvedValue({} as never);
    vi.spyOn(WhatsAppPhoneNumber, 'findOneAndUpdate').mockResolvedValue({} as never);
    const credential = vi.spyOn(MetaCredential, 'findOneAndUpdate');
    const graphCall = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ id: '123' } as never).mockResolvedValueOnce({ data: [{ id: '456', status: 'CONNECTED', code_verification_status: 'VERIFIED' }] } as never);
    expect(await refreshSetupAssets(W)).toEqual({ synced: 1 });
    expect(connection.mock.calls[0]?.[0]).toEqual({ workspaceId: W, provider: 'meta' });
    expect(account.mock.calls[0]?.[0]).toEqual({ workspaceId: W, wabaId: '123' });
    expect(account.mock.calls[0]?.[1]).toMatchObject({ $set: { connectionId: C, status: 'CONNECTED' } });
    expect(JSON.stringify(account.mock.calls[0]?.[1])).not.toContain('name');
    expect(credential).not.toHaveBeenCalled();
    expect(unavailable).toHaveBeenCalledWith({ workspaceId: W, whatsappAccountId: A, phoneNumberId: { $nin: ['456'] } }, { $set: expect.objectContaining({ registrationStatus: 'UNAVAILABLE' }) }, expect.anything());
    expect(graphCall.mock.calls.some(([path]) => path.includes('subscribed_apps'))).toBe(false);
  });
  it('disconnect deactivates only local owned account/connection in a transaction', async () => {
    const session = { withTransaction: async (work: () => Promise<unknown>) => work(), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(session as never);
    const connectionUpdate = vi.spyOn(MetaConnection, 'findOneAndUpdate').mockResolvedValue({ _id: C } as never);
    const accountUpdate = vi.spyOn(WhatsAppAccount, 'updateMany').mockResolvedValue({} as never);
    const call = vi.spyOn(graph, 'graphRequest');
    expect(await disconnectSetup(W)).toEqual({ disconnected: true });
    expect(connectionUpdate.mock.calls[0]?.[0]).toEqual({ workspaceId: W, provider: 'meta', status: 'CONNECTED' });
    expect(accountUpdate.mock.calls[0]?.[0]).toEqual({ workspaceId: W, connectionId: C });
    expect(call).not.toHaveBeenCalled(); expect(session.endSession).toHaveBeenCalled();
  });
  it('registration validates PIN and rejects caller asset identifiers', async () => {
    await expect(registerSetupPhone(W, { pin: '123' })).rejects.toMatchObject({ code: 'INVALID_PIN' });
    await expect(registerSetupPhone(W, { pin: '123456', phoneNumberId: '999' })).rejects.toMatchObject({ code: 'INVALID_PIN' });
  });
  it('registration proves Meta phone ownership before sending a register request', async () => {
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValue({ data: [{ id: '999' }] } as never);
    await expect(registerSetupPhone(W, { pin: '123456' })).rejects.toMatchObject({ code: 'PHONE_OWNERSHIP_MISMATCH' });
    expect(call.mock.calls.some(([path]) => path.endsWith('/register'))).toBe(false);
  });
  it('registers a pending phone and persists only confirmed provider state', async () => {
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ data: [{ id: '456', status: 'PENDING' }] } as never).mockResolvedValueOnce({ success: true } as never).mockResolvedValueOnce({ data: [{ id: '456', status: 'CONNECTED' }] } as never);
    const update = vi.spyOn(WhatsAppPhoneNumber, 'updateOne').mockResolvedValue({} as never);
    expect(await registerSetupPhone(W, { pin: '123456' })).toEqual({ registeredNow: true, state: 'REGISTERED' });
    expect(call).toHaveBeenCalledWith('456/register', expect.objectContaining({ body: { messaging_product: 'whatsapp', pin: '123456' } }));
    expect(update).toHaveBeenCalledWith({ _id: P, workspaceId: W, whatsappAccountId: A }, { $set: expect.objectContaining({ registrationStatus: 'CONNECTED' }) });
  });
  it('does not resend registration for an already registered phone', async () => {
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValue({ data: [{ id: '456', status: 'REGISTERED' }] } as never);
    vi.spyOn(WhatsAppPhoneNumber, 'updateOne').mockResolvedValue({} as never);
    expect(await registerSetupPhone(W, { pin: '123456' })).toMatchObject({ registeredNow: false });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('rejects coexistence and ambiguous multi-phone registration', async () => {
    vi.mocked(context.resolveConnectedWhatsApp).mockResolvedValueOnce({ ...connected, connection: { onboardingMode: 'COEXISTENCE' } } as never);
    await expect(registerSetupPhone(W, { pin: '123456' })).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    vi.mocked(context.resolveConnectedWhatsApp).mockResolvedValueOnce({ ...connected, phones: [] } as never);
    await expect(registerSetupPhone(W, { pin: '123456' })).rejects.toMatchObject({ code: 'PHONE_SELECTION_REQUIRED' });
  });
  it('validates exact provider fields/limits and rejects identifiers and profile handles', () => {
    expect(validateBusinessProfile({ about: 'Hello', websites: ['https://example.test'], vertical: 'EDU' })).toEqual({ about: 'Hello', websites: ['https://example.test'], vertical: 'EDU' });
    for (const input of [{ name: 'changed' }, { profile_picture_handle: 'bad' }, { about: 'x'.repeat(140) }, { websites: ['file:///etc/passwd'] }, { email: 'invalid' }, { vertical: 'FAKE' }, { constructor: 'unsafe' }]) expect(() => validateBusinessProfile(input)).toThrow();
  });
  it('reads and updates the server-resolved phone profile with no provider secrets in response', async () => {
    vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ data: [{ about: 'Old', secret: 'must-not-return' }] } as never).mockResolvedValueOnce({ success: true } as never).mockResolvedValueOnce({ data: [{ about: 'New' }] } as never);
    expect(await getBusinessProfile(W)).toEqual({ displayName: 'Business', profile: { about: 'Old' } });
    expect(await updateBusinessProfile(W, { about: 'New' })).toEqual({ displayName: 'Business', profile: { about: 'New' } });
  });
  it('checks picture content signatures instead of trusting MIME claims', () => {
    expect(validPictureSignature(Buffer.from([137,80,78,71,13,10,26,10]), 'image/png')).toBe(true);
    expect(validPictureSignature(Buffer.from([255,216,255]), 'image/jpeg')).toBe(true);
    expect(validPictureSignature(Buffer.from('not an image'), 'image/png')).toBe(false);
  });
  it('reuses the existing resumable upload and never accepts caller-provided picture handles', async () => {
    vi.mocked(readFile).mockResolvedValue(Buffer.from([137,80,78,71,13,10,26,10]) as never);
    const upload = vi.spyOn(graph, 'uploadTemplateHeaderMedia').mockResolvedValue('mock-handle');
    const call = vi.spyOn(graph, 'graphRequest').mockResolvedValueOnce({ success: true } as never).mockResolvedValueOnce({ data: [{ profile_picture_url: 'https://example.test/picture' }] } as never);
    const file = { path: 'server-created-test-fixture', originalname: 'picture.png', size: 8, mimetype: 'image/png' } as Express.Multer.File;
    expect(await updateBusinessPicture(W, file)).toMatchObject({ profile: { profile_picture_url: 'https://example.test/picture' } });
    expect(upload).toHaveBeenCalledWith({ accessToken: 'mock-only', filePath: 'server-created-test-fixture', fileName: 'business-profile.png', fileSize: 8, mimeType: 'image/png' });
    expect(call).toHaveBeenCalledWith('456/whatsapp_business_profile', expect.objectContaining({ body: { messaging_product: 'whatsapp', profile_picture_handle: 'mock-handle' } }));
    await expect(updateBusinessPicture(W, { ...file, size: 6000000 })).rejects.toMatchObject({ code: 'INVALID_PROFILE_PICTURE' });
    expect(upload).toHaveBeenCalledTimes(1);
  });
});
