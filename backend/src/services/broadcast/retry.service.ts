import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { Campaign } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { Contact } from '../../models/contact.model.js';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { MetaCredential } from '../../models/meta-credential.model.js';
import { env } from '../../config/env.js';
import { campaignQueueHealth, enqueueCampaign } from '../../config/campaign-queue.js';
import { AppError } from '../../utils/app-error.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';
import { liveSendEnabled, transportConfigured, validateCampaignAssets, type CampaignRecord } from './execution.service.js';
import { MAX_BROADCAST_ATTEMPTS, retryExclusion } from './retry-classification.service.js';
import { safeFailureText } from './safety.js';

type CampaignIdentity = CampaignRecord;

async function senderReadiness(campaign: CampaignIdentity) {
  try {
    if (!liveSendEnabled() || !transportConfigured()) throw new AppError(503, 'TRANSPORT_NOT_CONFIGURED', 'Live WhatsApp transport is unavailable.');
    const { account } = await validateCampaignAssets(campaign);
    if (env.CAMPAIGN_TRANSPORT === 'meta') {
      const credential = await MetaCredential.findOne({ workspaceId: campaign.workspaceId, connectionId: account.connectionId }).select('expiresAt').lean();
      if (!credential || (credential.expiresAt && credential.expiresAt.getTime() <= Date.now())) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is missing or expired.');
    }
    return { ready: true as const };
  } catch (error) {
    return { ready: false as const, reason: error instanceof AppError ? error.code : 'SENDER_UNAVAILABLE' };
  }
}

export async function previewFailedBroadcastRetry(campaign: CampaignIdentity) {
  const workspaceId = campaign.workspaceId instanceof Types.ObjectId ? campaign.workspaceId : new Types.ObjectId(String(campaign.workspaceId));
  const campaignId = campaign._id instanceof Types.ObjectId ? campaign._id : new Types.ObjectId(String(campaign._id));
  const now = new Date();
  const rows = await CampaignRecipient.aggregate<{ _id: string; count: number }>([
    { $match: { workspaceId, campaignId, status: 'FAILED' } },
    { $lookup: { from: 'contacts', localField: 'contactId', foreignField: '_id', as: 'contactRows' } },
    { $lookup: { from: 'whatsappmessages', localField: 'metaMessageId', foreignField: 'metaMessageId', as: 'providerRows' } },
    { $addFields: { contact: { $first: '$contactRows' }, providerMessage: { $first: '$providerRows' } } },
    { $project: { reason: { $switch: { branches: [
      { case: { $or: [{ $eq: ['$retrySafety', 'UNCERTAIN'] }, { $eq: ['$submissionState', 'UNCERTAIN'] }] }, then: 'UNCERTAIN_OUTCOME' },
      { case: { $ne: ['$retrySafety', 'SAFE'] }, then: 'PERMANENT_OR_UNCLASSIFIED' },
      { case: { $gte: ['$attemptCount', MAX_BROADCAST_ATTEMPTS] }, then: 'ATTEMPT_LIMIT' },
      { case: { $and: [{ $eq: ['$failureCode', '429'] }, { $eq: [{ $ifNull: ['$nextEligibleRetryAt', null] }, null] }] }, then: 'PROVIDER_RESTRICTION' },
      { case: { $gt: ['$nextEligibleRetryAt', now] }, then: 'RETRY_AFTER' },
      { case: { $and: [{ $ne: [{ $ifNull: ['$metaMessageId', null] }, null] }, { $ne: ['$failureSource', 'META_WEBHOOK'] }] }, then: 'PROVIDER_OUTCOME_UNCERTAIN' },
      { case: { $in: ['$providerMessage.status', ['SENT', 'DELIVERED', 'READ']] }, then: 'ALREADY_DELIVERED' },
      { case: { $or: [
        { $eq: [{ $ifNull: ['$contact', null] }, null] },
        { $ne: ['$contact.workspaceId', workspaceId] },
        { $ne: ['$contact.status', 'ACTIVE'] },
        { $ne: ['$contact.phoneE164', '$recipientPhone'] },
        { $ne: ['$contact.whatsappConsent.status', 'OPTED_IN'] },
        { $ne: ['$contact.whatsappConsent.accountId', campaign.whatsappAccountId] },
        { $eq: [{ $trim: { input: { $ifNull: ['$contact.whatsappConsent.source', ''] } } }, ''] },
        { $eq: [{ $trim: { input: { $ifNull: ['$contact.whatsappConsent.evidence', ''] } } }, ''] },
      ] }, then: 'CONSENT_OR_CONTACT' },
    ], default: 'ELIGIBLE' } } } },
    { $group: { _id: '$reason', count: { $sum: 1 } } },
  ]);
  const reasons = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const totalFailed = rows.reduce((sum, row) => sum + row.count, 0);
  const sender = await senderReadiness(campaign);
  const queue = await campaignQueueHealth();
  const eligible = sender.ready && queue.ready && campaign.status === 'COMPLETED_WITH_ERRORS' ? reasons.ELIGIBLE ?? 0 : 0;
  return {
    campaignStatus: campaign.status, totalFailed, eligible,
    temporaryRestrictions: (reasons.RETRY_AFTER ?? 0) + (reasons.PROVIDER_RESTRICTION ?? 0),
    permanentFailures: (reasons.PERMANENT_OR_UNCLASSIFIED ?? 0) + (reasons.ATTEMPT_LIMIT ?? 0),
    uncertainOutcomes: (reasons.UNCERTAIN_OUTCOME ?? 0) + (reasons.PROVIDER_OUTCOME_UNCERTAIN ?? 0),
    exclusionReasons: { ...reasons, ...(!sender.ready ? { SENDER_UNAVAILABLE: reasons.ELIGIBLE ?? 0 } : {}), ...(!queue.ready ? { QUEUE_UNAVAILABLE: reasons.ELIGIBLE ?? 0 } : {}) },
    senderReady: sender.ready, senderReason: sender.ready ? undefined : sender.reason,
    queueReady: queue.ready, queueReason: queue.reason,
    canRetry: eligible > 0,
  };
}

