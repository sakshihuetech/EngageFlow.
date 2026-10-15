import { open } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import type { Types } from 'mongoose';
import type { Express } from 'express';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';
import { uploadTemplateHeaderMedia } from './meta-graph.service.js';

const rules = {
  IMAGE: { mime: ['image/jpeg', 'image/png'], ext: ['.jpg', '.jpeg', '.png'], max: 5 * 1024 * 1024 },
  VIDEO: { mime: ['video/mp4'], ext: ['.mp4'], max: 16 * 1024 * 1024 },
  DOCUMENT: { mime: ['application/pdf'], ext: ['.pdf'], max: 100 * 1024 * 1024 },
} as const;

export async function uploadWorkspaceTemplateMedia(workspaceId: Types.ObjectId | string, headerType: unknown, file: Express.Multer.File | undefined) {
  const type = typeof headerType === 'string' ? headerType.toUpperCase() : '';
  if (!(type in rules)) throw new AppError(400, 'INVALID_MEDIA_HEADER', 'Media header must be IMAGE, VIDEO, or DOCUMENT.');
  const rule = rules[type as keyof typeof rules];
  if (!file?.path || !file.size) throw new AppError(400, 'MEDIA_FILE_REQUIRED', 'Select a non-empty media file.');
  if (file.size > rule.max) throw new AppError(413, 'MEDIA_TOO_LARGE', 'Media file exceeds the allowed size for this header.');
  if (!(rule.mime as readonly string[]).includes(file.mimetype) || !(rule.ext as readonly string[]).includes(extname(file.originalname).toLowerCase())) throw new AppError(400, 'MEDIA_TYPE_MISMATCH', 'File name and type do not match the selected header.');
  const handle = await open(file.path, 'r');
  let signature: Buffer;
  try { signature = Buffer.alloc(12); await handle.read(signature, 0, 12, 0); } finally { await handle.close(); }
  const jpeg = signature.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const png = signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const valid = type === 'IMAGE' ? file.mimetype === 'image/jpeg' ? jpeg : png : type === 'VIDEO' ? signature.subarray(4, 8).toString('ascii') === 'ftyp' : signature.subarray(0, 5).toString('ascii') === '%PDF-';
  if (!valid) throw new AppError(400, 'MEDIA_SIGNATURE_MISMATCH', 'File content does not match its declared type.');
  const { accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  const mediaHandle = await uploadTemplateHeaderMedia({ accessToken, filePath: file.path, fileName: basename(file.originalname), fileSize: file.size, mimeType: file.mimetype });
  return { headerType: type, handle: mediaHandle, fileName: basename(file.originalname), mimeType: file.mimetype, size: file.size };
}
