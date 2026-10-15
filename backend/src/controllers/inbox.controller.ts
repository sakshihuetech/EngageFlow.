import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { Contact } from '../models/contact.model.js';
import { Conversation } from '../models/conversation.model.js';
import { WhatsAppMessage } from '../models/whatsapp-message.model.js';
import { resolveConnectedWhatsApp } from '../services/whatsapp/connection-context.service.js';
import { isServiceWindowOpen, sendInboxReply } from '../services/whatsapp/inbox.service.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { resolveAccountView } from '../services/whatsapp/account-view.service.js';

function workspaceId(request: Request) { if (!request.workspaceContext) throw new AppError(503, 'WORKSPACE_CONTEXT_UNAVAILABLE', 'Workspace authentication is not configured.'); return request.workspaceContext.workspaceId; }
function objectId(value: unknown, label: string) { if (typeof value !== 'string' || !mongoose.isValidObjectId(value)) throw new AppError(400, 'INVALID_ID', `${label} is invalid.`); return value; }
function asyncController(handler: (request: Request, response: Response) => Promise<void>) { return (request: Request, response: Response, next: NextFunction) => void handler(request, response).catch(next); }
function limit(value: unknown, fallback: number) { return Math.min(Math.max(Number(value) || fallback, 1), 100); }

