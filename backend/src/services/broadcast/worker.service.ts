import type { Job } from 'bullmq';
import { Types } from 'mongoose';
import { enqueueCampaign, type CampaignJobData } from '../../config/campaign-queue.js';
import { env } from '../../config/env.js';
import { Campaign } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { Contact } from '../../models/contact.model.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { buildTemplatePayload, sendApprovedTemplateMessage } from '../whatsapp/send-approved-template.service.js';
import { canBypassCampaignConsent, logConsentBypass } from './consent.service.js';
import { liveSendEnabled, transportConfigured } from './execution.service.js';
import { safeFailureText } from './safety.js';
import { classifyBroadcastError, MAX_BROADCAST_ATTEMPTS } from './retry-classification.service.js';
import { activateFailedRetryBatch } from './retry.service.js';
import { recheckRetargetSource, retargetSenderStillBound } from './retargeting.service.js';

interface SendErrorShape {
  status?: number;
  statusCode?: number;
  code?: string | number;
  safeToRetry?: boolean;
  message?: string;
  userTitle?: string;
  userMessage?: string;
}

export function failureDetails(error: unknown) {
  const shaped = error as SendErrorShape;
  return {
    failureCode: String(shaped.code ?? shaped.status ?? shaped.statusCode ?? 'SEND_FAILED').slice(0, 64),
    failureTitle: safeFailureText(shaped.userTitle, 300),
    failureMessage: safeFailureText(shaped.userMessage ?? shaped.message ?? 'Campaign message failed.', 1_000),
  };
}

export function isTransientFailure(error: unknown) {
  const shaped = error as SendErrorShape;
  if (shaped.message?.toLowerCase().includes('timed out')) return false;
  return shaped.safeToRetry === true;
}

export function retryDelay(attempt: number, jitter = Math.floor(Math.random() * 1_000)) {
  return Math.min(15 * 60_000, (2 ** Math.max(0, attempt - 1)) * 5_000 + jitter);
}

export function validateRecipientSendPayload(input: {
  templateSnapshot?: { name?: string; language?: string; components?: unknown[] };
  recipientPhone: string;
  parameters?: { bodyVariables?: string[]; headerVariables?: string[]; buttonVariables?: Record<string, string> };
  media?: { type?: unknown; source?: unknown; value?: unknown; fileName?: unknown };
}) {
  const snapshot = input.templateSnapshot;
  if (!snapshot?.name || !snapshot.language) throw new Error('Campaign template snapshot is unavailable.');
  return buildTemplatePayload({
    template: { name: snapshot.name, language: snapshot.language, ...(snapshot.components ? { components: snapshot.components } : {}) },
    recipient: input.recipientPhone,
    ...(input.parameters?.bodyVariables ? { bodyVariables: input.parameters.bodyVariables } : {}),
    ...(input.parameters?.headerVariables ? { headerVariables: input.parameters.headerVariables } : {}),
    ...(input.parameters?.buttonVariables ? { buttonVariables: input.parameters.buttonVariables } : {}),
    ...(input.media ? { media: input.media } : {}),
  });
}

export async function claimRecipient(campaignId: string, workspaceId: string, workerId: string) {
  const now = new Date();
  return CampaignRecipient.findOneAndUpdate({
    workspaceId,
    campaignId,
    status: { $in: ['PENDING', 'RETRY_WAIT'] },
    attemptCount: { $lt: MAX_BROADCAST_ATTEMPTS },
    $or: [{ nextAttemptAt: { $exists: false } }, { nextAttemptAt: null }, { nextAttemptAt: { $lte: now } }],
    submissionState: 'NOT_SUBMITTED',
  }, {
    $set: { status: 'QUEUED', claimedAt: now, leaseUntil: new Date(now.getTime() + 120_000), workerId },
    $inc: { attemptCount: 1 },
  }, { new: true, sort: { _id: 1 } });
}

