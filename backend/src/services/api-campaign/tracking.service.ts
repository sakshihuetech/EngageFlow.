import { ApiCampaignExecution } from '../../models/api-campaign-execution.model.js';
import type { Types } from 'mongoose';
import { metaFailureResolution } from '../whatsapp/meta-graph.service.js';
import { safeApiCampaignFailureText } from './failure-safety.js';

const rank: Record<string, number> = { ACCEPTED: 1, SENT: 2, DELIVERED: 3, READ: 4, FAILED: 5 };
type ProviderFailure = { failureCode?: string | null; failureSubcode?: number | null; failureTitle?: string | null; failureMessage?: string | null };

export function apiCampaignProviderFailure(failure: ProviderFailure) {
  const code = safeApiCampaignFailureText(failure.failureCode, 64);
  const resolution = metaFailureResolution(code);
  return {
    failureCode: /^[A-Za-z0-9_]{1,64}$/.test(code) ? code : 'PROVIDER_DELIVERY_FAILED',
    failureSubcode: typeof failure.failureSubcode === 'number' ? failure.failureSubcode : undefined,
    failureTitle: safeApiCampaignFailureText(failure.failureTitle, 300) || resolution?.title || 'Provider delivery failed',
    failureMessage: safeApiCampaignFailureText(failure.failureMessage, 1000) || resolution?.message || 'Meta reported that the message was not delivered.',
    failureCategory: code === '131042' ? 'META_PERMANENT' : 'META_TRANSIENT',
    retrySafety: code === '429' ? 'SAFE' : 'PERMANENT',
    failureSource: 'META_WEBHOOK',
    retryExhausted: true,
  } as const;
}

export async function trackApiCampaignMessage(
  message: { apiCampaignExecutionId?: Types.ObjectId | string | null; apiCampaignRetryExecutionId?: Types.ObjectId | string | null; metaMessageId?: string | null; workspaceId: Types.ObjectId | string },
  status: string,
  date: Date,
  failure: ProviderFailure = {},
) {
  const executionId = message.apiCampaignRetryExecutionId ?? message.apiCampaignExecutionId;
  if (!executionId) return;
  const execution = await ApiCampaignExecution.findOne({ _id: executionId, workspaceId: message.workspaceId });
  if (message.metaMessageId && execution?.metaMessageId !== message.metaMessageId) return;
  if (!execution || !rank[status]) return;
  if (status === 'FAILED' ? !['SENDING', 'ACCEPTED', 'SENT'].includes(execution.status)
    : (rank[execution.status] ?? 0) >= rank[status] && !(execution.status === 'FAILED' && ['SENT', 'DELIVERED', 'READ'].includes(status))) return;
  const set: Record<string, unknown> = { status };
  if (status === 'SENT') set.sentAt = date;
  if (status === 'DELIVERED') set.deliveredAt = date;
  if (status === 'READ') set.readAt = date;
  if (status === 'FAILED') {
    set.failedAt = date;
    Object.assign(set, apiCampaignProviderFailure(failure));
  }
  await ApiCampaignExecution.updateOne({ _id: execution._id, workspaceId: message.workspaceId, metaMessageId: message.metaMessageId, status: execution.status } as never, { $set: set, ...(status === 'FAILED' ? { $push: { attemptHistory: { $each: [{ attempt: execution.attempts, at: date, status: 'FAILED', messageId: message.metaMessageId, ...apiCampaignProviderFailure(failure) }], $slice: -20 } } } : execution.status === 'FAILED' ? { $unset: { failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '', failureCategory: '', failureSource: '', nextEligibleRetryAt: '' } } : {}) });
}