export async function confirmFailedBroadcastRetry(campaign: CampaignIdentity, retryKey: unknown) {
  if (typeof retryKey !== 'string' || !/^[A-Za-z0-9._:-]{8,160}$/.test(retryKey)) throw new AppError(400, 'INVALID_RETRY_KEY', 'A valid retry request key is required.');
  if (campaign.retryBatchId && campaign.retryKey === retryKey) return { accepted: true, idempotent: true, retryBatchId: campaign.retryBatchId };
  const preview = await previewFailedBroadcastRetry(campaign);
  if (!preview.canRetry) throw new AppError(409, 'NO_SAFE_RETRY_RECIPIENTS', 'No failed recipients are currently safe and eligible to retry.');
  const retryBatchId = randomUUID();
  const claimed = await Campaign.findOneAndUpdate({ _id: campaign._id, workspaceId: campaign.workspaceId, whatsappAccountId: campaign.whatsappAccountId, status: 'COMPLETED_WITH_ERRORS' }, {
    $set: { status: 'QUEUED', retryBatchId, retryKey, retryRequestedAt: new Date() }, $inc: { dispatchSequence: 1 }, $unset: { retryLastError: '' },
  }, { new: true });
  if (!claimed) throw new AppError(409, 'RETRY_ALREADY_STARTED', 'A retry is already running or the campaign state changed.');
  try {
    await enqueueCampaign({ workspaceId: String(campaign.workspaceId), campaignId: String(campaign._id), sequence: claimed.dispatchSequence ?? 1 });
  } catch {
    // The durable QUEUED claim is intentionally retained; the existing worker
    // reconciler will redispatch it after Redis recovers.
    return { accepted: true, idempotent: false, retryBatchId, dispatchDelayed: true };
  }
  return { accepted: true, idempotent: false, retryBatchId, dispatchDelayed: false };
}

export async function activateFailedRetryBatch(campaign: CampaignIdentity, limit = 100) {
  if (!campaign.retryBatchId) return { inspected: 0, hasMore: false };
  const sender = await senderReadiness(campaign);
  if (!sender.ready) {
    await Campaign.updateOne({ _id: campaign._id, workspaceId: campaign.workspaceId, retryBatchId: campaign.retryBatchId }, { $set: { status: 'COMPLETED_WITH_ERRORS', retryLastError: safeFailureText(sender.reason ?? 'Sender unavailable.', 300) } });
    return { inspected: 0, hasMore: false, blocked: true };
  }
  const batchId = campaign.retryBatchId;
  const filter = { workspaceId: campaign.workspaceId, campaignId: campaign._id, status: 'FAILED' as const, retryEvaluationBatchId: { $ne: batchId } };
  const rows = await CampaignRecipient.find(filter).sort({ _id: 1 }).limit(limit).lean();
  const now = new Date();
  for (const row of rows) {
    let reason = retryExclusion(row, now);
    if (!reason && row.metaMessageId) {
      const previous = await WhatsAppMessage.findOne({ workspaceId: campaign.workspaceId, whatsappAccountId: campaign.whatsappAccountId, phoneNumberId: campaign.phoneNumberId, metaMessageId: row.metaMessageId }).lean();
      if (previous && ['SENT', 'DELIVERED', 'READ'].includes(previous.status)) {
        await CampaignRecipient.updateOne({ _id: row._id, workspaceId: campaign.workspaceId, campaignId: campaign._id, status: 'FAILED', metaMessageId: previous.metaMessageId }, { $set: { status: previous.status, submissionState: 'ACCEPTED', retryEvaluationBatchId: batchId }, $unset: { failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '', failureSource: '', retrySafety: '', retryExclusionReason: '' } });
        continue;
      }
    }
    if (!reason) {
      const contact = row.contactId ? await Contact.findOne({ _id: row.contactId, workspaceId: campaign.workspaceId }).lean() : null;
      if (!contact || contact.status !== 'ACTIVE' || contact.phoneE164 !== row.recipientPhone || !hasSenderConsent(contact.whatsappConsent, campaign.whatsappAccountId)) reason = 'CONSENT_OR_CONTACT';
    }
    const identity = { _id: row._id, workspaceId: campaign.workspaceId, campaignId: campaign._id, status: 'FAILED' as const, retrySafety: 'SAFE' as const, retryEvaluationBatchId: { $ne: batchId } };
    await CampaignRecipient.updateOne(identity, reason ? { $set: { retryEvaluationBatchId: batchId, retryExclusionReason: reason } } : {
      $set: { status: 'RETRY_WAIT', submissionState: 'NOT_SUBMITTED', nextAttemptAt: now, retryBatchId: batchId, retryEvaluationBatchId: batchId },
      $inc: { manualRetryCount: 1 }, $unset: { retryExclusionReason: '' },
    });
  }
  const hasMore = Boolean(await CampaignRecipient.exists(filter));
  return { inspected: rows.length, hasMore };
}
