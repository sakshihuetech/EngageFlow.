import { createHmac, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { env } from '../config/env.js';
import { WhatsAppAccount } from '../models/whatsapp-account.model.js';
import { WhatsAppMessage } from '../models/whatsapp-message.model.js';
import { WhatsAppPhoneNumber } from '../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../models/whatsapp-template.model.js';
import { propagateMessageStatus, type DeliveryStatus } from '../services/broadcast/tracking.service.js';
import { trackApiCampaignMessage } from '../services/api-campaign/tracking.service.js';
import { safeFailureText } from '../services/broadcast/safety.js';
import { successResponse } from '../utils/api-response.js';
import { AppError } from '../utils/app-error.js';
import { logger } from '../utils/logger.js';
import { persistInboundMessage } from '../services/whatsapp/inbox.service.js';

const messageRanks: Record<string, number> = { ACCEPTED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
const messageStatuses = new Set<DeliveryStatus>(['SENT', 'DELIVERED', 'READ', 'FAILED']);

export function isValidWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string) {
  const match = signatureHeader?.match(/^sha256=([a-f\d]{64})$/i);
  if (!secret || !match) return false;
  const supplied = Buffer.from(match[1]!, 'hex');
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function safeIdentifier(value: unknown) {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
  return /^\d{1,64}$/.test(text) ? text : '';
}

function safeMessageId(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^wamid\.[A-Za-z0-9+/_=-]{1,512}$/.test(text) ? text : '';
}

function canAdvanceMessage(current: string, incoming: DeliveryStatus) {
  if (current === 'READ') return false;
  if (current === 'FAILED') return ['SENT', 'DELIVERED', 'READ'].includes(incoming);
  if (incoming === 'FAILED') return ['ACCEPTED', 'SENT'].includes(current);
  return current in messageRanks && incoming in messageRanks && messageRanks[incoming]! > messageRanks[current]!;
}

function eventTime(value: unknown) {
  const seconds = Number(value);
  const timestamp = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1_000) : new Date();
  return Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
}

function failureFrom(status: Record<string, unknown>) {
  const errors = Array.isArray(status.errors) ? status.errors : [];
  const error = errors[0] && typeof errors[0] === 'object' ? errors[0] as Record<string, unknown> : {};
  const errorData = error.error_data && typeof error.error_data === 'object' ? error.error_data as Record<string, unknown> : {};
  return {
    failureCode: safeFailureText(error.code === undefined ? '' : String(error.code), 64),
    failureSubcode: typeof error.error_subcode === 'number' ? error.error_subcode : undefined,
    failureTitle: safeFailureText(error.title, 300),
    failureMessage: safeFailureText(error.message ?? errorData.details, 1_000),
  };
}

async function updateStatus(wabaId: string, value: Record<string, unknown>, status: Record<string, unknown>) {
  const metadata = value.metadata && typeof value.metadata === 'object' ? value.metadata as Record<string, unknown> : {};
  const phoneNumberId = safeIdentifier(metadata.phone_number_id);
  const messageId = safeMessageId(status.id);
  const incomingValue = typeof status.status === 'string' ? status.status.toUpperCase() : '';
  if (!phoneNumberId || !messageId || !messageStatuses.has(incomingValue as DeliveryStatus)) return 'ignored';
  const incoming = incomingValue as DeliveryStatus;
  const phones = await WhatsAppPhoneNumber.find({ phoneNumberId }).limit(2).lean();
  if (phones.length !== 1) return 'unmatched';
  const phone = phones[0]!;
  const account = await WhatsAppAccount.findOne({ _id: phone.whatsappAccountId, workspaceId: phone.workspaceId, wabaId }).lean();
  if (!account) return 'unmatched';
  const strictFilter = { workspaceId: phone.workspaceId, whatsappAccountId: account._id, phoneNumberId, metaMessageId: messageId };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const message = await WhatsAppMessage.findOne(strictFilter).lean();
    if (!message) return 'unmatched';
    if (!canAdvanceMessage(message.status, incoming)) return message.status === incoming ? 'duplicate' : 'outOfOrder';
    const timestamp = eventTime(status.timestamp);
    const timestampField = ({ ACCEPTED: 'acceptedAt', SENT: 'sentAt', DELIVERED: 'deliveredAt', READ: 'readAt', FAILED: 'failedAt' } as const)[incoming];
    const failure = incoming === 'FAILED' ? failureFrom(status) : {};
    const update = { status: incoming, [timestampField]: timestamp, ...failure };
    const outcome = await WhatsAppMessage.updateOne({ ...strictFilter, status: message.status }, { $set: update, ...(message.status === 'FAILED' && incoming !== 'FAILED' ? { $unset: { failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '' } } : {}) });
    if (outcome.modifiedCount === 1) {
      await propagateMessageStatus({ message, incomingStatus: incoming, timestamp, failure });
      await trackApiCampaignMessage(message, incoming, timestamp, failure);
      return 'updated';
    }
  }
  return 'duplicate';
}