export function encodeConversationCursor(row: { lastMessageAt: Date; _id: unknown }) { return Buffer.from(JSON.stringify({ at: new Date(row.lastMessageAt).toISOString(), id: String(row._id) })).toString('base64url'); }
export function decodeConversationCursor(value: unknown) {
  try { const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')) as { at?: unknown; id?: unknown }; const at = new Date(String(parsed.at)); return mongoose.isValidObjectId(parsed.id) && !Number.isNaN(at.getTime()) ? { at, id: String(parsed.id) } : null; } catch { return null; }
}
function conversationJson(row: Record<string, unknown> & { _id: unknown }, view?: { wabaId: string; historical: boolean }) {
  const windowOpen = isServiceWindowOpen(row.lastInboundAt as Date | undefined);
  return { id: String(row._id), contactId: row.contactId ? String(row.contactId) : undefined, customerPhone: row.customerPhone, customerName: row.customerName, status: row.status, whatsappAccountId: String(row.whatsappAccountId), phoneNumberId: row.phoneNumberId, ...(view ? { wabaId: view.wabaId, historical: view.historical } : {}), lastInboundAt: row.lastInboundAt, lastMessageAt: row.lastMessageAt, lastMessagePreview: row.lastMessagePreview ?? '', unreadCount: row.unreadCount ?? 0, serviceWindowOpen: windowOpen, serviceWindowExpiresAt: row.lastInboundAt ? new Date(new Date(row.lastInboundAt as Date).getTime() + 24 * 60 * 60 * 1_000) : undefined };
}
function messageJson(row: Record<string, unknown> & { _id: unknown }) {
  return { id: String(row._id), conversationId: String(row.conversationId), direction: row.direction, source: row.sendSource, messageType: row.messageType ?? 'TEXT', text: row.text ?? '', mediaMetadata: row.mediaMetadata, messageId: row.metaMessageId, contextMessageId: row.contextMetaMessageId, status: row.status, timestamp: row.receivedAt ?? row.acceptedAt ?? row.createdAt, acceptedAt: row.acceptedAt, sentAt: row.sentAt, deliveredAt: row.deliveredAt, readAt: row.readAt, failedAt: row.failedAt, ...(['FAILED'].includes(String(row.status)) ? { failureCode: row.failureCode, failureTitle: row.failureTitle, failureMessage: row.failureMessage } : {}) };
}

export const listConversations = asyncController(async (request, response) => {
  const view = await resolveAccountView(workspaceId(request), request.query.view, request.query.accountId);
  const pageLimit = limit(request.query.limit, 30);
  const filter: Record<string, unknown> = { workspaceId: workspaceId(request), whatsappAccountId: view.account._id };
  const status = typeof request.query.status === 'string' ? request.query.status.toUpperCase() : '';
  if (status) { if (!['OPEN', 'CLOSED'].includes(status)) throw new AppError(400, 'INVALID_CONVERSATION_STATUS', 'Invalid conversation status.'); filter.status = status; }
  if (request.query.unread === 'true') filter.unreadCount = { $gt: 0 };
  const search = typeof request.query.search === 'string' ? request.query.search.trim().slice(0, 100) : '';
  if (search) { const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = ['customerName', 'customerPhone'].map((field) => ({ [field]: { $regex: escaped, $options: 'i' } })); }
  if (request.query.cursor) { const cursor = decodeConversationCursor(request.query.cursor); if (!cursor) throw new AppError(400, 'INVALID_CURSOR', 'Invalid conversation cursor.'); filter.$and = [{ $or: [{ lastMessageAt: { $lt: cursor.at } }, { lastMessageAt: cursor.at, _id: { $lt: cursor.id } }] }]; }
  const rows = await Conversation.find(filter).sort({ lastMessageAt: -1, _id: -1 }).limit(pageLimit + 1).lean();
  const items = rows.slice(0, pageLimit);
  response.json(successResponse(request, { items: items.map((row) => conversationJson(row as unknown as Record<string, unknown> & { _id: unknown }, { wabaId: view.account.wabaId, historical: view.historical })), nextCursor: rows.length > pageLimit ? encodeConversationCursor(items.at(-1) as never) : null }));
});

export const listConversationMessages = asyncController(async (request, response) => {
  const workspace = workspaceId(request); const id = objectId(request.params.id, 'Conversation');
  const view = await resolveAccountView(workspace, request.query.view, request.query.accountId);
  const conversation = await Conversation.findOne({ _id: id, workspaceId: workspace, whatsappAccountId: view.account._id }).lean();
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
  const pageLimit = limit(request.query.limit, 50); const filter: Record<string, unknown> = { workspaceId: workspace, whatsappAccountId: view.account._id, phoneNumberId: conversation.phoneNumberId, conversationId: conversation._id };
  if (request.query.cursor) { const cursor = objectId(request.query.cursor, 'Message cursor'); filter._id = { $lt: cursor }; }
  const rows = await WhatsAppMessage.find(filter).sort({ _id: -1 }).limit(pageLimit + 1).lean(); const page = rows.slice(0, pageLimit);
  const contact = conversation.contactId ? await Contact.findOne({ _id: conversation.contactId, workspaceId: workspace }).lean() : null;
  response.json(successResponse(request, { conversation: conversationJson(conversation as unknown as Record<string, unknown> & { _id: unknown }, { wabaId: view.account.wabaId, historical: view.historical }), contact: contact ? { id: String(contact._id), name: contact.name, phoneE164: contact.phoneE164, status: contact.status, tags: contact.tags ?? [], attributes: contact.attributes ?? {}, whatsappConsent: contact.whatsappConsent ?? { status: 'UNKNOWN' } } : null, items: page.reverse().map((row) => messageJson(row as unknown as Record<string, unknown> & { _id: unknown })), nextCursor: rows.length > pageLimit ? String(page.at(-1)?._id) : null }));
});

export function assertInboxLiveSendEnabled() { if (env.CAMPAIGN_LIVE_SEND_ENABLED !== 'true') throw new AppError(503, 'LIVE_SEND_DISABLED', 'Live WhatsApp sending is disabled.'); if (env.CAMPAIGN_TRANSPORT !== 'meta') throw new AppError(503, 'TRANSPORT_NOT_CONFIGURED', 'The live Meta transport is not configured.'); }

export const replyToConversation = asyncController(async (request, response) => {
  assertInboxLiveSendEnabled();
  const workspace = workspaceId(request); const id = objectId(request.params.id, 'Conversation');
  const view = await resolveAccountView(workspace);
  const conversation = await Conversation.findOne({ _id: id, workspaceId: workspace, whatsappAccountId: view.account._id }).lean();
  if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
  if (!isServiceWindowOpen(conversation.lastInboundAt)) throw new AppError(409, 'TEMPLATE_REQUIRED', 'The 24-hour customer-service window is closed. Send an approved template to reopen messaging.');
  if (conversation.contactId) { const contact = await Contact.findOne({ _id: conversation.contactId, workspaceId: workspace }).lean(); if (!contact || contact.status !== 'ACTIVE') throw new AppError(409, 'CONTACT_UNAVAILABLE', 'The conversation contact is blocked, deleted, or unavailable.'); }
  const context = await resolveConnectedWhatsApp(workspace, true);
  if (String(context.account._id) !== String(conversation.whatsappAccountId)) throw new AppError(409, 'ACCOUNT_MISMATCH', 'Conversation account no longer matches the active WhatsApp connection.');
  const result = await sendInboxReply({ workspaceId: workspace, conversation: { _id: conversation._id, phoneNumberId: conversation.phoneNumberId, customerPhone: conversation.customerPhone, ...(conversation.contactId ? { contactId: conversation.contactId } : {}) }, accountId: context.account._id, accessToken: context.accessToken!, text: request.body?.text });
  response.status(201).json(successResponse(request, { message: messageJson(result.message.toObject() as Record<string, unknown> & { _id: unknown }), conversation: conversationJson(result.conversation!.toObject() as Record<string, unknown> & { _id: unknown }) }));
});

export const markConversationRead = asyncController(async (request, response) => {
  const view = await resolveAccountView(workspaceId(request));
  const row = await Conversation.findOneAndUpdate({ _id: objectId(request.params.id, 'Conversation'), workspaceId: workspaceId(request), whatsappAccountId: view.account._id }, { $set: { unreadCount: 0 } }, { new: true });
  if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
  response.json(successResponse(request, conversationJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
});

export const updateConversation = asyncController(async (request, response) => {
  const status = String(request.body?.status ?? '').toUpperCase(); if (!['OPEN', 'CLOSED'].includes(status)) throw new AppError(400, 'INVALID_CONVERSATION_STATUS', 'Status must be OPEN or CLOSED.');
  const view = await resolveAccountView(workspaceId(request));
  const row = await Conversation.findOneAndUpdate({ _id: objectId(request.params.id, 'Conversation'), workspaceId: workspaceId(request), whatsappAccountId: view.account._id }, { $set: { status } }, { new: true });
  if (!row) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation was not found.');
  response.json(successResponse(request, conversationJson(row.toObject() as Record<string, unknown> & { _id: unknown })));
});