export async function recheckConsent(input: {
  workspaceId: string;
  campaignId: string;
  whatsappAccountId?: unknown;
  contactId?: unknown;
  recipientPhone: string;
  strictConsent?: boolean;
}) {
  if (!input.contactId) {
    if (input.strictConsent || !canBypassCampaignConsent()) return { eligible: false, code: 'CONSENT_UNKNOWN', message: 'Recipient has no persisted opt-in contact.' };
    logConsentBypass(input.campaignId, input.recipientPhone, 'worker-recheck');
    return { eligible: true, consentBypassed: true };
  }
  const contact = await Contact.findOne({ _id: input.contactId, workspaceId: input.workspaceId }).lean();
  if (!contact || contact.status !== 'ACTIVE') return { eligible: false, code: 'CONTACT_INACTIVE', message: 'Contact is blocked, deleted, or unavailable.' };
  if (contact.phoneE164 !== input.recipientPhone) return { eligible: false, code: 'CONTACT_PHONE_CHANGED', message: 'Contact phone changed after audience snapshot.' };
  if (input.strictConsent && contact.optedOutAt) return { eligible: false, code: 'CONSENT_OPTED_OUT', message: 'Contact opted out after the retargeting snapshot.' };
  if (!hasSenderConsent(contact.whatsappConsent, input.whatsappAccountId)) {
    if (input.strictConsent || !canBypassCampaignConsent()) return { eligible: false, code: 'CONSENT_NOT_OPTED_IN', message: 'WhatsApp consent is no longer opted in.' };
    logConsentBypass(input.campaignId, input.recipientPhone, 'worker-recheck');
    return { eligible: true, consentBypassed: true };
  }
  return { eligible: true };
}

