import type { Job } from 'bullmq';
import { ApiCampaign } from '../../models/api-campaign.model.js';
import { ApiCampaignExecution } from '../../models/api-campaign-execution.model.js';
import { Contact } from '../../models/contact.model.js';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { enqueueApiCampaignExecution, apiCampaignJobId, type ApiCampaignJobData } from '../../config/api-campaign-queue.js';
import { sendApprovedTemplateMessage } from '../whatsapp/send-approved-template.service.js';
import { metaFailureResolution, MetaGraphError } from '../whatsapp/meta-graph.service.js';
import { AppError } from '../../utils/app-error.js';
import { ProviderSendError } from '../whatsapp/transport.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';
import { assertApiCampaignAssetsReady } from './send-readiness.service.js';
import { safeApiCampaignFailureText as sanitize } from './failure-safety.js';

const MAX_ATTEMPTS = 5;
const MAX_AUTO_RETRIES = 3;

export function safeApiCampaignFailure(error: unknown) {
  const providerCode = error instanceof MetaGraphError ? error.details.code : undefined;
  const resolution = metaFailureResolution(providerCode);
  const rawCode = resolution?.code ?? (error instanceof MetaGraphError || error instanceof AppError || error instanceof ProviderSendError ? error.code : 'EXECUTION_FAILED');
  const code = /^[A-Za-z0-9_]{1,64}$/.test(rawCode) ? rawCode : 'EXECUTION_FAILED';
  const providerTitle = error instanceof MetaGraphError ? sanitize(error.details.userTitle, 300) : '';
  const safeMessage = sanitize(error instanceof MetaGraphError ? error.details.userMessage || error.message : error instanceof AppError || error instanceof ProviderSendError ? error.message : '', 1000);
  return { failureCode: code, failureSubcode: error instanceof MetaGraphError ? error.details.errorSubcode : undefined, failureTitle: providerTitle || resolution?.title || safeMessage.slice(0, 300) || 'API Campaign execution failed', failureMessage: safeMessage || resolution?.message || 'The execution could not be completed.' };
}

export function classifyApiCampaignFailure(error: unknown, submissionStarted: boolean, attempt = 1) {
  const throttle = error instanceof MetaGraphError && error.status === 429 && typeof error.details.code === 'number';
  const permanentProvider = error instanceof MetaGraphError && error.status >= 400 && error.status < 500 && !throttle;
  const preflight = !submissionStarted;
  const retrySafety = throttle ? 'SAFE' as const : permanentProvider || preflight ? 'PERMANENT' as const : 'UNCERTAIN' as const;
  const retryAfter = throttle ? error.details.retryAfterMs : undefined;
  const backoff = Math.min(15 * 60_000, 5_000 * 2 ** Math.min(attempt - 1, 6) + Math.floor(Math.random() * 1_000));
  const nextEligibleRetryAt = retryAfter ? new Date(Date.now() + Math.max(retryAfter, backoff)) : undefined;
  const autoRetry = throttle && Boolean(nextEligibleRetryAt) && attempt < MAX_AUTO_RETRIES;
  return { failureCategory: preflight ? 'VALIDATION' as const : permanentProvider ? 'META_PERMANENT' as const : 'META_TRANSIENT' as const, retrySafety, nextEligibleRetryAt, retryRestriction: throttle && !nextEligibleRetryAt ? 'PROVIDER_WAIT_UNKNOWN' as const : undefined, autoRetry };
}

function messageFilter(execution: { _id: unknown; workspaceId: unknown; retrySequence?: number }) {
  return { workspaceId: execution.workspaceId, ...(execution.retrySequence ? { apiCampaignRetryExecutionId: execution._id, apiCampaignRetrySequence: execution.retrySequence } : { apiCampaignExecutionId: execution._id }) };
}

