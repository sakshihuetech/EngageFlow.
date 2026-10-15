import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '../src/config/env.js';
import { Campaign } from '../src/models/campaign.model.js';
import { CampaignRecipient } from '../src/models/campaign-recipient.model.js';
import { MetaConnection } from '../src/models/meta-connection.model.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../src/models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';
import { createContactRecipient, createPastedRecipient, snapshotAudience } from '../src/services/broadcast/audience.service.js';
import { Contact } from '../src/models/contact.model.js';
import { Segment } from '../src/models/segment.model.js';
import { launchCampaign } from '../src/services/broadcast/execution.service.js';
import { resolveParameterMapping, templateRequirements, validateParameterMapping } from '../src/services/broadcast/parameter-mapping.service.js';
import { validateRecipientSendPayload } from '../src/services/broadcast/worker.service.js';
import { buildTemplatePayload } from '../src/services/whatsapp/send-approved-template.service.js';

const workspaceId = '64b000000000000000000001';
const accountId = '64b000000000000000000002';
const templateId = '64b000000000000000000003';
const components = [{ type: 'HEADER', format: 'TEXT', text: 'Order {{1}}' }, { type: 'BODY', text: 'Hi {{1}}, order {{2}} is ready.' }, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://example.com/{{1}}' }] }];
const mapping = { header: [{ source: 'CONTACT_ATTRIBUTE', key: 'attributes.orderId' }], body: [{ source: 'CONTACT_ATTRIBUTE', key: 'firstName', fallback: 'Customer' }, { source: 'CONTACT_ATTRIBUTE', key: 'attributes.orderId' }], buttons: { '0': { source: 'CONTACT_ATTRIBUTE', key: 'attributes.orderId' } } };
const campaign = { _id: '64b000000000000000000004', workspaceId, parameterMapping: mapping };
const contact = (name: string, orderId?: string) => ({ _id: name === 'Kartik' ? '64b000000000000000000005' : '64b000000000000000000006', name, phoneE164: name === 'Kartik' ? '+919876543210' : '+919876543211', email: 'example@example.com', tags: ['customer'], attributes: orderId ? { orderId } : {}, status: 'ACTIVE', whatsappConsent: { status: 'OPTED_IN' } });
const originalEnv = { live: env.CAMPAIGN_LIVE_SEND_ENABLED, transport: env.CAMPAIGN_TRANSPORT, bypass: env.CAMPAIGN_TEST_BYPASS_CONSENT };
afterEach(() => { vi.restoreAllMocks(); env.CAMPAIGN_LIVE_SEND_ENABLED = originalEnv.live; env.CAMPAIGN_TRANSPORT = originalEnv.transport; env.CAMPAIGN_TEST_BYPASS_CONSENT = originalEnv.bypass; });

describe('Broadcast recipient parameter mapping', () => {
  it('persists definitions in the existing V2 Campaign field, without recipient values', async () => {
    const draft = new Campaign({ workspaceId, whatsappAccountId: accountId, phoneNumberId: '123', name: 'Order notice', whatsAppTemplateId: templateId, parameterMapping: mapping });
    await expect(draft.validate()).resolves.toBeUndefined();
    expect(draft.parameterMapping).toEqual(mapping);
    expect(draft.toObject()).not.toHaveProperty('resolvedParameters');
  });
  it('detects body, header, and dynamic URL variables from persisted components', () => {
    expect(templateRequirements(components)).toEqual({ body: 2, header: 1, headerType: 'TEXT', buttons: [0] });
    expect(templateRequirements([{ type: 'BODY', text: 'No variables' }]).body).toBe(0);
    expect(validateRecipientSendPayload({ templateSnapshot: { name: 'plain', language: 'en_US', components: [{ type: 'BODY', text: 'No variables' }] }, recipientPhone: '919876543210', parameters: resolveParameterMapping(validateParameterMapping([{ type: 'BODY', text: 'No variables' }], {}).mapping) }).payload.template).toEqual({ name: 'plain', language: { code: 'en_US' } });
  });

  it('resolves static mappings and accepts V2 static variable arrays', () => {
    const staticMapping = validateParameterMapping([{ type: 'BODY', text: 'Sale {{1}}' }], { body: [{ source: 'STATIC', value: 'Diwali Sale' }], header: [], buttons: {} });
    expect(resolveParameterMapping(staticMapping.mapping).bodyVariables).toEqual(['Diwali Sale']);
    expect(resolveParameterMapping(validateParameterMapping([{ type: 'BODY', text: 'Sale {{1}}' }], { bodyVariables: ['Diwali Sale'] }).mapping).bodyVariables).toEqual(['Diwali Sale']);
  });

  it('resolves selected contacts and segment contacts independently', () => {
    const parsed = validateParameterMapping(components, mapping).mapping;
    const first = createContactRecipient(campaign, contact('Kartik', 'ORD101'), parsed);
    const second = createContactRecipient(campaign, contact('Rahul', 'ORD102'), parsed);
    expect(first.resolvedParameters).toMatchObject({ bodyVariables: ['Kartik', 'ORD101'], headerVariables: ['ORD101'], buttonVariables: { '0': 'ORD101' } });
    expect(second.resolvedParameters).toMatchObject({ bodyVariables: ['Rahul', 'ORD102'], headerVariables: ['ORD102'], buttonVariables: { '0': 'ORD102' } });
    expect(first.resolvedParameters).not.toBe(second.resolvedParameters);
    const segmentRecipient = createContactRecipient({ ...campaign, audienceDefinition: { source: 'SEGMENT', segmentId: '64b000000000000000000007' } }, contact('Rahul', 'ORD102'), parsed);
    expect(segmentRecipient.resolvedParameters).toMatchObject({ bodyVariables: ['Rahul', 'ORD102'] });
  });

  it.each(['CONTACTS', 'SEGMENT'] as const)('snapshots %s through workspace-scoped contact queries', async (source) => {
    const row = contact('Kartik', 'ORD101');
    const contactQuery = vi.spyOn(Contact, 'find').mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [row] }) }) } as never);
    if (source === 'SEGMENT') vi.spyOn(Segment, 'findOne').mockReturnValue({ lean: async () => ({ definition: { match: 'ALL', conditions: [{ field: 'tags', operator: 'CONTAINS', value: 'customer' }] } }) } as never);
    const written = vi.spyOn(CampaignRecipient, 'bulkWrite').mockResolvedValue({} as never);
    vi.spyOn(CampaignRecipient, 'aggregate').mockResolvedValue([{ _id: 'PENDING', count: 1 }] as never);
    vi.spyOn(Campaign, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    await snapshotAudience({ ...campaign, templateSnapshot: { components }, audienceDefinition: source === 'CONTACTS' ? { source, contactIds: [row._id] } : { source, segmentId: '64b000000000000000000007' } });
    expect(contactQuery.mock.calls[0]?.[0]).toMatchObject({ workspaceId });
    const operations = written.mock.calls[0]?.[0] as Array<{ updateOne: { update: { $setOnInsert: { resolvedParameters: { bodyVariables: string[] } } } } }>;
    expect(operations[0]?.updateOne.update.$setOnInsert.resolvedParameters.bodyVariables).toEqual(['Kartik', 'ORD101']);
  });

  it('uses fallback and skips only a recipient with missing data', () => {
    const firstNameOnly = validateParameterMapping([{ type: 'BODY', text: 'Hi {{1}}' }], { body: [{ source: 'CONTACT_ATTRIBUTE', key: 'email', fallback: 'Customer' }] }).mapping;
    expect(resolveParameterMapping(firstNameOnly, { name: 'Kartik' }).bodyVariables).toEqual(['Customer']);
    const parsed = validateParameterMapping(components, mapping).mapping;
    const missing = createContactRecipient(campaign, contact('Kartik'), parsed);
    expect(missing.status).toBe('SKIPPED');
    expect(missing.failureCode).toBe('PARAMETER_RESOLUTION_FAILED');
    expect(missing.failureMessage).not.toContain('Kartik');
  });

  it('resolves pasted numbers against a matched contact and uses fallback without one', () => {
    const parsed = validateParameterMapping(components, mapping).mapping;
    const matched = createPastedRecipient(campaign, '+919876543210', 0, contact('Kartik', 'ORD101'), parsed);
    expect(matched.status).toBe('PENDING');
    expect(matched.resolvedParameters).toMatchObject({ bodyVariables: ['Kartik', 'ORD101'] });
    env.CAMPAIGN_TEST_BYPASS_CONSENT = 'true';
    const noContact = createPastedRecipient(campaign, '+919876543212', 1, undefined, parsed);
    expect(noContact.status).toBe('SKIPPED');
    expect(noContact.failureCode).toBe('PARAMETER_RESOLUTION_FAILED');
    const blocked = createPastedRecipient(campaign, '+919876543214', 3, { ...contact('Kartik', 'ORD101'), status: 'BLOCKED' }, parsed);
    expect(blocked.status).toBe('SKIPPED');
    expect(blocked.failureCode).toBe('CONTACT_INACTIVE');
    const fallback = validateParameterMapping([{ type: 'BODY', text: 'Hi {{1}}' }], { body: [{ source: 'CONTACT_ATTRIBUTE', key: 'firstName', fallback: 'Customer' }] }).mapping;
    expect(resolveParameterMapping(fallback).bodyVariables).toEqual(['Customer']);
    const fallbackPasted = createPastedRecipient(campaign, '+919876543213', 2, undefined, fallback);
    expect(fallbackPasted.status).toBe('PENDING');
    expect(fallbackPasted.resolvedParameters).toMatchObject({ bodyVariables: ['Customer'] });
    const staticMapping = validateParameterMapping([{ type: 'BODY', text: 'Sale {{1}}' }], { body: [{ source: 'STATIC', value: 'Diwali Sale' }] }).mapping;
    expect(createPastedRecipient(campaign, '+919876543215', 4, undefined, staticMapping).resolvedParameters).toMatchObject({ bodyVariables: ['Diwali Sale'] });
  });

  it('rejects incomplete counts, unsafe custom keys, and missing media before launch', () => {
    expect(() => validateParameterMapping(components, {})).toThrow(/Body requires exactly 2/i);
    expect(() => validateParameterMapping([{ type: 'BODY', text: 'Hi {{1}}' }], { body: [{ source: 'CONTACT_ATTRIBUTE', key: 'attributes.password' }] })).toThrow(/supported contact attribute/i);
    expect(() => validateParameterMapping([{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }], {})).toThrow(/header needs matching/i);
    const mediaComponents = [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Hi' }];
    const image = validateParameterMapping(mediaComponents, {}, { media: { type: 'IMAGE', source: 'LINK', value: 'https://example.com/image.png' } });
    expect(validateRecipientSendPayload({ templateSnapshot: { name: 'image_notice', language: 'en_US', components: mediaComponents }, recipientPhone: '919876543210', parameters: resolveParameterMapping(image.mapping), ...(image.media ? { media: image.media } : {}) }).payload.template.components).toMatchObject([{ type: 'header' }]);
    expect(validateParameterMapping([{ type: 'BODY', text: 'Hi' }], {}).mapping.body).toEqual([]);
  });

  it('produces valid distinct provider payloads and rejects malformed worker parameters', () => {
    const parsed = validateParameterMapping(components, mapping).mapping;
    const build = (name: string, order: string) => buildTemplatePayload({ template: { name: 'order_ready', language: 'en_US', components }, recipient: '919876543210', ...resolveParameterMapping(parsed, contact(name, order)) });
    expect(build('Kartik', 'ORD101').payload).not.toEqual(build('Rahul', 'ORD102').payload);
    expect(() => validateRecipientSendPayload({ templateSnapshot: { name: 'order_ready', language: 'en_US', components }, recipientPhone: '919876543210', parameters: { headerVariables: ['ORD101'], bodyVariables: [] } })).toThrow(/exactly 2/i);
  });

  it('blocks launch on invalid mapping before snapshot, queue, or worker claims', async () => {
    env.CAMPAIGN_LIVE_SEND_ENABLED = 'true'; env.CAMPAIGN_TRANSPORT = 'mock';
    vi.spyOn(WhatsAppAccount, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountId, connectionId: accountId }) } as never);
    vi.spyOn(MetaConnection, 'findOne').mockReturnValue({ lean: async () => ({ _id: accountId }) } as never);
    vi.spyOn(WhatsAppPhoneNumber, 'findOne').mockReturnValue({ lean: async () => ({ registrationStatus: 'REGISTERED', codeVerificationStatus: 'VERIFIED' }) } as never);
    vi.spyOn(WhatsAppTemplate, 'findOne').mockReturnValue({ lean: async () => ({ _id: templateId, components }) } as never);
    const claimed = vi.spyOn(Campaign, 'findOneAndUpdate');
    const recipients = vi.spyOn(CampaignRecipient, 'bulkWrite');
    await expect(launchCampaign({ campaign: { _id: campaign._id, workspaceId, whatsappAccountId: accountId, phoneNumberId: '123', whatsAppTemplateId: templateId, status: 'DRAFT', audienceDefinition: { source: 'CONTACTS', contactIds: [contact('Kartik')._id] }, parameterMapping: {} } as never, workspaceId, mode: 'SEND_NOW', timezone: 'UTC' })).rejects.toThrow(/Body requires exactly 2/i);
    expect(claimed).not.toHaveBeenCalled(); expect(recipients).not.toHaveBeenCalled();
  });
});
