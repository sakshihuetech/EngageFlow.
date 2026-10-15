import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';
import { graphRequest, uploadTemplateHeaderMedia } from './meta-graph.service.js';

export const PROFILE_VERTICALS = ['', 'UNDEFINED', 'OTHER', 'AUTO', 'BEAUTY', 'APPAREL', 'EDU', 'ENTERTAIN', 'EVENT_PLAN', 'FINANCE', 'GROCERY', 'GOVT', 'HOTEL', 'HEALTH', 'NONPROFIT', 'PROF_SERVICES', 'RETAIL', 'TRAVEL', 'RESTAURANT', 'NOT_A_BIZ'];
const limits: Record<string, number> = { about: 139, address: 256, description: 256, email: 128, vertical: 64 };
export function validateBusinessProfile(input: Record<string, unknown>) {
  if (!Object.keys(input).length || Object.keys(input).some(key => !Object.hasOwn(limits, key) && key !== 'websites')) throw new AppError(400, 'READ_ONLY_FIELD', 'Provide only editable business profile fields. Display name is read-only.');
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'websites') {
      if (!Array.isArray(value) || value.length > 2) throw new AppError(400, 'INVALID_PROFILE', 'Meta supports up to two websites.');
      payload.websites = value.map(url => {
        if (typeof url !== 'string' || url.length > 256) throw new AppError(400, 'INVALID_PROFILE', 'Invalid website.');
        try { const parsed = new URL(url.trim()); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(); }
        catch { throw new AppError(400, 'INVALID_PROFILE', 'Websites must use HTTP or HTTPS.'); }
        return url.trim();
      });
    } else {
      if (typeof value !== 'string' || value.trim().length > limits[key]!) throw new AppError(400, 'INVALID_PROFILE', `${key} exceeds Meta limits.`);
      payload[key] = value.trim();
    }
  }
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(payload.email))) throw new AppError(400, 'INVALID_PROFILE', 'Invalid business email.');
  if ('vertical' in payload && !PROFILE_VERTICALS.includes(String(payload.vertical))) throw new AppError(400, 'INVALID_PROFILE', 'Unsupported business vertical.');
  return payload;
}
async function profileContext(workspaceId: string) {
  const context = await resolveConnectedWhatsApp(workspaceId, true);
  if (context.phones.length !== 1) throw new AppError(409, 'PHONE_SELECTION_REQUIRED', 'Business profile requires exactly one connected phone.');
  return { phone: context.phones[0]!, accessToken: context.accessToken! };
}
async function readProfile(phoneId: string, accessToken: string) {
  const result = await graphRequest<{ data?: Record<string, unknown>[] }>(`${phoneId}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical`, { accessToken });
  const entry = result.data?.[0] ?? {};
  const raw = entry.business_profile && typeof entry.business_profile === 'object' && !Array.isArray(entry.business_profile) ? entry.business_profile as Record<string, unknown> : entry;
  return Object.fromEntries(Object.entries(raw).filter(([key, value]) => [...Object.keys(limits), 'websites', 'profile_picture_url'].includes(key) && (typeof value === 'string' || (key === 'websites' && Array.isArray(value) && value.every(item => typeof item === 'string')))));
}
export async function getBusinessProfile(workspaceId: string) {
  const context = await profileContext(workspaceId);
  return { displayName: context.phone.verifiedName, profile: await readProfile(context.phone.phoneNumberId, context.accessToken) };
}
export async function updateBusinessProfile(workspaceId: string, input: Record<string, unknown>) {
  const values = validateBusinessProfile(input);
  const context = await profileContext(workspaceId);
  const result = await graphRequest<{ success?: boolean }>(`${context.phone.phoneNumberId}/whatsapp_business_profile`, { method: 'POST', accessToken: context.accessToken, body: { messaging_product: 'whatsapp', ...values } });
  if (result.success !== true) throw new AppError(502, 'PROFILE_UPDATE_UNCONFIRMED', 'Meta did not confirm the profile update.');
  return { displayName: context.phone.verifiedName, profile: await readProfile(context.phone.phoneNumberId, context.accessToken) };
}
export function validPictureSignature(buffer: Buffer, mime: string) {
  return mime === 'image/png' ? buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : mime === 'image/jpeg' && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
}
export async function updateBusinessPicture(workspaceId: string, file: Express.Multer.File) {
  if (!file.size || file.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(file.mimetype) || !['.jpg','.jpeg','.png'].includes(extname(file.originalname).toLowerCase()) || !validPictureSignature(await readFile(file.path), file.mimetype)) throw new AppError(400, 'INVALID_PROFILE_PICTURE', 'Select a JPEG or PNG picture up to 5 MB with matching file content.');
  const context = await profileContext(workspaceId);
  const handle = await uploadTemplateHeaderMedia({ accessToken: context.accessToken, filePath: file.path, fileName: 'business-profile' + extname(file.originalname).toLowerCase(), fileSize: file.size, mimeType: file.mimetype });
  const result = await graphRequest<{ success?: boolean }>(`${context.phone.phoneNumberId}/whatsapp_business_profile`, { method: 'POST', accessToken: context.accessToken, body: { messaging_product: 'whatsapp', profile_picture_handle: handle } });
  if (result.success !== true) throw new AppError(502, 'PROFILE_UPDATE_UNCONFIRMED', 'Meta did not confirm the profile picture update.');
  return { displayName: context.phone.verifiedName, profile: await readProfile(context.phone.phoneNumberId, context.accessToken) };
}
