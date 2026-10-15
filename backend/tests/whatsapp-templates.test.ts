import { describe, expect, it } from 'vitest';
import { validateAndBuildTemplate } from '../src/services/whatsapp/template-authoring.service.js';

const base = { name: 'order_update', language: 'en_US', category: 'UTILITY', body: 'Hello {{1}}, your order is ready.', sampleValues: ['Alex'] };
describe('WhatsApp template authoring validation', () => {
  it('builds numbered body examples and supported components', () => {
    expect(validateAndBuildTemplate({ ...base, header: { type: 'TEXT', text: 'Order update' }, footer: 'Thank you', buttons: [{ type: 'URL', text: 'Track', url: 'https://example.com/{{1}}', urlExample: 'https://example.com/123' }] }).components).toEqual([
      { type: 'HEADER', format: 'TEXT', text: 'Order update' },
      { type: 'BODY', text: base.body, example: { body_text: [['Alex']] } },
      { type: 'FOOTER', text: 'Thank you' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Track', url: 'https://example.com/{{1}}', example: ['https://example.com/123'] }] },
    ]);
  });
  it.each([
    [{ ...base, body: '{{1}} order is ready.' }, 'beginning'],
    [{ ...base, body: 'Hello {{2}}, order ready.' }, 'sequential'],
    [{ ...base, sampleValues: [] }, 'sample'],
    [{ ...base, header: { type: 'TEXT', text: 'Hello {{1}}' } }, 'Text header'],
    [{ ...base, header: { type: 'IMAGE' } }, 'Meta upload handle'],
    [{ ...base, buttons: [{ type: 'URL', text: 'Track', url: 'https://example.com/{{2}}' }] }, 'Dynamic URLs'],
    [{ ...base, buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '123' }] }, 'international'],
  ])('rejects invalid component payloads', (input, message) => {
    expect(() => validateAndBuildTemplate(input)).toThrow(message);
  });
  it('accepts a media upload handle without exposing credentials', () => {
    expect(validateAndBuildTemplate({ ...base, header: { type: 'IMAGE', mediaHandle: '4::handle' } }).components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::handle'] } });
  });
});