async function exactAttemptMessage(execution: { _id: unknown; workspaceId: unknown; retrySequence?: number }) {
  // Older retry messages have no sequence. They cannot prove which attempt was
  // accepted, so never use them to authorize recovery or another send.
  const matches = await WhatsAppMessage.find({ ...messageFilter(execution), metaMessageId: { $exists: true } } as never).sort({ createdAt: -1 }).limit(2).lean();
  return matches.length === 1 ? matches[0] : null;
}

export async function processApiCampaignJob(job: Job<ApiCampaignJobData>) {
  const sequence = job.data.retrySequence ?? 0;
  const execution = await ApiCampaignExecution.findOneAndUpdate(
    { _id: job.data.executionId, status: 'QUEUED', retrySequence: sequence ? sequence : { $in: [0, null] }, submissionState: { $in: ['NOT_SUBMITTED', null] }, attempts: { $lt: MAX_ATTEMPTS }, $or: [{ nextEligibleRetryAt: { $exists: false } }, { nextEligibleRetryAt: { $lte: new Date() } }] },
    { $set: { status: 'SENDING', retrySequence: sequence, submissionState: 'NOT_SUBMITTED' }, $inc: { attempts: 1 } }, { new: true },
  );
  if (!execution) return;
  let submitted = false;
  try {
    const campaign = await ApiCampaign.findOne({ _id: execution.apiCampaignId, workspaceId: execution.workspaceId, status: 'LIVE' }).lean();
    if (!campaign) throw new AppError(409, 'CAMPAIGN_NOT_LIVE', 'Campaign is not live or unavailable.');
    if (!execution.senderAccountId || !execution.senderPhoneNumberId || !execution.senderTemplateId
      || String(execution.senderAccountId) !== String(campaign.whatsappAccountId)
      || execution.senderPhoneNumberId !== campaign.phoneNumberId
      || String(execution.senderTemplateId) !== String(campaign.templateId)) throw new AppError(409, 'SENDER_BINDING_CHANGED', 'Original sender or template binding changed.');
    await assertApiCampaignAssetsReady(campaign);
    const contact = execution.contactId ? await Contact.findOne({ _id: execution.contactId, workspaceId: execution.workspaceId }).lean() : null;
    const marketing = String((campaign.templateSnapshot as { category?: string })?.category ?? '').toUpperCase() === 'MARKETING';
    if (!contact || contact.status !== 'ACTIVE' || contact.phoneE164 !== execution.destination || contact.whatsappConsent?.status === 'OPTED_OUT' || (marketing && !hasSenderConsent(contact.whatsappConsent, campaign.whatsappAccountId))) throw new AppError(409, 'CONSENT_NOT_OPTED_IN', 'Recipient consent or contact eligibility changed.');
    const media = execution.media?.url ? { type: execution.media.type, source: 'LINK' as const, value: execution.media.url, ...(execution.media.filename ? { fileName: execution.media.filename } : {}) } : undefined;
    await ApiCampaignExecution.updateOne({ _id: execution._id, status: 'SENDING', retrySequence: sequence }, { $set: { submissionState: 'SUBMITTING' } });
    const sent = await sendApprovedTemplateMessage({ workspaceId: execution.workspaceId, whatsappAccountId: execution.senderAccountId, phoneNumberId: execution.senderPhoneNumberId, templateRecordId: execution.senderTemplateId, recipient: execution.destination, bodyVariables: execution.resolvedTemplateParams, sendSource: 'API_CAMPAIGN', ...(sequence ? { apiCampaignRetryExecutionId: execution._id, apiCampaignRetrySequence: sequence } : { apiCampaignExecutionId: execution._id }), onProviderSubmit: () => { submitted = true; }, ...(media ? { media } : {}) });
    await ApiCampaignExecution.updateOne({ _id: execution._id, status: 'SENDING', retrySequence: sequence }, {
      $set: { status: 'ACCEPTED', submissionState: 'ACCEPTED', whatsappMessageId: sent.recordId, metaMessageId: sent.messageId, acceptedAt: sent.acceptedAt, retrySafety: 'UNCERTAIN' },
      $push: { attemptHistory: { $each: [{ attempt: execution.attempts, at: sent.acceptedAt, status: 'ACCEPTED', messageId: sent.messageId }], $slice: -20 } },
      $unset: { failureCode: '', failureSubcode: '', failureTitle: '', failureMessage: '', failureCategory: '', failureSource: '', nextEligibleRetryAt: '', retryRestriction: '' },
    });
  } catch (error) {
    const known = submitted ? await exactAttemptMessage(execution) : null;
    if (known) {
      await ApiCampaignExecution.updateOne({ _id: execution._id, status: 'SENDING', retrySequence: sequence }, { $set: { status: known.status, submissionState: 'ACCEPTED', whatsappMessageId: known._id, metaMessageId: known.metaMessageId, acceptedAt: known.acceptedAt, retrySafety: 'UNCERTAIN' } });
      return;
    }
    const failure = safeApiCampaignFailure(error);
    const classification = classifyApiCampaignFailure(error, submitted, execution.attempts);
    const { autoRetry, ...diagnostic } = classification;
    const retrySequence = autoRetry ? sequence + 1 : sequence;
    const status = autoRetry ? 'QUEUED' : 'FAILED';
    const update = await ApiCampaignExecution.findOneAndUpdate({ _id: execution._id, status: 'SENDING', retrySequence: sequence }, {
      $set: { status, submissionState: diagnostic.retrySafety === 'UNCERTAIN' ? 'UNCERTAIN' : 'NOT_SUBMITTED', ...failure, ...diagnostic, retryExhausted: !autoRetry, failedAt: new Date(), ...(autoRetry ? { retryMode: 'AUTO', retrySequence, queuedAt: new Date(), queueJobId: apiCampaignJobId(String(execution._id), retrySequence) } : {}) },
      $unset: { failureSource: '' },
      $push: { attemptHistory: { $each: [{ attempt: execution.attempts, at: new Date(), status: 'FAILED', ...failure, retrySafety: diagnostic.retrySafety }], $slice: -20 } },
    }, { new: true });
    if (autoRetry && update && diagnostic.nextEligibleRetryAt) {
      try { await enqueueApiCampaignExecution({ executionId: String(execution._id), retrySequence }, Math.max(0, diagnostic.nextEligibleRetryAt.getTime() - Date.now())); } catch { /* durable QUEUED state is redispatched by reconciliation */ }
    }
  }
}

