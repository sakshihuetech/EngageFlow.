import type { ContactInput } from './types';

export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 5000;
export function parseCsv(text: string) {
  if (new TextEncoder().encode(text).length > CSV_MAX_BYTES) throw new Error('CSV files must be at most 2 MB.');
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') { if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted; }
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if (char === '\n' && !quoted) { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else if (char !== '\r' || quoted) cell += char;
    if (rows.length > CSV_MAX_ROWS + 1) throw new Error('Split CSV files into at most 5,000 contact rows.');
  }
  if (quoted) throw new Error('CSV contains an unclosed quoted field.');
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  const headers = rows.shift()?.map(value => value.replace(/^\uFEFF/, '')) ?? [];
  if (!headers.length || headers.length > 50 || rows.length > CSV_MAX_ROWS) throw new Error('CSV must contain up to 50 columns and 5,000 contact rows.');
  if (rows.some(value => value.length !== headers.length)) throw new Error('CSV rows must have the same number of columns as the header.');
  return { headers, rows };
}

export function uniqueCsvContacts(items: ContactInput[]) {
  const seen = new Set<string>(); let duplicates = 0;
  const unique = items.filter(item => {
    const raw = item.phoneE164.trim();
    const digits = (raw.startsWith('00') ? raw.slice(2) : raw).replace(/\D/g, '');
    if (!/^\d{8,15}$/.test(digits)) return true; // Invalid phones are reported by the backend.
    if (seen.has(digits)) { duplicates++; return false; }
    seen.add(digits); return true;
  });
  return { items: unique, duplicates };
}

export function csvBatches(items: ContactInput[]) {
  const batches: ContactInput[][] = []; let batch: ContactInput[] = []; let bytes = 100;
  for (const item of items) {
    const size = new TextEncoder().encode(JSON.stringify(item)).length + 1;
    if (size > 220000) throw new Error('A contact row is too large.');
    if (batch.length && (batch.length >= 100 || bytes + size > 220000)) { batches.push(batch); batch = []; bytes = 100; }
    batch.push(item); bytes += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export type CsvMapping = Record<'name' | 'phone' | 'email' | 'tags' | 'lifecycleStage' | 'attributes', string>;
export function mapCsv(rows: string[][], mapping: CsvMapping): ContactInput[] {
  if (mapping.name === '' || mapping.phone === '') throw new Error('Map Name and Phone before validation.');
  return rows.map(row => {
    const value = (key: keyof CsvMapping) => mapping[key] === '' ? '' : row[Number(mapping[key])] ?? '';
    let attributes: Record<string, unknown> = {};
    if (value('attributes')) {
      attributes = JSON.parse(value('attributes')) as Record<string, unknown>;
      if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) throw new Error('Custom attributes must be a JSON object.');
    }
    if (value('lifecycleStage')) attributes.lifecycleStage = value('lifecycleStage');
    return { name: value('name'), phoneE164: value('phone'), email: value('email'), tags: value('tags').split(';').map(tag => tag.trim()).filter(Boolean), attributes, whatsappConsent: { status: 'UNKNOWN' } };
  });
}
