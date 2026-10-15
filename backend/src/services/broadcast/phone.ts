import { AppError } from '../../utils/app-error.js';

export function normalizeWhatsAppPhone(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AppError(400, 'INVALID_PHONE', 'A WhatsApp phone number is required.');
  }
  let raw = String(value).trim();
  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  const digits = raw.replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) {
    throw new AppError(400, 'INVALID_PHONE', 'Phone number must include a valid country code and 8-15 digits.');
  }
  return `+${digits}`;
}