async function updateTemplateStatus(wabaId: string, value: Record<string, unknown>) {
  const templateId = safeIdentifier(value.message_template_id);
  const status = typeof value.event === 'string' ? value.event.toUpperCase() : '';
  if (!templateId || !new Set(['PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED', 'FLAGGED', 'IN_APPEAL', 'PENDING_DELETION']).has(status)) return 'ignored';
  const accounts = await WhatsAppAccount.find({ wabaId }).limit(2).lean();
  if (accounts.length !== 1) return 'unmatched';
  const account = accounts[0]!;
  const filter = { workspaceId: account.workspaceId, whatsappAccountId: account._id, metaTemplateId: templateId, isActive: true };
  const rawReason = safeFailureText(value.reason, 1_000);
  const reason = rawReason.toUpperCase() === 'NONE' ? '' : rawReason;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const current = await WhatsAppTemplate.findOne(filter).lean();
    if (!current) return 'unmatched';
    const timestamp = value.timestamp === undefined ? new Date() : eventTime(value.timestamp);
    if (value.timestamp !== undefined && current.lastSyncedAt && timestamp < current.lastSyncedAt) return 'outOfOrder';
    if (current.status === status && (current.rejectionReason ?? '') === (status === 'REJECTED' ? reason : '')) return 'duplicate';
    const outcome = await WhatsAppTemplate.updateOne({ ...filter, status: current.status, lastSyncedAt: current.lastSyncedAt }, { $set: { status, lastSyncedAt: timestamp, ...(status === 'REJECTED' && reason ? { rejectionReason: reason } : {}) }, ...(status !== 'REJECTED' || !reason ? { $unset: { rejectionReason: '' } } : {}) });
    if (outcome.modifiedCount === 1) return 'updated';
  }
  return 'duplicate';
}

export function verifyWhatsAppWebhook(request: Request, response: Response, next: NextFunction) {
  try {
    if (!env.WEBHOOK_VERIFY_TOKEN) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook verification is not configured.');
    if (request.query['hub.mode'] === 'subscribe' && request.query['hub.verify_token'] === env.WEBHOOK_VERIFY_TOKEN && typeof request.query['hub.challenge'] === 'string') {
      response.status(200).send(request.query['hub.challenge']);
      return;
    }
    throw new AppError(403, 'WEBHOOK_VERIFICATION_FAILED', 'Webhook verification failed.');
  } catch (error) {
    next(error);
  }
}

export async function receiveWhatsAppWebhook(request: Request, response: Response, next: NextFunction) {
  try {
    if (!env.META_APP_SECRET) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Webhook signature verification is not configured.');
    if (!Buffer.isBuffer(request.body) || !isValidWebhookSignature(request.body, request.header('x-hub-signature-256'), env.META_APP_SECRET)) {
      throw new AppError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(request.body.toString('utf8')) as unknown;
    } catch {
      throw new AppError(400, 'INVALID_WEBHOOK_PAYLOAD', 'Invalid webhook payload.');
    }
    const result = { updated: 0, duplicate: 0, outOfOrder: 0, unmatched: 0, ignored: 0, inboundCreated: 0, inboundDuplicate: 0 };
    const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    if (root.object === 'whatsapp_business_account' && Array.isArray(root.entry)) {
      for (const rawEntry of root.entry) {
        const entry = rawEntry && typeof rawEntry === 'object' ? rawEntry as Record<string, unknown> : {};
        const wabaId = safeIdentifier(entry.id);
        if (!wabaId || !Array.isArray(entry.changes)) continue;
        for (const rawChange of entry.changes) {
          const change = rawChange && typeof rawChange === 'object' ? rawChange as Record<string, unknown> : {};
          const value = change.value && typeof change.value === 'object' ? change.value as Record<string, unknown> : {};
          if (change.field === 'message_template_status_update') {
            const outcome = await updateTemplateStatus(wabaId, value);
            result[outcome] += 1;
            continue;
          }
          if (change.field !== 'messages') { result.ignored += 1; continue; }
          if (Array.isArray(value.statuses)) {
            for (const rawStatus of value.statuses) {
              const status = rawStatus && typeof rawStatus === 'object' ? rawStatus as Record<string, unknown> : {};
              const outcome = await updateStatus(wabaId, value, status) as 'updated' | 'duplicate' | 'outOfOrder' | 'unmatched' | 'ignored';
              result[outcome] += 1;
            }
          }
          if (Array.isArray(value.messages)) {
            for (const rawMessage of value.messages) {
              const message = rawMessage && typeof rawMessage === 'object' ? rawMessage as Record<string, unknown> : {};
              const outcome = await persistInboundMessage({ wabaId, value, message });
              if (outcome.outcome === 'created') result.inboundCreated += 1;
              else if (outcome.outcome === 'duplicate') result.inboundDuplicate += 1;
              else result[outcome.outcome] += 1;
            }
          }
        }
      }
    }
    response.json(successResponse(request, { received: true, ...result }));
  } catch (error) {
    logger.warn('WhatsApp webhook rejected', { requestId: request.requestId, errorName: error instanceof Error ? error.name : 'UnknownError' });
    next(error);
  }
}

export const webhookTestables = { canAdvanceMessage, failureFrom, updateStatus, updateTemplateStatus };
