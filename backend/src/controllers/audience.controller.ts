import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { Contact } from '../models/contact.model.js';
import { Segment } from '../models/segment.model.js';
import { cleanTags, createOrRestoreContact, contactUpdatePayload, deleteSegmentSafely, segmentPayload } from '../services/audience/audience.service.js';
import { importContacts } from '../services/audience/import.service.js';
import { parseCursorPagination } from '../services/broadcast/pagination.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { resolveAccountView } from '../services/whatsapp/account-view.service.js';

function workspaceId(request: Request) {
  if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authentication is not configured.');
  return request.workspaceContext.workspaceId;
}
function body(request: Request) { return request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {}; }
async function scopedConsentBody(request: Request) {
  const input = body(request);
  if (!('whatsappConsent' in input)) return input;
  const consent = input.whatsappConsent && typeof input.whatsappConsent === 'object' && !Array.isArray(input.whatsappConsent) ? input.whatsappConsent as Record<string, unknown> : {};
  if (String(consent.status ?? 'UNKNOWN').toUpperCase() !== 'OPTED_IN') return { ...input, whatsappConsent: { ...consent, accountId: undefined } };
  if (input.confirmConsentForActiveAccount !== true || !String(consent.source ?? '').trim() || !String(consent.evidence ?? '').trim()) {
    throw new AppError(400, 'CONSENT_EVIDENCE_REQUIRED', 'Explicit confirmation, source and evidence are required for the current WhatsApp sender.');
  }
  const view = await resolveAccountView(workspaceId(request));
  return { ...input, whatsappConsent: { ...consent, accountId: view.account._id } };
}
function id(value: unknown, label: string) { if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new AppError(400, 'INVALID_ID', `${label} is invalid.`); return value; }
function asyncController(handler: (request: Request, response: Response) => Promise<void>) { return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next); }
function duplicate(error: unknown): never { if ((error as { code?: number }).code === 11000) throw new AppError(409, 'DUPLICATE_RECORD', 'A record with the same unique value already exists in this workspace.'); throw error; }

function contactJson(row: Record<string, unknown> & { _id: unknown }) {
  return { id: String(row._id), name: row.name, phoneE164: row.phoneE164, email: row.email, tags: row.tags ?? [], attributes: row.attributes ?? {}, status: row.status, source: row.source, whatsappConsent: row.whatsappConsent ?? { status: 'UNKNOWN' }, optedOutAt: row.optedOutAt, createdAt: row.createdAt, updatedAt: row.updatedAt };
}
function segmentJson(row: Record<string, unknown> & { _id: unknown }) {
  return { id: String(row._id), name: row.name, type: row.type, definition: row.definition, status: row.status, estimatedCount: row.estimatedCount ?? 0, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export const listContacts = asyncController(async (request, response) => {
  const { limit, cursor } = parseCursorPagination(request.query);
  const filter: Record<string, unknown> = { workspaceId: workspaceId(request) };
  const status = typeof request.query.status === 'string' ? request.query.status.toUpperCase() : '';
  if (status) {
    if (!['ACTIVE', 'BLOCKED', 'DELETED'].includes(status)) throw new AppError(400, 'INVALID_CONTACT_STATUS', 'Invalid contact status filter.');
    filter.status = status;
  } else filter.status = { $ne: 'DELETED' };
  if (cursor) filter._id = { $lt: cursor };
  const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : '';
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = ['name', 'email', 'phoneE164'].map((field) => ({ [field]: { $regex: escaped, $options: 'i' } }));
  }
  const rows = await Contact.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const items = rows.slice(0, limit);
  response.json(successResponse(request, { items: items.map((row) => contactJson(row as unknown as Record<string, unknown> & { _id: unknown })), nextCursor: rows.length > limit ? String(items.at(-1)?._id) : null }));
});

export const getContact = asyncController(async (request, response) => {
  const row = await Contact.findOne({ _id: id(request.params.id, 'Contact'), workspaceId: workspaceId(request) }).lean();
  if (!row) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact was not found.');
  const json = contactJson(row as unknown as Record<string, unknown> & { _id: unknown });
  response.json(successResponse(request, { ...json, attributes: safeContactAttributes(json.attributes) }));
});

export function safeContactAttributes(value: unknown, depth = 0): unknown {
  if (depth > 6) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map(item => safeContactAttributes(item, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|credential|password|authorization|api.?key|__proto__|constructor|prototype/i.test(key)).slice(0, 100).map(([key, item]) => [key, safeContactAttributes(item, depth + 1)]));
  return value;
}

export const importContactBatch = asyncController(async (request, response) => {
  const input = body(request);
  if ('workspaceId' in input) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'workspaceId is server-controlled.');
  response.json(successResponse(request, await importContacts(String(workspaceId(request)), input.items, input.preview === true)));
});

