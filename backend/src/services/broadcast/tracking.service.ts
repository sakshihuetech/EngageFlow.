import { Types } from 'mongoose';
import { Campaign } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { classifyWebhookFailure } from './retry-classification.service.js';

export type DeliveryStatus = 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export type RecipientStatus = 'PENDING' | 'QUEUED' | 'SENDING' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'RETRY_WAIT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

const deliveryRank: Partial<Record<RecipientStatus, number>> = { ACCEPTED: 0, SENT: 1, DELIVERED: 2, READ: 3 };
export const actionableStatuses: RecipientStatus[] = ['PENDING', 'QUEUED', 'SENDING', 'RETRY_WAIT'];
export const counterFields = ['total', 'pending', 'queued', 'accepted', 'sent', 'delivered', 'read', 'failed', 'skipped', 'cancelled'] as const;

export function counterForStatus(status: RecipientStatus) {
  return ({
    PENDING: 'pending', RETRY_WAIT: 'pending', SENDING: 'pending', QUEUED: 'queued',
    ACCEPTED: 'accepted', SENT: 'sent', DELIVERED: 'delivered', READ: 'read',
    FAILED: 'failed', SKIPPED: 'skipped', CANCELLED: 'cancelled',
  } as const)[status];
}

export function canAdvanceRecipient(current: RecipientStatus, incoming: DeliveryStatus) {
  if (current === 'FAILED' || current === 'READ') return false;
  if (incoming === 'FAILED') return ['SENDING', 'ACCEPTED', 'SENT'].includes(current);
  if (current === 'SENDING') return ['SENT', 'DELIVERED', 'READ'].includes(incoming);
  const currentRank = deliveryRank[current];
  const incomingRank = deliveryRank[incoming];
  return currentRank !== undefined && incomingRank !== undefined && incomingRank > currentRank;
}

export function counterSnapshot(rows: Array<{ _id: string; count: number }>) {
  const counters: Record<(typeof counterFields)[number], number> = {
    total: 0, pending: 0, queued: 0, accepted: 0, sent: 0,
    delivered: 0, read: 0, failed: 0, skipped: 0, cancelled: 0,
  };
  for (const row of rows) {
    counters.total += Number(row.count) || 0;
    const field = counterForStatus(row._id as RecipientStatus);
    if (field) counters[field] += Number(row.count) || 0;
  }
  return counters;
}

