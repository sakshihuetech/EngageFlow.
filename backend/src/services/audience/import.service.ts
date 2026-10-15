import { Contact } from '../../models/contact.model.js';
import { AppError } from '../../utils/app-error.js';
import { contactCreatePayload } from './audience.service.js';

export function importPayloads(input: unknown) {
  if (!Array.isArray(input) || !input.length || input.length > 100) throw new AppError(400, 'INVALID_IMPORT', 'Provide between 1 and 100 contacts per batch.');
  return input.map((item, index) => {
    try {
      if (!item || typeof item !== 'object' || Array.isArray(item) || 'workspaceId' in item) throw new AppError(400, 'INVALID_IMPORT', 'Contact fields must be a server-scoped object.');
      return { index, payload: contactCreatePayload({ ...item, source: 'CSV_IMPORT', whatsappConsent: { status: 'UNKNOWN' } }) };
    } catch { return { index, error: 'Invalid name, E.164 phone, tags or attributes.' }; }
  });
}

/** Bounded, ordered processing. Duplicate active/deleted contacts are never overwritten by CSV. */
export async function importContacts(workspaceId: string, input: unknown, preview: boolean) {
  const rows = importPayloads(input);
  const seen = new Set<string>();
  let created = 0; let duplicates = 0; let invalid = 0;
  const errors: { row: number; message: string }[] = [];
  for (const row of rows) {
    if (!row.payload) { invalid++; errors.push({ row: row.index + 1, message: row.error! }); continue; }
    const phone = row.payload.phoneE164;
    if (seen.has(phone) || await Contact.exists({ workspaceId, phoneE164: phone })) { duplicates++; continue; }
    seen.add(phone);
    if (!preview) {
      try { await Contact.create({ workspaceId, ...row.payload }); }
      catch (error) {
        if ((error as { code?: number }).code === 11000) { duplicates++; continue; }
        throw error;
      }
    }
    created++;
  }
  return { total: rows.length, valid: created, created: preview ? 0 : created, duplicates, invalid, errors };
}
