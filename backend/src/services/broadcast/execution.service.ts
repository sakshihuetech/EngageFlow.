import { randomUUID } from 'node:crypto';
import type { HydratedDocument } from 'mongoose';
import { enqueueCampaign, campaignQueueHealth } from '../../config/campaign-queue.js';
import { env } from '../../config/env.js';
import { Campaign, type CampaignDocument } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { MetaConnection } from '../../models/meta-connection.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppPhoneNumber } from '../../models/whatsapp-phone-number.model.js';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';
import { snapshotAudience } from './audience.service.js';
import { reconcileCampaignCounters } from './tracking.service.js';
import { validateParameterMapping } from './parameter-mapping.service.js';

export type CampaignRecord = HydratedDocument<CampaignDocument>;

export function liveSendEnabled() {
  return env.CAMPAIGN_LIVE_SEND_ENABLED === 'true';
}

export function transportConfigured() {
  return env.CAMPAIGN_TRANSPORT !== 'disabled' && (env.NODE_ENV !== 'production' || env.CAMPAIGN_TRANSPORT !== 'mock');
}

export function localDateToUtc(value: string, timezone: string) {
  if (!value.trim()) throw new AppError(400, 'INVALID_SCHEDULE', 'Scheduled local datetime is required.');
  if (/(?:Z|[+-]\d\d:\d\d)$/i.test(value)) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new AppError(400, 'INVALID_SCHEDULE', 'Invalid scheduled datetime.');
    return date;
  }
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new AppError(400, 'INVALID_SCHEDULE', 'Use YYYY-MM-DDTHH:mm for a local schedule.');
  const wanted = [
    Number(match[1]), Number(match[2]), Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] ?? 0),
  ];
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  let timestamp = Date.UTC(wanted[0]!, wanted[1]! - 1, wanted[2]!, wanted[3]!, wanted[4]!, wanted[5] ?? 0);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
    timestamp += Date.UTC(wanted[0]!, wanted[1]! - 1, wanted[2]!, wanted[3]!, wanted[4]!, wanted[5] ?? 0)
      - Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
  }
  const date = new Date(timestamp);
  const verify = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  if ([verify.year, verify.month, verify.day, verify.hour, verify.minute].join() !== wanted.slice(0, 5).join()) {
    throw new AppError(400, 'INVALID_SCHEDULE', 'Scheduled local time does not exist in the selected timezone.');
  }
  return date;
}

export function futureScheduledAt(value: string, timezone: string, now = Date.now()) {
  const scheduledAt = localDateToUtc(value, timezone);
  if (scheduledAt.getTime() <= now + 5_000) throw new AppError(400, 'INVALID_SCHEDULE', 'Scheduled time must be in the future.');
  return scheduledAt;
}

export async function validateCampaignAssets(campaign: CampaignRecord) {
  const account = await WhatsAppAccount.findOne({ _id: campaign.whatsappAccountId, workspaceId: campaign.workspaceId, status: 'CONNECTED' }).lean();
  if (!account) throw new AppError(409, 'WHATSAPP_ACCOUNT_UNAVAILABLE', 'Campaign WhatsApp account is unavailable.');
  if (campaign.sourceCampaignId && (String(campaign.retargetingSourceAccountId ?? '') !== String(account._id) || campaign.retargetingSourceWabaId !== account.wabaId)) {
    throw new AppError(409, 'RETARGET_SENDER_CHANGED', 'The original retargeting WABA binding changed.');
  }
  const connection = await MetaConnection.findOne({ _id: account.connectionId, workspaceId: campaign.workspaceId, provider: 'meta', status: 'CONNECTED' }).lean();
  if (!connection) throw new AppError(409, 'WHATSAPP_NOT_CONNECTED', 'WhatsApp is not connected.');
  const phone = await WhatsAppPhoneNumber.findOne({ workspaceId: campaign.workspaceId, whatsappAccountId: account._id, phoneNumberId: campaign.phoneNumberId }).lean();
  if (!phone) throw new AppError(409, 'PHONE_UNAVAILABLE', 'Campaign sending phone is unavailable.');
  if (!['CONNECTED', 'REGISTERED'].includes(String(phone.registrationStatus ?? '').toUpperCase()) || String(phone.codeVerificationStatus ?? '').toUpperCase() !== 'VERIFIED') {
    throw new AppError(409, 'PHONE_NOT_READY', 'Campaign sending phone is not send-ready.');
  }
  const template = await WhatsAppTemplate.findOne({ _id: campaign.whatsAppTemplateId, workspaceId: campaign.workspaceId, whatsappAccountId: account._id, status: 'APPROVED', isActive: true }).lean();
  if (!template) throw new AppError(409, 'TEMPLATE_UNAVAILABLE', 'Campaign template is no longer approved.');
  validateParameterMapping(template.components, campaign.parameterMapping, campaign.mediaMapping);
  const audience = campaign.audienceDefinition as { source?: string; contactIds?: unknown[]; phones?: unknown[]; segmentId?: unknown; sourceCampaignId?: unknown } | undefined;
  const hasAudience = (audience?.source === 'CONTACTS' && Boolean(audience.contactIds?.length))
    || (audience?.source === 'PASTED' && Boolean(audience.phones?.length))
    || (audience?.source === 'SEGMENT' && Boolean(audience.segmentId))
    || (audience?.source === 'RETARGET' && String(audience.sourceCampaignId ?? '') === String(campaign.sourceCampaignId ?? '') && Boolean(campaign.audienceSnapshotCount));
  if (!hasAudience) throw new AppError(409, 'AUDIENCE_EMPTY', 'Campaign audience is empty.');
  return { account, phone, template };
}

