import { describe, expect, it } from 'vitest';
import { csvBatches, mapCsv, parseCsv, uniqueCsvContacts } from './csv';
describe('CSV contact mapping', () => {
  it('deduplicates phones across batch boundaries and respects request limits', () => {
    const item = { name: 'Ada', phoneE164: '+123456789', tags: [], attributes: {}, whatsappConsent: { status: 'UNKNOWN' as const } };
    expect(uniqueCsvContacts([item, { ...item, phoneE164: '001 234 56789' }]).duplicates).toBe(1);
    expect(uniqueCsvContacts([item, { ...item, phoneE164: '1 234 56789' }]).duplicates).toBe(1);
    expect(csvBatches(Array(205).fill(item)).map(batch => batch.length)).toEqual([100,100,5]);
    expect(csvBatches(Array(20).fill({ ...item, attributes: { long: 'x'.repeat(20000) } })).every(batch => JSON.stringify({ items: batch }).length < 256 * 1024)).toBe(true);
  });
  it('supports quoted commas, newlines, escaped quotes and CRLF', () => {
    expect(parseCsv('name,phone\r\n"Ada, A",+123456789\r\n"Line\nTwo",+234567890')).toEqual({ headers: ['name','phone'], rows: [['Ada, A','+123456789'], ['Line\nTwo','+234567890']] });
    expect(parseCsv('name\n"Ada ""A"""').rows).toEqual([['Ada "A"']]);
  });
  it('maps all supported fields and never invents consent', () => {
    expect(mapCsv([['Ada','+123456789','a@b.test','VIP;Lead','CUSTOMER','{"tier":"pro"}']], { name: '0', phone: '1', email: '2', tags: '3', lifecycleStage: '4', attributes: '5' })[0]).toMatchObject({ name: 'Ada', tags: ['VIP','Lead'], attributes: { tier: 'pro', lifecycleStage: 'CUSTOMER' }, whatsappConsent: { status: 'UNKNOWN' } });
  });
  it('rejects malformed and unbounded CSV', () => {
    expect(() => parseCsv('a,b\n1')).toThrow();
    expect(() => parseCsv('a\n"unfinished')).toThrow();
    expect(() => parseCsv('a\n' + 'x\n'.repeat(5001))).toThrow();
  });
});