export const bulkContacts = asyncController(async (request, response) => {
  const input = body(request);
  if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 100) throw new AppError(400, 'INVALID_SELECTION', 'Select between 1 and 100 contacts.');
  if ('workspaceId' in input) throw new AppError(400, 'SERVER_CONTROLLED_FIELD', 'workspaceId is server-controlled.');
  const ids = [...new Set(input.ids.map(value => id(value, 'Contact')))];
  const filter = { workspaceId: workspaceId(request), _id: { $in: ids }, status: input.action === 'RESTORE' ? 'DELETED' as const : { $ne: 'DELETED' as const } };
  let update: Record<string, unknown>;
  if (input.action === 'ADD_TAG' || input.action === 'REMOVE_TAG') {
    const tags = cleanTags(input.tags);
    if (!tags.length) throw new AppError(400, 'INVALID_TAGS', 'Provide a tag.');
    update = input.action === 'ADD_TAG' ? { $addToSet: { tags: { $each: tags } } } : { $pull: { tags: { $in: tags } } };
  } else if (input.action === 'STATUS' && ['ACTIVE', 'BLOCKED'].includes(String(input.status))) update = { $set: { status: input.status } };
  else if (input.action === 'DELETE') update = { $set: { status: 'DELETED' } };
  else if (input.action === 'RESTORE') update = { $set: { status: 'ACTIVE' } };
  else throw new AppError(400, 'INVALID_BULK_ACTION', 'Unsupported bulk action.');
  const result = await Contact.updateMany(filter, update, { runValidators: true });
  response.json(successResponse(request, { matched: result.matchedCount, modified: result.modifiedCount }));
});

export const createContact = asyncController(async (request, response) => {
  const result = await createOrRestoreContact(workspaceId(request), await scopedConsentBody(request));
  response.status(201).json(successResponse(request, { ...contactJson(result.contact.toObject() as Record<string, unknown> & { _id: unknown }), restored: result.restored }));
});

export const updateContact = asyncController(async (request, response) => {
  const update = contactUpdatePayload(await scopedConsentBody(request));
  const mutation: Record<string, unknown> = { $set: update };
  const consent = update.whatsappConsent as { status?: string; timestamp?: Date } | undefined;
  if (consent?.status === 'OPTED_OUT') (mutation.$set as Record<string, unknown>).optedOutAt = consent.timestamp ?? new Date();
  if (consent?.status === 'OPTED_IN') mutation.$unset = { optedOutAt: 1 };
  try {
    const row = await Contact.findOneAndUpdate({ _id: id(request.params.id, 'Contact'), workspaceId: workspaceId(request), status: { $ne: 'DELETED' } }, mutation, { new: true, runValidators: true });
    if (!row) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact was not found.');
    response.json(successResponse(request, contactJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
  } catch (error) { duplicate(error); }
});

export const deleteContact = asyncController(async (request, response) => {
  const row = await Contact.findOneAndUpdate({ _id: id(request.params.id, 'Contact'), workspaceId: workspaceId(request), status: { $ne: 'DELETED' } }, { $set: { status: 'DELETED' } }, { new: true });
  if (!row) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Contact was not found.');
  response.json(successResponse(request, { id: String(row._id), status: 'DELETED' }));
});

export const restoreContact = asyncController(async (request, response) => {
  const row = await Contact.findOneAndUpdate({ _id: id(request.params.id, 'Contact'), workspaceId: workspaceId(request), status: 'DELETED' }, { $set: { status: 'ACTIVE' } }, { new: true, runValidators: true });
  if (!row) throw new AppError(404, 'CONTACT_NOT_FOUND', 'Deleted contact was not found.');
  response.json(successResponse(request, contactJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
});

export const listSegments = asyncController(async (request, response) => {
  const { limit, cursor } = parseCursorPagination(request.query);
  const filter: Record<string, unknown> = { workspaceId: workspaceId(request), status: 'ACTIVE' };
  if (cursor) filter._id = { $lt: cursor };
  const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : '';
  if (search) filter.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const rows = await Segment.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const items = rows.slice(0, limit);
  response.json(successResponse(request, { items: items.map((row) => segmentJson(row as unknown as Record<string, unknown> & { _id: unknown })), nextCursor: rows.length > limit ? String(items.at(-1)?._id) : null }));
});

export const createSegment = asyncController(async (request, response) => {
  try {
    const row = await Segment.create({ workspaceId: workspaceId(request), ...(await segmentPayload(workspaceId(request), body(request))) });
    response.status(201).json(successResponse(request, segmentJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
  } catch (error) { duplicate(error); }
});

export const updateSegment = asyncController(async (request, response) => {
  try {
    const workspace = workspaceId(request);
    const row = await Segment.findOneAndUpdate({ _id: id(request.params.id, 'Segment'), workspaceId: workspace, status: 'ACTIVE' }, { $set: await segmentPayload(workspace, body(request)) }, { new: true, runValidators: true });
    if (!row) throw new AppError(404, 'SEGMENT_NOT_FOUND', 'Segment was not found.');
    response.json(successResponse(request, segmentJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
  } catch (error) { duplicate(error); }
});

export const deleteSegment = asyncController(async (request, response) => {
  const row = await deleteSegmentSafely(workspaceId(request), id(request.params.id, 'Segment'));
  response.json(successResponse(request, { id: String(row._id), deleted: true }));
});