export async function reconcileApiCampaignExecutions() {
  const stale = await ApiCampaignExecution.find({ status: 'SENDING', updatedAt: { $lt: new Date(Date.now() - 300_000) } }).sort({ updatedAt: 1 }).limit(100).lean();
  for (const row of stale) {
    const message = await exactAttemptMessage(row);
    if (message) await ApiCampaignExecution.updateOne({ _id: row._id, status: 'SENDING', retrySequence: row.retrySequence }, { $set: { status: message.status, submissionState: 'ACCEPTED', whatsappMessageId: message._id, metaMessageId: message.metaMessageId, retrySafety: 'UNCERTAIN' } });
    else await ApiCampaignExecution.updateOne({ _id: row._id, status: 'SENDING', retrySequence: row.retrySequence }, { $set: { status: 'FAILED', submissionState: 'UNCERTAIN', failureCode: 'AMBIGUOUS_WORKER_EXIT', failureTitle: 'Delivery state is uncertain', failureMessage: 'The provider submission state could not be confirmed.', failureCategory: 'QUEUE_SYSTEM', retrySafety: 'UNCERTAIN', retryExhausted: true, failedAt: new Date() } });
  }
  const queued = await ApiCampaignExecution.find({ status: 'QUEUED', retrySequence: { $gt: 0 }, $or: [{ nextEligibleRetryAt: { $exists: false } }, { nextEligibleRetryAt: { $lte: new Date() } }] }).limit(100).lean();
  for (const row of queued) await enqueueApiCampaignExecution({ executionId: String(row._id), retrySequence: row.retrySequence ?? 0 }).catch(() => undefined);
  return stale.length;
}