export async function campaignReadiness(campaign: CampaignRecord) {
  try {
    await validateCampaignAssets(campaign);
    const queue = await campaignQueueHealth();
    const sending = liveSendEnabled();
    const transport = transportConfigured();
    return {
      valid: campaign.status === 'DRAFT' && queue.ready && sending && transport,
      campaignStatus: campaign.status,
      queueReady: queue.ready,
      queueReason: queue.reason,
      liveSendEnabled: sending,
      transportConfigured: transport,
      audienceCount: campaign.audienceSnapshotCount ?? 0,
      reason: campaign.status !== 'DRAFT' ? 'CAMPAIGN_NOT_DRAFT'
        : !queue.ready ? queue.reason
          : !sending ? 'LIVE_SEND_DISABLED'
            : !transport ? 'TRANSPORT_NOT_CONFIGURED' : undefined,
    };
  } catch (error) {
    return {
      valid: false,
      campaignStatus: campaign.status,
      queueReady: false,
      liveSendEnabled: liveSendEnabled(),
      transportConfigured: transportConfigured(),
      audienceCount: campaign.audienceSnapshotCount ?? 0,
      reason: error instanceof Error ? error.message : 'CAMPAIGN_NOT_READY',
    };
  }
}

export async function launchCampaign(input: {
  campaign: CampaignRecord;
  workspaceId: string;
  mode: unknown;
  scheduledLocal?: unknown;
  timezone: string;
  launchKey?: unknown;
}) {
  const mode = String(input.mode ?? 'SEND_NOW').toUpperCase();
  if (!['SEND_NOW', 'SCHEDULE'].includes(mode)) throw new AppError(400, 'INVALID_LAUNCH_MODE', 'Launch mode must be SEND_NOW or SCHEDULE.');
  const key = typeof input.launchKey === 'string' && input.launchKey.trim() ? input.launchKey.trim() : randomUUID();
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Invalid launch idempotency key.');
  if (input.campaign.status !== 'DRAFT') {
    if (input.campaign.launchKey === key) return { campaign: input.campaign, idempotent: true };
    throw new AppError(409, 'CAMPAIGN_ALREADY_LAUNCHED', 'Campaign has already been launched.');
  }
  if (!liveSendEnabled()) throw new AppError(503, 'LIVE_SEND_DISABLED', 'Campaign sending is disabled in this environment.');
  if (!transportConfigured()) throw new AppError(503, 'TRANSPORT_NOT_CONFIGURED', 'WhatsApp transport is not configured.');
  await validateCampaignAssets(input.campaign);
  const queue = await campaignQueueHealth();
  if (!queue.ready) throw new AppError(503, queue.reason ?? 'REDIS_UNAVAILABLE', 'Campaign queue is unavailable.');
  let scheduledAt: Date | undefined;
  if (mode === 'SCHEDULE') {
    scheduledAt = futureScheduledAt(String(input.scheduledLocal ?? ''), input.timezone);
  }
  const claimed = await Campaign.findOneAndUpdate(
    { _id: input.campaign._id, workspaceId: input.workspaceId, status: 'DRAFT' },
    { $set: { status: 'SNAPSHOTTING', sendMode: mode, scheduledAt, timezone: input.timezone, launchKey: key, launchRequestedAt: new Date() } },
    { new: true },
  );
  if (!claimed) {
    const current = await Campaign.findOne({ _id: input.campaign._id, workspaceId: input.workspaceId });
    if (current?.launchKey === key) return { campaign: current, idempotent: true };
    throw new AppError(409, 'LAUNCH_ALREADY_CLAIMED', 'Campaign launch was already claimed.');
  }
  try {
    const summary = await snapshotAudience(claimed);
    if (!summary.eligible) {
      const parameterFailures = await CampaignRecipient.countDocuments({ workspaceId: input.workspaceId, campaignId: claimed._id, failureCode: 'PARAMETER_RESOLUTION_FAILED' });
      if (parameterFailures) {
        const completed = await Campaign.findOneAndUpdate({ _id: claimed._id, workspaceId: input.workspaceId, status: 'READY' }, { $set: { status: 'COMPLETED_WITH_ERRORS' } }, { new: true });
        if (!completed) throw new AppError(409, 'LAUNCH_STATE_CONFLICT', 'Campaign state changed during launch.');
        return { campaign: completed, summary, idempotent: false };
      }
      await Campaign.updateOne({ _id: claimed._id, workspaceId: input.workspaceId, status: 'READY' }, { $set: { status: 'FAILED' } });
      throw new AppError(409, 'NO_ELIGIBLE_RECIPIENTS', 'Campaign has no eligible opted-in recipients.');
    }
    const targetStatus = mode === 'SCHEDULE' ? 'SCHEDULED' : 'QUEUED';
    const transitioned = await Campaign.findOneAndUpdate(
      { _id: claimed._id, workspaceId: input.workspaceId, status: 'READY' },
      { $set: { status: targetStatus } },
      { new: true },
    );
    if (!transitioned) throw new AppError(409, 'LAUNCH_STATE_CONFLICT', 'Campaign state changed during launch.');
    await enqueueCampaign({ workspaceId: input.workspaceId, campaignId: String(claimed._id), sequence: transitioned.dispatchSequence ?? 0 }, scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : 0);
    return { campaign: transitioned, summary, idempotent: false };
  } catch (error) {
    if (!(error instanceof AppError && error.statusCode === 409)) {
      await Campaign.updateOne({ _id: claimed._id, workspaceId: input.workspaceId, status: { $in: ['SNAPSHOTTING', 'READY', 'QUEUED', 'SCHEDULED'] } }, { $set: { status: 'FAILED' } });
    }
    throw error;
  }
}

