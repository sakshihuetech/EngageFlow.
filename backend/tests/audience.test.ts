import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestHandler } from 'express';
import { env } from '../src/config/env.js';
import { Campaign } from '../src/models/campaign.model.js';
import { Contact } from '../src/models/contact.model.js';
import { Segment } from '../src/models/segment.model.js';
import { deleteContact, listContacts, restoreContact, updateContact } from '../src/controllers/audience.controller.js';
import { cleanAttributes, cleanConsent, cleanTags, contactCreatePayload, contactUpdatePayload, createOrRestoreContact, deleteSegmentSafely, parseSegmentDefinition, segmentPayload } from '../src/services/audience/audience.service.js';
import { createContactRecipient, segmentFilter } from '../src/services/broadcast/audience.service.js';
import { canBypassCampaignConsent } from '../src/services/broadcast/consent.service.js';
import { parseCursorPagination } from '../src/services/broadcast/pagination.js';

const W1 = '64b000000000000000000001';
const W2 = '64b000000000000000000002';
const C1 = '64b000000000000000000011';
const S1 = '64b000000000000000000021';

afterEach(() => vi.restoreAllMocks());

function document(value: Record<string, unknown>) { return { ...value, toObject: () => value }; }
function invoke(handler: RequestHandler, request: Record<string, unknown>) {
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    let status = 200;
    const response = { status(code: number) { status = code; return this; }, json(body: unknown) { resolve({ status, body }); return this; } };
    handler(request as never, response as never, reject);
  });
}

