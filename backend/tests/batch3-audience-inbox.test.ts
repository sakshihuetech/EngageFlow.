import type { RequestHandler } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Contact } from '../src/models/contact.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { bulkContacts, getContact, safeContactAttributes } from '../src/controllers/audience.controller.js';
import { updateConversation } from '../src/controllers/inbox.controller.js';
import { importContacts, importPayloads } from '../src/services/audience/import.service.js';
import * as connectionContext from '../src/services/whatsapp/connection-context.service.js';

const W = '64b000000000000000000001'; const ID = '64b000000000000000000011';
function invoke(handler: RequestHandler, body: unknown = {}, workspace = W) {
  return new Promise<unknown>((resolve, reject) => handler({ workspaceContext: { workspaceId: workspace }, params: { id: ID }, body, query: {} } as never, { json: resolve } as never, reject));
}
afterEach(() => vi.restoreAllMocks());
describe('Batch 3 audience safety', () => {
  it('does not render secret-like historical contact attributes in detail', () => {
    expect(safeContactAttributes({ tier: 'pro', nested: { accessToken: 'private', credential: 'private', safe: 2 }, api_key: 'private' })).toEqual({ tier: 'pro', nested: { safe: 2 } });
  });
  const input = { name: 'Ada', phone: '0091 98765 43210', whatsappConsent: { status: 'OPTED_IN', evidence: 'invented' } };
  it('normalizes E.164 and always imports Unknown consent', () => {
    expect(importPayloads([input])[0]?.payload).toMatchObject({ phoneE164: '+919876543210', whatsappConsent: { status: 'UNKNOWN' }, source: 'CSV_IMPORT' });
    expect(importPayloads([{ ...input, phone: '123' }])[0]?.error).toBeDefined();
    expect(() => importPayloads(Array(101).fill(input))).toThrow();
    expect(importPayloads([{ ...input, workspaceId: W }])[0]?.error).toBeDefined();
  });
  it('skips duplicates without altering existing contact consent/history', async () => {
    const exists = vi.spyOn(Contact, 'exists').mockResolvedValue(null);
    const create = vi.spyOn(Contact, 'create').mockResolvedValue({} as never);
    const result = await importContacts(W, [input, input], false);
    expect(result).toMatchObject({ created: 1, duplicates: 1 });
    expect(exists).toHaveBeenCalledWith({ workspaceId: W, phoneE164: '+919876543210' });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ workspaceId: W, whatsappConsent: { status: 'UNKNOWN' } });
    exists.mockResolvedValue({ _id: ID } as never);
    expect(await importContacts(W, [input], false)).toMatchObject({ created: 0, duplicates: 1 });
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('preview is read-only and handles unique-index races', async () => {
    vi.spyOn(Contact, 'exists').mockResolvedValue(null);
    const create = vi.spyOn(Contact, 'create').mockRejectedValue({ code: 11000 });
    expect(await importContacts(W, [input], true)).toMatchObject({ valid: 1, created: 0 });
    expect(create).not.toHaveBeenCalled();
    expect(await importContacts(W, [input], false)).toMatchObject({ duplicates: 1, created: 0 });
  });
  it.each([['ADD_TAG', { tags: ['VIP'] }, { $addToSet: { tags: { $each: ['VIP'] } } }], ['REMOVE_TAG', { tags: ['VIP'] }, { $pull: { tags: { $in: ['VIP'] } } }], ['STATUS', { status: 'BLOCKED' }, { $set: { status: 'BLOCKED' } }], ['DELETE', {}, { $set: { status: 'DELETED' } }], ['RESTORE', {}, { $set: { status: 'ACTIVE' } }]])('workspace-scopes bulk %s without touching consent', async (action, values, mutation) => {
    const update = vi.spyOn(Contact, 'updateMany').mockResolvedValue({ matchedCount: 1, modifiedCount: 1 } as never);
    await invoke(bulkContacts, { ids: [ID], action, ...values });
    expect(update).toHaveBeenCalledWith({ workspaceId: W, _id: { $in: [ID] }, status: action === 'RESTORE' ? 'DELETED' : { $ne: 'DELETED' } }, mutation, { runValidators: true });
  });
  it('rejects invalid/broad bulk selection and cross-workspace detail', async () => {
    await expect(invoke(bulkContacts, { ids: Array(101).fill(ID), action: 'DELETE' })).rejects.toMatchObject({ code: 'INVALID_SELECTION' });
    const find = vi.spyOn(Contact, 'findOne').mockReturnValue({ lean: async () => null } as never);
    await expect(invoke(getContact)).rejects.toMatchObject({ code: 'CONTACT_NOT_FOUND' });
    expect(find).toHaveBeenCalledWith({ _id: ID, workspaceId: W });
  });
});
describe('Inbox close/reopen', () => {
  const accountId = '64b000000000000000000012';
  beforeEach(() => { vi.spyOn(connectionContext, 'resolveConnectedWhatsApp').mockResolvedValue({ account: { _id: accountId } } as never); });
  it.each(['OPEN', 'CLOSED'])('persists %s only in the resolved workspace', async status => {
    const update = vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue({ toObject: () => ({ _id: ID, status }) } as never);
    await invoke(updateConversation, { status });
    expect(update).toHaveBeenCalledWith({ _id: ID, workspaceId: W, whatsappAccountId: accountId }, { $set: { status } }, { new: true });
  });
  it('rejects missing cross-workspace conversations and invalid status', async () => {
    vi.spyOn(Conversation, 'findOneAndUpdate').mockResolvedValue(null);
    await expect(invoke(updateConversation, { status: 'CLOSED' })).rejects.toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
    await expect(invoke(updateConversation, { status: 'INVALID' })).rejects.toMatchObject({ code: 'INVALID_CONVERSATION_STATUS' });
  });
});