export async function pauseCampaign(campaignId: string, workspaceId: string) {
  return Campaign.findOneAndUpdate(
    { _id: campaignId, workspaceId, status: { $in: ['SCHEDULED', 'QUEUED', 'PROCESSING'] } },
    { $set: { status: 'PAUSED' } }, { new: true },
  );
}

export async function resumeCampaign(
  campaignId: string,
  workspaceId: string,
  queueAdapter = { health: campaignQueueHealth, enqueue: enqueueCampaign },
) {
  const queue = await queueAdapter.health();
  if (!queue.ready) throw new AppError(503, queue.reason ?? 'REDIS_UNAVAILABLE', 'Campaign queue is unavailable.');
  const current = await Campaign.findOne({ _id: campaignId, workspaceId, status: 'PAUSED' });
  if (!current) return null;
  const scheduled = Boolean(current.scheduledAt && current.scheduledAt.getTime() > Date.now());
  const resumed = await Campaign.findOneAndUpdate(
    { _id: campaignId, workspaceId, status: 'PAUSED' },
    { $set: { status: scheduled ? 'SCHEDULED' : 'QUEUED' }, $inc: { dispatchSequence: 1 } },
    { new: true },
  );
  if (resumed) await queueAdapter.enqueue({ workspaceId, campaignId, sequence: resumed.dispatchSequence ?? 0 }, scheduled && current.scheduledAt ? current.scheduledAt.getTime() - Date.now() : 0);
  return resumed;
}

export async function cancelCampaign(campaignId: string, workspaceId: string, reconcile = reconcileCampaignCounters) {
  const campaign = await Campaign.findOneAndUpdate(
    { _id: campaignId, workspaceId, status: { $in: ['SNAPSHOTTING', 'READY', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PAUSED'] } },
    { $set: { status: 'CANCELLED' } }, { new: true },
  );
  if (!campaign) return null;
  await CampaignRecipient.updateMany(
    { workspaceId, campaignId, status: { $in: ['PENDING', 'QUEUED', 'RETRY_WAIT'] } },
    { $set: { status: 'CANCELLED' }, $unset: { leaseUntil: '', workerId: '' } },
  );
  await reconcile(workspaceId, campaignId);
  return campaign;
}