export async function updateCampaignCompletion(workspaceId: Types.ObjectId | string, campaignId: Types.ObjectId | string) {
  const actionable = await CampaignRecipient.exists({ workspaceId, campaignId, status: { $in: actionableStatuses } });
  if (actionable) return null;
  const campaign = await Campaign.findOne({ _id: campaignId, workspaceId }).select('status retryBatchId').lean();
  if (campaign?.retryBatchId && ['QUEUED', 'PROCESSING'].includes(campaign.status)) {
    const unevaluated = await CampaignRecipient.exists({ workspaceId, campaignId, status: 'FAILED', retryEvaluationBatchId: { $ne: campaign.retryBatchId } });
    if (unevaluated) return null;
  }
  const hasErrors = await CampaignRecipient.exists({ workspaceId, campaignId, status: { $in: ['FAILED', 'SKIPPED'] } });
  const status = hasErrors ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  await Campaign.updateOne(
    { _id: campaignId, workspaceId, status: { $in: ['QUEUED', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS'] } },
    { $set: { status } },
  );
  return status;
}

interface CorrelatedMessage {
  sendSource: string;
  workspaceId: Types.ObjectId | string;
  campaignId?: Types.ObjectId | string | null;
  campaignRecipientId?: Types.ObjectId | string | null;
  retryRecipientId?: Types.ObjectId | string | null;
  metaMessageId?: string | null;
}

export async function propagateMessageStatus(input: {
  message: CorrelatedMessage;
  incomingStatus: DeliveryStatus;
  timestamp?: Date;
  failure?: { failureCode?: unknown; failureSubcode?: unknown; failureTitle?: unknown; failureMessage?: unknown };
}) {
  const { message, incomingStatus, timestamp = new Date(), failure = {} } = input;
  const recipientId = message.retryRecipientId ?? message.campaignRecipientId;
  if (message.sendSource !== 'CAMPAIGN' || !message.campaignId || !recipientId) return { outcome: 'notCampaign' };
  const recipient = await CampaignRecipient.findOne({
    _id: recipientId,
    workspaceId: message.workspaceId,
    campaignId: message.campaignId,
  }).lean();
  if (!recipient) return { outcome: 'missingRecipient' };
  const current = recipient.status as RecipientStatus;
  if (message.metaMessageId && recipient.metaMessageId !== message.metaMessageId) return { outcome: 'staleAttempt' };
  if (recipient.retryBatchId && current === 'SENDING' && recipient.submissionState === 'SUBMITTING'
    && message.campaignRecipientId && !message.retryRecipientId) return { outcome: 'staleAttempt' };
  const delayedSuccess = current === 'FAILED' && ['SENT', 'DELIVERED', 'READ'].includes(incomingStatus) && Boolean(message.metaMessageId);
  const preSubmitSuccess = Boolean(recipient.retryBatchId) && ['RETRY_WAIT', 'QUEUED'].includes(current) && recipient.submissionState === 'NOT_SUBMITTED'
    && ['SENT', 'DELIVERED', 'READ'].includes(incomingStatus) && Boolean(message.metaMessageId);
  if (!delayedSuccess && !preSubmitSuccess && !canAdvanceRecipient(current, incomingStatus)) return { outcome: current === incomingStatus ? 'duplicate' : 'outOfOrder' };

  const timestampField = ({ ACCEPTED: 'acceptedAt', SENT: 'sentAt', DELIVERED: 'deliveredAt', READ: 'readAt', FAILED: 'failedAt' } as const)[incomingStatus];
  const classified = incomingStatus === 'FAILED' ? classifyWebhookFailure(failure) : undefined;
  const update = {
    status: incomingStatus,
    ...(timestampField ? { [timestampField]: timestamp } : {}),
    ...(classified ?? {}),
  };
  const changed = await CampaignRecipient.findOneAndUpdate(
    { _id: recipient._id, workspaceId: message.workspaceId, campaignId: message.campaignId, status: current, ...(preSubmitSuccess ? { submissionState: 'NOT_SUBMITTED' } : {}) },
    { $set: { ...update, ...(preSubmitSuccess ? { submissionState: 'ACCEPTED' } : {}) }, ...(classified ? { $push: { attemptHistory: { $each: [{ attempt: recipient.attemptCount, at: timestamp, status: 'FAILED', metaMessageId: message.metaMessageId, ...classified }], $slice: -10 } } } : delayedSuccess || preSubmitSuccess ? { $unset: { failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '', failureSource: '', retrySafety: '', nextEligibleRetryAt: '', ...(preSubmitSuccess ? { retryBatchId: '', nextAttemptAt: '', leaseUntil: '', workerId: '' } : {}) } } : {}) },
    { new: true },
  );
  if (!changed) return { outcome: 'duplicateConcurrent' };

  const previousCounter = counterForStatus(current);
  const nextCounter = counterForStatus(incomingStatus);
  if (previousCounter !== nextCounter) {
    await Campaign.updateOne({ _id: message.campaignId, workspaceId: message.workspaceId }, {
      $inc: { [`counters.${previousCounter}`]: -1, [`counters.${nextCounter}`]: 1 },
    });
  }
  await updateCampaignCompletion(message.workspaceId, message.campaignId);
  return { outcome: 'updated', previousStatus: current, status: incomingStatus };
}

export async function reconcileCampaignCounters(workspaceId: Types.ObjectId | string, campaignId: Types.ObjectId | string) {
  const workspaceObjectId = typeof workspaceId === 'string' ? new Types.ObjectId(workspaceId) : workspaceId;
  const campaignObjectId = typeof campaignId === 'string' ? new Types.ObjectId(campaignId) : campaignId;
  const rows = await CampaignRecipient.aggregate<{ _id: string; count: number }>([
    { $match: { workspaceId: workspaceObjectId, campaignId: campaignObjectId } },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const counters = counterSnapshot(rows);
  const campaign = await Campaign.findOne({ _id: campaignId, workspaceId }).lean();
  if (!campaign) return null;
  const hasActionable = counters.pending + counters.queued > 0;
  const terminal = hasActionable ? null : counters.failed + counters.skipped > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED';
  const preserve = ['DRAFT', 'SNAPSHOTTING', 'READY', 'SCHEDULED', 'PAUSED', 'CANCELLED', 'FAILED'].includes(campaign.status);
  await Campaign.updateOne({ _id: campaignId, workspaceId }, { $set: { counters, ...(!preserve && terminal ? { status: terminal } : {}) } });
  return { counters, status: !preserve && terminal ? terminal : campaign.status };
}

export function analyticsFromCampaign(campaign: { _id: unknown; status: string; counters?: Partial<Record<(typeof counterFields)[number], number>>; updatedAt?: Date }) {
  const counters = Object.fromEntries(counterFields.map((field) => [field, Number(campaign.counters?.[field] ?? 0)])) as Record<(typeof counterFields)[number], number>;
  const denominator = Math.max(0, counters.total - counters.skipped - counters.cancelled);
  const rate = (value: number) => denominator ? Number(((value / denominator) * 100).toFixed(2)) : 0;
  return {
    campaignId: String(campaign._id), status: campaign.status, counters,
    deliveryRate: rate(counters.delivered + counters.read),
    readRate: rate(counters.read),
    failureRate: rate(counters.failed),
    updatedAt: campaign.updatedAt,
  };
}