async function refreshCounters(campaignId: string, workspaceId: string, hasUnevaluatedRetry = false) {
  const rows = await CampaignRecipient.aggregate<{ _id: string; count: number }>([
    { $match: { workspaceId: new Types.ObjectId(workspaceId), campaignId: new Types.ObjectId(campaignId) } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const remaining = (counts.PENDING ?? 0) + (counts.QUEUED ?? 0) + (counts.SENDING ?? 0) + (counts.RETRY_WAIT ?? 0);
  const failures = (counts.FAILED ?? 0) + (counts.SKIPPED ?? 0);
  const update: Record<string, unknown> = {
    'counters.pending': (counts.PENDING ?? 0) + (counts.SENDING ?? 0) + (counts.RETRY_WAIT ?? 0),
    'counters.queued': counts.QUEUED ?? 0,
    'counters.accepted': counts.ACCEPTED ?? 0,
    'counters.sent': counts.SENT ?? 0,
    'counters.delivered': counts.DELIVERED ?? 0,
    'counters.read': counts.READ ?? 0,
    'counters.failed': counts.FAILED ?? 0,
    'counters.skipped': counts.SKIPPED ?? 0,
    'counters.cancelled': counts.CANCELLED ?? 0,
  };
  if (!remaining && !hasUnevaluatedRetry) update.status = failures ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  await Campaign.updateOne({ _id: campaignId, workspaceId, status: { $nin: ['PAUSED', 'CANCELLED'] } }, { $set: update });
  return remaining;
}

export async function processCampaignJob(job: Job<CampaignJobData>) {
  if (!liveSendEnabled() || !transportConfigured()) return { disabled: true, reason: 'CAMPAIGN_SENDING_DISABLED' };
  const { campaignId, workspaceId, sequence = 0 } = job.data;
  const campaign = await Campaign.findOne({ _id: campaignId, workspaceId });
  if (!campaign || !['QUEUED', 'PROCESSING', 'SCHEDULED'].includes(campaign.status)) return { ignored: true };
  if (campaign.status === 'SCHEDULED' && campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now()) return { ignored: true, reason: 'NOT_DUE' };
  const processing = await Campaign.findOneAndUpdate(
    { _id: campaignId, workspaceId, status: { $in: ['QUEUED', 'SCHEDULED', 'PROCESSING'] } },
    { $set: { status: 'PROCESSING' } }, { new: true },
  );
  if (!processing) return { ignored: true };
  const activation = await activateFailedRetryBatch(processing);
  if ('blocked' in activation && activation.blocked) return { ignored: true, reason: 'RETRY_SENDER_UNAVAILABLE' };
  const workerId = String(job.id ?? `worker-${process.pid}`).slice(0, 120);
  let handled = 0;
  while (handled < env.CAMPAIGN_BATCH_SIZE) {
    const current = await Campaign.findOne({ _id: campaignId, workspaceId }).select('status').lean();
    if (!current || current.status === 'PAUSED' || current.status === 'CANCELLED') break;
    const recipient = await claimRecipient(campaignId, workspaceId, workerId);
    if (!recipient) break;
    if (recipient.retryBatchId) {
      const previous = recipient.attemptHistory?.at(-1);
      if (previous?.metaMessageId) {
        const priorMessage = await WhatsAppMessage.findOne({ workspaceId, whatsappAccountId: processing.whatsappAccountId, phoneNumberId: processing.phoneNumberId, metaMessageId: previous.metaMessageId }).lean();
        if (priorMessage && ['SENT', 'DELIVERED', 'READ'].includes(priorMessage.status)) {
          await CampaignRecipient.updateOne({ _id: recipient._id, workspaceId, status: 'QUEUED', workerId }, { $set: { status: priorMessage.status, submissionState: 'ACCEPTED', metaMessageId: priorMessage.metaMessageId, whatsappMessageId: priorMessage._id }, $unset: { leaseUntil: '', workerId: '', retryBatchId: '' } });
          handled += 1;
          continue;
        }
      }
    }
    const consent = await recheckConsent({
      workspaceId,
      campaignId,
      whatsappAccountId: processing.whatsappAccountId,
      contactId: recipient.contactId,
      recipientPhone: recipient.recipientPhone,
      strictConsent: Boolean(processing.sourceCampaignId),
    });
    if (!consent.eligible) {
      await CampaignRecipient.updateOne({ _id: recipient._id, status: 'QUEUED', workerId }, {
        $set: { status: 'SKIPPED', failedAt: new Date(), failureCode: consent.code, failureMessage: consent.message, failureSource: 'VALIDATION', retrySafety: 'PERMANENT' },
        $push: { attemptHistory: { $each: [{ attempt: recipient.attemptCount, at: new Date(), status: 'SKIPPED', failureCode: consent.code, failureMessage: consent.message, failureSource: 'VALIDATION', retrySafety: 'PERMANENT' }], $slice: -10 } },
        $unset: { leaseUntil: '', workerId: '' },
      });
      handled += 1;
      continue;
    }
    if (processing.sourceCampaignId) {
      if (!await retargetSenderStillBound(workspaceId, processing.retargetingSourceAccountId, processing.retargetingSourceWabaId)) {
        await CampaignRecipient.updateOne({ _id: recipient._id, workspaceId, status: 'QUEUED', workerId }, {
          $set: { status: 'SKIPPED', failedAt: new Date(), failureCode: 'RETARGET_SENDER_CHANGED', failureMessage: 'Original WhatsApp account is disconnected or changed.', failureSource: 'VALIDATION', retrySafety: 'PERMANENT' },
          $unset: { leaseUntil: '', workerId: '' },
        });
        handled += 1;
        continue;
      }
      if (!await recheckRetargetSource(workspaceId, processing.sourceCampaignId, recipient.sourceRecipientId, processing.retargetingFilter)) {
        await CampaignRecipient.updateOne({ _id: recipient._id, workspaceId, status: 'QUEUED', workerId }, {
          $set: { status: 'SKIPPED', failedAt: new Date(), failureCode: 'RETARGET_OUTCOME_CHANGED', failureMessage: 'Source campaign outcome changed or could not be verified.', failureSource: 'VALIDATION', retrySafety: 'PERMANENT' },
          $unset: { leaseUntil: '', workerId: '' },
        });
        handled += 1;
        continue;
      }
    }
    const prepared = (recipient.resolvedParameters ?? {}) as { bodyVariables?: string[]; headerVariables?: string[]; buttonVariables?: Record<string, string> };
    const media = (processing.mediaMapping as { media?: { type?: unknown; source?: unknown; value?: unknown; fileName?: unknown } } | undefined)?.media;
    try {
      validateRecipientSendPayload({ templateSnapshot: processing.templateSnapshot as { name?: string; language?: string; components?: unknown[] }, recipientPhone: recipient.recipientPhone, parameters: prepared, ...(media ? { media } : {}) });
    } catch {
      await CampaignRecipient.updateOne({ _id: recipient._id, status: 'QUEUED', workerId }, {
        $set: { status: 'FAILED', failedAt: new Date(), failureCode: 'INVALID_TEMPLATE_PARAMETERS', failureMessage: 'Recipient template parameters are invalid; no provider send was attempted.', failureSource: 'VALIDATION', retrySafety: 'PERMANENT' },
        $push: { attemptHistory: { $each: [{ attempt: recipient.attemptCount, at: new Date(), status: 'FAILED', failureCode: 'INVALID_TEMPLATE_PARAMETERS', failureSource: 'VALIDATION', retrySafety: 'PERMANENT' }], $slice: -10 } },
        $unset: { leaseUntil: '', workerId: '' },
      });
      handled += 1;
      continue;
    }
    const submitting = await CampaignRecipient.findOneAndUpdate(
      { _id: recipient._id, workspaceId, campaignId, status: 'QUEUED', workerId, submissionState: 'NOT_SUBMITTED' },
      { $set: { status: 'SENDING', submissionState: 'SUBMITTING' } }, { new: true },
    );
    if (!submitting) continue;
    let submissionStarted = false;
    try {
      const parameters = (submitting.resolvedParameters ?? {}) as { bodyVariables?: string[]; headerVariables?: string[]; buttonVariables?: Record<string, string> };
      const result = await sendApprovedTemplateMessage({
        workspaceId,
        whatsappAccountId: processing.whatsappAccountId,
        phoneNumberId: processing.phoneNumberId,
        templateRecordId: processing.whatsAppTemplateId!,
        recipient: submitting.recipientPhone,
        ...(parameters.bodyVariables ? { bodyVariables: parameters.bodyVariables } : {}),
        ...(parameters.headerVariables ? { headerVariables: parameters.headerVariables } : {}),
        ...(parameters.buttonVariables ? { buttonVariables: parameters.buttonVariables } : {}),
        ...(media ? { media } : {}),
        campaignId: processing._id,
        ...(submitting.retryBatchId ? { retryRecipientId: submitting._id } : { campaignRecipientId: submitting._id }),
        onProviderSubmit: () => { submissionStarted = true; },
      });
      await CampaignRecipient.updateOne({ _id: submitting._id, status: 'SENDING', submissionState: 'SUBMITTING' }, {
        $set: { status: 'ACCEPTED', submissionState: 'ACCEPTED', whatsappMessageId: result.recordId, metaMessageId: result.messageId, acceptedAt: result.acceptedAt },
        $push: { attemptHistory: { $each: [{ attempt: submitting.attemptCount, at: result.acceptedAt, status: 'ACCEPTED', metaMessageId: result.messageId }], $slice: -10 } },
        $unset: { leaseUntil: '', workerId: '', nextAttemptAt: '', nextEligibleRetryAt: '', failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '', failureSource: '', retrySafety: '', retryBatchId: '' },
      });
    } catch (error) {
      const classification = classifyBroadcastError(error, submissionStarted, submitting.attemptCount);
      const { autoRetry, ...details } = classification;
      const history = { attempt: submitting.attemptCount, at: new Date(), status: autoRetry ? 'RETRY_WAIT' : 'FAILED', ...Object.fromEntries(Object.entries(details).filter(([key]) => key !== 'nextEligibleRetryAt')) };
      if (autoRetry) {
        await CampaignRecipient.updateOne({ _id: submitting._id, status: 'SENDING' }, {
          $set: { status: 'RETRY_WAIT', submissionState: 'NOT_SUBMITTED', nextAttemptAt: details.nextEligibleRetryAt, ...details },
          $push: { attemptHistory: { $each: [history], $slice: -10 } },
          $unset: { leaseUntil: '', workerId: '' },
        });
      } else {
        await CampaignRecipient.updateOne({ _id: submitting._id, status: 'SENDING' }, {
          $set: { status: 'FAILED', submissionState: details.retrySafety === 'UNCERTAIN' ? 'UNCERTAIN' : 'NOT_SUBMITTED', failedAt: new Date(), ...details },
          $push: { attemptHistory: { $each: [history], $slice: -10 } },
          $unset: { leaseUntil: '', workerId: '' },
        });
      }
    }
    handled += 1;
  }
  const remaining = await refreshCounters(campaignId, workspaceId, activation.hasMore);
  if (remaining || activation.hasMore) {
    const next = await CampaignRecipient.findOne({ workspaceId, campaignId, status: 'RETRY_WAIT', nextAttemptAt: { $gt: new Date() } }).sort({ nextAttemptAt: 1 }).select('nextAttemptAt').lean();
    const delay = activation.hasMore || handled ? 0 : next?.nextAttemptAt ? Math.max(0, next.nextAttemptAt.getTime() - Date.now()) : 1_000;
    await enqueueCampaign({ workspaceId, campaignId, sequence: Number(sequence) + 1 }, delay);
  }
  return { handled, remaining };
}

export async function reconcileCampaignWork() {
  const now = new Date();
  await CampaignRecipient.updateMany(
    { status: 'QUEUED', leaseUntil: { $lt: now }, submissionState: 'NOT_SUBMITTED' },
    { $set: { status: 'RETRY_WAIT', nextAttemptAt: now }, $unset: { leaseUntil: '', workerId: '' } },
  );
  const expired = await CampaignRecipient.find({ status: 'SENDING', leaseUntil: { $lt: now }, submissionState: 'SUBMITTING' }).limit(500).lean();
  for (const recipient of expired) {
    const message = await WhatsAppMessage.findOne({ workspaceId: recipient.workspaceId, ...(recipient.retryBatchId ? { retryRecipientId: recipient._id } : { campaignRecipientId: recipient._id }) }).sort({ createdAt: -1 }).lean();
    await CampaignRecipient.updateOne({ _id: recipient._id, status: 'SENDING', submissionState: 'SUBMITTING' }, message ? {
      $set: { status: 'ACCEPTED', submissionState: 'ACCEPTED', whatsappMessageId: message._id, metaMessageId: message.metaMessageId, acceptedAt: message.acceptedAt },
      $unset: { leaseUntil: '', workerId: '' },
    } : {
      $set: { status: 'FAILED', submissionState: 'UNCERTAIN', failedAt: now, failureCode: 'AMBIGUOUS_WORKER_EXIT', failureMessage: 'Worker stopped during provider submission; automatic resend blocked.', failureSource: 'WORKER', retrySafety: 'UNCERTAIN' },
      $unset: { leaseUntil: '', workerId: '' },
    });
  }
  const campaigns = await Campaign.find({
    $or: [{ status: 'SCHEDULED', scheduledAt: { $lte: now } }, { status: { $in: ['QUEUED', 'PROCESSING'] } }],
  }).limit(100);
  for (const campaign of campaigns) {
    campaign.dispatchSequence = (campaign.dispatchSequence ?? 0) + 1;
    if (campaign.status === 'SCHEDULED') campaign.status = 'QUEUED';
    await campaign.save();
    await enqueueCampaign({ workspaceId: String(campaign.workspaceId), campaignId: String(campaign._id), sequence: campaign.dispatchSequence });
  }
  return { campaigns: campaigns.length };
}
