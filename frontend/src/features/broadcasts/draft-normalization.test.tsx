import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BroadcastWizard } from './components/BroadcastWizard';
import { futureSchedule, normalizeBroadcastDraft, normalizeBroadcastOptions, normalizeParameterMapping } from './draft-normalization';
import type { BroadcastCampaign, BroadcastOptions } from './types';

const view = vi.hoisted(() => ({ step: 0 }));
// SSR exercises the actual wizard's computed validation and each step without DOM/network side effects.
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react, useState: (initial: unknown) => react.useState(initial === 0 ? view.step : initial) };
});
afterEach(() => { view.step = 0; });

const options: BroadcastOptions = {
  configured: true, attributeKeys: [], segments: [],
  templates: [{ id: 'template', name: 'notice', language: 'en', category: 'UTILITY', components: [{ type: 'HEADER', format: 'TEXT', text: 'Hello {{1}}' }, { type: 'BODY', text: 'Order {{1}} for {{2}}' }, { type: 'BUTTONS', buttons: [{ type: 'URL', url: 'https://example.test/{{1}}' }] }] }],
};
// Shape observed in the real GET detail response: an empty object, not null/undefined.
const legacy: BroadcastCampaign = {
  id: 'legacy-draft', name: 'Legacy draft', status: 'DRAFT', channel: 'WHATSAPP', type: 'BROADCAST',
  whatsappAccountId: 'account', phoneNumberId: 'phone', whatsAppTemplateId: 'template',
  parameterMapping: {}, mediaMapping: {}, audienceDefinition: { source: 'PASTED', phones: [] },
  timezone: 'UTC', sendMode: 'DRAFT', audienceSnapshotCount: 0,
  counters: { total: 0, pending: 0, queued: 0, accepted: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0, cancelled: 0 },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};
function render(campaign?: BroadcastCampaign, inputOptions = options) {
  return renderToStaticMarkup(<MemoryRouter><BroadcastWizard options={inputOptions} initialCampaign={campaign} loading={false} onRetry={() => undefined} /></MemoryRouter>);
}