describe('Audience migration', () => {
  it('normalizes E.164 and preserves the V2 contact payload contract', () => {
    expect(contactCreatePayload({ name: ' Ada ', phone: '0091 98765 43210', tags: ['Lead'], whatsappConsent: { status: 'OPTED_IN', source: ' form ' } })).toMatchObject({
      name: 'Ada', phoneE164: '+919876543210', tags: ['Lead'], whatsappConsent: { status: 'OPTED_IN', source: 'form' }, source: 'MANUAL',
    });
    expect(() => contactCreatePayload({ name: 'Bad', phone: '123' })).toThrow(/country code/i);
  });

  it('deduplicates normalized tags without changing the first display value', () => {
    expect(cleanTags([' Lead ', 'lead', 'VIP', '', 'vip'])).toEqual(['Lead', 'VIP']);
  });

  it('accepts bounded attributes and rejects prototype/secret-like keys', () => {
    expect(cleanAttributes({ lifecycleStage: 'customer', nested: { score: 4 } })).toEqual({ lifecycleStage: 'customer', nested: { score: 4 } });
    expect(() => cleanAttributes({ token: 'unsafe' })).toThrow(/unsafe key/i);
    expect(() => cleanAttributes(JSON.parse('{"__proto__":{"polluted":true}}'))).toThrow(/unsafe key/i);
  });

  it.each(['OPTED_IN', 'OPTED_OUT', 'UNKNOWN'])('preserves consent state %s', (status) => {
    expect(cleanConsent({ status })).toMatchObject({ status });
  });

  it('keeps production consent fail-closed', () => {
    expect(canBypassCampaignConsent({ nodeEnv: 'production', bypassEnabled: true })).toBe(false);
    expect(canBypassCampaignConsent({ nodeEnv: 'development', bypassEnabled: true })).toBe(true);
  });

  it('restores a deleted workspace-owned contact instead of creating a duplicate', async () => {
    const restored = document({ _id: C1, workspaceId: W1, name: 'Restored', phoneE164: '+919876543210', status: 'ACTIVE' });
    const find = vi.spyOn(Contact, 'findOneAndUpdate').mockResolvedValue(restored as never);
    const create = vi.spyOn(Contact, 'create');
    const result = await createOrRestoreContact(W1, { name: 'Restored', phone: '+919876543210' });
    expect(result.restored).toBe(true);
    expect(find.mock.calls[0]?.[0]).toEqual({ workspaceId: W1, phoneE164: '+919876543210', status: 'DELETED' });
    expect(create).not.toHaveBeenCalled();
  });

  it('protects duplicate contacts in the same workspace', async () => {
    vi.spyOn(Contact, 'findOneAndUpdate').mockResolvedValue(null);
    vi.spyOn(Contact, 'create').mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    await expect(createOrRestoreContact(W1, { name: 'Duplicate', phone: '+919876543210' })).rejects.toMatchObject({ code: 'DUPLICATE_CONTACT' });
  });

  it('builds safe partial contact updates', () => {
    expect(contactUpdatePayload({ tags: ['One', 'one'], status: 'BLOCKED', whatsappConsent: { status: 'OPTED_OUT' } })).toMatchObject({ tags: ['One'], status: 'BLOCKED', whatsappConsent: { status: 'OPTED_OUT' } });
    expect(() => contactUpdatePayload({ workspaceId: W2 })).toThrow(/server-controlled/i);
  });

  it('soft deletes and restores only within the resolved workspace', async () => {
    const mutation = vi.spyOn(Contact, 'findOneAndUpdate')
      .mockResolvedValueOnce(document({ _id: C1, status: 'DELETED' }) as never)
      .mockResolvedValueOnce(document({ _id: C1, name: 'Restored', phoneE164: '+919876543210', status: 'ACTIVE' }) as never);
    const base = { workspaceContext: { workspaceId: W1 }, params: { id: C1 }, body: {}, query: {} };
    expect((await invoke(deleteContact, base)).body).toMatchObject({ success: true, data: { status: 'DELETED' } });
    expect((await invoke(restoreContact, base)).body).toMatchObject({ success: true, data: { status: 'ACTIVE' } });
    expect(mutation.mock.calls[0]?.[0]).toMatchObject({ _id: C1, workspaceId: W1 });
    expect(mutation.mock.calls[1]?.[0]).toMatchObject({ _id: C1, workspaceId: W1, status: 'DELETED' });
  });

  it('updates consent timestamps without crossing workspace boundaries', async () => {
    const mutation = vi.spyOn(Contact, 'findOneAndUpdate').mockResolvedValue(document({ _id: C1, name: 'A', phoneE164: '+919876543210', status: 'ACTIVE', whatsappConsent: { status: 'OPTED_OUT' } }) as never);
    await invoke(updateContact, { workspaceContext: { workspaceId: W1 }, params: { id: C1 }, body: { whatsappConsent: { status: 'OPTED_OUT' } }, query: {} });
    expect(mutation.mock.calls[0]?.[0]).toMatchObject({ _id: C1, workspaceId: W1 });
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ $set: { whatsappConsent: { status: 'OPTED_OUT' }, optedOutAt: expect.any(Date) } });
  });

  it('lists a bounded cursor page using the resolved workspace', async () => {
    const find = vi.spyOn(Contact, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) } as never);
    const response = await invoke(listContacts, { workspaceContext: { workspaceId: W2 }, params: {}, body: {}, query: { limit: '100', cursor: C1 } });
    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith({ workspaceId: W2, status: { $ne: 'DELETED' }, _id: { $lt: C1 } });
    expect(parseCursorPagination({ limit: 1_000 }).limit).toBe(100);
  });

  it('validates static and dynamic segment definitions', () => {
    expect(parseSegmentDefinition({ definition: { match: 'ANY', conditions: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] } })).toEqual({ match: 'ANY', conditions: [{ field: 'tags', operator: 'CONTAINS', value: 'vip' }] });
    expect(() => parseSegmentDefinition({ definition: { conditions: [{ field: 'attributes.token', operator: 'EQ', value: 'x' }] } })).toThrow(/unsupported condition/i);
  });

  it('calculates segment membership through the shared Broadcast filter', async () => {
    const count = vi.spyOn(Contact, 'countDocuments').mockResolvedValue(3);
    const payload = await segmentPayload(W1, { name: 'Opted in', type: 'DYNAMIC', definition: { match: 'ALL', conditions: [{ field: 'whatsappConsent.status', operator: 'EQ', value: 'OPTED_IN' }] } });
    expect(payload.estimatedCount).toBe(3);
    expect(count).toHaveBeenCalledWith({ workspaceId: W1, status: 'ACTIVE', $and: [{ 'whatsappConsent.status': 'OPTED_IN' }] });
    expect(segmentFilter(payload.definition)).toEqual({ $and: [{ 'whatsappConsent.status': 'OPTED_IN' }] });
  });

  it('blocks segment deletion while a workspace campaign is non-terminal', async () => {
    vi.spyOn(Segment, 'findOne').mockReturnValue({ lean: async () => ({ _id: S1, workspaceId: W1 }) } as never);
    vi.spyOn(Campaign, 'exists').mockResolvedValue({ _id: '64b000000000000000000099' } as never);
    const remove = vi.spyOn(Segment, 'findOneAndDelete');
    await expect(deleteSegmentSafely(W1, S1)).rejects.toMatchObject({ code: 'SEGMENT_IN_USE' });
    expect(remove).not.toHaveBeenCalled();
  });

  it('deletes an unreferenced segment only from its workspace', async () => {
    vi.spyOn(Segment, 'findOne').mockReturnValue({ lean: async () => ({ _id: S1, workspaceId: W1 }) } as never);
    vi.spyOn(Campaign, 'exists').mockResolvedValue(null);
    const remove = vi.spyOn(Segment, 'findOneAndDelete').mockResolvedValue({ _id: S1 } as never);
    await deleteSegmentSafely(W1, S1);
    expect(remove).toHaveBeenCalledWith({ _id: S1, workspaceId: W1 });
  });

  it('keeps Broadcast contact snapshots compatible and fail-closed', () => {
    const originalBypass = env.CAMPAIGN_TEST_BYPASS_CONSENT;
    env.CAMPAIGN_TEST_BYPASS_CONSENT = 'false';
    const campaign = { _id: '64b000000000000000000031', workspaceId: W1, whatsappAccountId: '64b000000000000000000032', parameterMapping: {} };
    const eligible = createContactRecipient(campaign, { _id: C1, name: 'A', phoneE164: '+919876543210', status: 'ACTIVE', tags: ['vip'], attributes: { lifecycleStage: 'customer' }, whatsappConsent: { status: 'OPTED_IN', accountId: campaign.whatsappAccountId, source: 'website', evidence: 'Opt-in form' } });
    const legacy = createContactRecipient(campaign, { _id: C1, name: 'A', phoneE164: '+919876543210', status: 'ACTIVE', whatsappConsent: { status: 'OPTED_IN' } });
    const unknown = createContactRecipient(campaign, { _id: C1, name: 'A', phoneE164: '+919876543210', status: 'ACTIVE', whatsappConsent: { status: 'UNKNOWN' } });
    expect(eligible).toMatchObject({ status: 'PENDING', contactSnapshot: { tags: ['vip'], attributes: { lifecycleStage: 'customer' } } });
    expect(legacy).toMatchObject({ status: 'SKIPPED', failureCode: 'CONSENT_NOT_OPTED_IN' });
    expect(unknown).toMatchObject({ status: 'SKIPPED', failureCode: 'CONSENT_NOT_OPTED_IN' });
    env.CAMPAIGN_TEST_BYPASS_CONSENT = originalBypass;
  });
});