describe('Broadcast legacy draft editing', () => {
  it('opens the observed legacy API payload without crashing or changing the source record', () => {
    const before = JSON.stringify(legacy);
    expect(render(legacy)).toContain('Legacy draft');
    expect(JSON.stringify(legacy)).toBe(before);
    const draft = normalizeBroadcastDraft(legacy, options);
    expect(draft.parameterMapping.body).toHaveLength(2);
    expect(draft.parameterMapping.header).toHaveLength(1);
    expect(draft.parameterMapping.buttons['0']).toEqual({ source: 'STATIC', value: '' });
    expect(draft.templateParams).toEqual([]); expect(draft.media).toBeNull(); expect(draft.scheduledAt).toBeNull();
  });
  it('renders editable blank inputs for required legacy parameters instead of silently dropping personalization', () => {
    view.step = 2;
    const markup = render(legacy);
    expect(markup).toContain('Body {{1}} static value');
    expect(markup).toContain('Body {{2}} static value');
    expect(markup).toContain('Header {{1}} static value');
    expect(markup).toContain('Button 1 URL value static value');
    expect(markup).toContain('Complete each mapping');
  });
  it('normalizes null/partial mappings, missing arrays, options and template components', () => {
    const raw = { ...legacy, parameterMapping: { body: [null, { source: 'STATIC' }], header: null, buttons: null }, mediaMapping: null, audienceDefinition: { source: 'CONTACTS', contactIds: null }, templateParams: null, templateSnapshot: { components: null }, scheduledAt: 'invalid', timezone: 'invalid-zone' } as unknown as BroadcastCampaign;
    expect(() => render(raw)).not.toThrow();
    const draft = normalizeBroadcastDraft(raw, options);
    expect(draft.selectedContactIds).toEqual([]); expect(draft.parameterMapping.body[0]).toEqual({ source: 'STATIC', value: '' });
    expect(draft.templateSnapshot.components).toEqual([]); expect(draft.timezone).toBe('UTC'); expect(draft.scheduledLocal).toBe('');
    const incompleteOptions = { configured: true, templates: null, segments: null, attributeKeys: null } as unknown as BroadcastOptions;
    expect(normalizeBroadcastOptions(incompleteOptions)).toMatchObject({ templates: [], segments: [], attributeKeys: [] });
    expect(() => render(raw, incompleteOptions)).not.toThrow();
    expect(normalizeBroadcastOptions({ ...options, templates: [{ ...options.templates[0]!, components: undefined }] } as unknown as BroadcastOptions)?.templates[0]?.components).toEqual([]);
  });
  it('preserves existing modern personalization, media and audience values', () => {
    const campaign = { ...legacy, parameterMapping: { body: [{ source: 'CONTACT_ATTRIBUTE', key: 'name', fallback: 'Customer' }, { source: 'STATIC', value: 'Order' }], header: [{ source: 'STATIC', value: 'Greeting' }], buttons: { '0': { source: 'STATIC', value: 'reference' } } }, mediaMapping: { media: { type: 'DOCUMENT', source: 'LINK', value: 'https://example.test/file', fileName: 'notice.pdf' } }, audienceDefinition: { source: 'CONTACTS', contactIds: ['contact-1'] } } as BroadcastCampaign;
    const draft = normalizeBroadcastDraft(campaign, options);
    expect(draft.parameterMapping).toEqual(campaign.parameterMapping);
    expect(draft.media).toEqual(campaign.mediaMapping?.media);
    expect(draft.selectedContactIds).toEqual(['contact-1']);
    draft.parameterMapping.body[0] = { source: 'STATIC', value: 'Edited' };
    expect(campaign.parameterMapping?.body?.[0]).toEqual({ source: 'CONTACT_ATTRIBUTE', key: 'name', fallback: 'Customer' });
  });
  it('adapts the legacy static-variable contract already supported by the backend', () => {
    expect(normalizeParameterMapping({ bodyVariables: ['Customer'], headerVariables: ['Greeting'], buttonVariables: { '0': 'order' } })).toEqual({ body: [{ source: 'STATIC', value: 'Customer' }], header: [{ source: 'STATIC', value: 'Greeting' }], buttons: { '0': { source: 'STATIC', value: 'order' } } });
    expect(normalizeParameterMapping(null)).toEqual({ body: [], header: [], buttons: {} });
  });
  it('makes a required media header editable while leaving absent optional media null', () => {
    const mediaOptions = { ...options, templates: [{ ...options.templates[0]!, components: [{ type: 'HEADER', format: 'IMAGE' }, { type: 'BODY', text: 'Notice' }] }] };
    expect(normalizeBroadcastDraft(legacy, mediaOptions).media).toEqual({ type: 'IMAGE', source: 'LINK', value: '' });
    view.step = 2;
    expect(render(legacy, mediaOptions)).toContain('Header media reference');
  });
  it('keeps Create New Broadcast defaults and rendering intact', () => {
    const draft = normalizeBroadcastDraft(undefined, options, 'Asia/Calcutta');
    expect(draft.name).toBe(''); expect(draft.templateId).toBe(''); expect(draft.audienceSource).toBe('SEGMENT');
    expect(draft.parameterMapping).toEqual({ body: [], header: [], buttons: {} }); expect(draft.timezone).toBe('Asia/Calcutta');
    expect(render()).toContain('Campaign name');
  });
  it('opens a duplicated legacy draft without copying a schedule or requiring new backend fields', () => {
    const duplicate = { ...legacy, id: 'duplicate-draft', name: 'Legacy draft (Copy)', sendMode: 'DRAFT' } as BroadcastCampaign;
    expect(render(duplicate)).toContain('Legacy draft (Copy)');
    expect(normalizeBroadcastDraft(duplicate, options).scheduledLocal).toBe('');
  });
  it('preserves a scheduled draft timezone and prefills its correct local datetime', () => {
    const campaign = { ...legacy, scheduledAt: '2030-01-01T10:00:00.000Z', timezone: 'Asia/Calcutta', sendMode: 'SCHEDULE' } as BroadcastCampaign;
    const draft = normalizeBroadcastDraft(campaign, options, 'America/New_York');
    expect(draft.scheduledLocal).toBe('2030-01-01T15:30'); expect(draft.timezone).toBe('Asia/Calcutta');
    expect(futureSchedule(draft.scheduledLocal, draft.timezone, Date.parse('2030-01-01T09:59:00Z'))).toBe(true);
    expect(futureSchedule(draft.scheduledLocal, draft.timezone, Date.parse('2030-01-01T10:01:00Z'))).toBe(false);
    view.step = 3;
    expect(render(campaign)).toContain('value="2030-01-01T15:30"');
    expect(render(campaign)).toContain('Asia/Calcutta');
  });
  it('rejects malformed/past/nonexistent local schedules without replacing a saved schedule', () => {
    expect(futureSchedule('', 'UTC', 0)).toBe(false);
    expect(futureSchedule('invalid', 'UTC', 0)).toBe(false);
    expect(futureSchedule('2030-03-10T02:30', 'America/New_York', 0)).toBe(false);
  });
});
