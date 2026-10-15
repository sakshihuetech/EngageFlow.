import { createHash } from 'node:crypto';
import mongoose, { type Types } from 'mongoose';
import { Campaign } from '../../models/campaign.model.js';
import { CampaignRecipient } from '../../models/campaign-recipient.model.js';
import { Contact } from '../../models/contact.model.js';
import { WhatsAppAccount } from '../../models/whatsapp-account.model.js';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';
import { hasSenderConsent } from '../whatsapp/consent-scope.service.js';
import { createContactRecipient } from './audience.service.js';
import { validateParameterMapping } from './parameter-mapping.service.js';
import { normalizeWhatsAppPhone } from './phone.js';
import { maskPhone } from './safety.js';

export const retargetFilters = ['READ', 'DELIVERED_NOT_READ', 'FAILED'] as const;
export type RetargetFilter = typeof retargetFilters[number];
const MAX_SOURCE_RECIPIENTS = 50_000;
const PAGE_SIZE = 250;

type SourceRecipient = {
  _id: Types.ObjectId; contactId?: Types.ObjectId; recipientPhone: string; status: string;
  readAt?: Date | null; deliveredAt?: Date | null; failedAt?: Date | null; failureSource?: string | null;
  submissionState?: string | null; retrySafety?: string | null;
};
type RetargetContact = {
  _id: Types.ObjectId; status: string; phoneE164: string; name: string; optedOutAt?: Date;
  email?: string; tags?: string[]; attributes?: Record<string, unknown>;
  whatsappConsent?: { status: string; accountId?: Types.ObjectId; source?: string; evidence?: string };
};
type SourceCampaign = NonNullable<Awaited<ReturnType<typeof loadSourceCampaign>>>;
type Selection = { source: SourceRecipient; contact: RetargetContact; sourceStatus: 'READ' | 'DELIVERED' | 'FAILED' };

export function retargetOutcome(row: Pick<SourceRecipient, 'status' | 'readAt' | 'deliveredAt' | 'failedAt' | 'failureSource' | 'submissionState' | 'retrySafety'>): 'READ' | 'DELIVERED' | 'FAILED' | 'UNVERIFIED' {
  if (row.status === 'READ' || row.readAt) return 'READ';
  if (row.status === 'DELIVERED' || row.deliveredAt) return 'DELIVERED';
  if (row.status === 'FAILED' && row.failedAt && row.submissionState !== 'UNCERTAIN' && row.retrySafety !== 'UNCERTAIN'
    && ['META_API', 'META_WEBHOOK'].includes(row.failureSource ?? '')) return 'FAILED';
  return 'UNVERIFIED';
}

export function retargetExclusion(row: SourceRecipient, contact: RetargetContact | undefined, filter: RetargetFilter, accountId: unknown, seen: Set<string>): string | null {
  const outcome = retargetOutcome(row);
  if ((filter === 'DELIVERED_NOT_READ' ? outcome !== 'DELIVERED' : outcome !== filter)) return outcome === 'UNVERIFIED' ? 'UNVERIFIED_OUTCOME' : 'OTHER_STATUS';
  if (!row.contactId || !contact) return 'CONTACT_MISSING';
  if (contact.status !== 'ACTIVE') return 'CONTACT_INACTIVE';
  if (contact.optedOutAt || !hasSenderConsent(contact.whatsappConsent, accountId)) return 'CONSENT_UNAVAILABLE';
  let phone: string;
  try { phone = normalizeWhatsAppPhone(row.recipientPhone); }
  catch { return 'INVALID_PHONE'; }
  if (contact.phoneE164 !== phone) return 'PHONE_CHANGED';
  if (seen.has(phone)) return 'DUPLICATE';
  seen.add(phone);
  return null;
}

export async function recheckRetargetSource(workspaceId: string, sourceCampaignId: unknown, sourceRecipientId: unknown, filter: unknown) {
  if (!sourceCampaignId || !sourceRecipientId || !retargetFilters.includes(filter as RetargetFilter)) return false;
  const source = await CampaignRecipient.findOne({ _id: sourceRecipientId, workspaceId, campaignId: sourceCampaignId })
    .select('status readAt deliveredAt failedAt failureSource submissionState retrySafety').lean();
  const expected = filter === 'DELIVERED_NOT_READ' ? 'DELIVERED' : filter;
  return Boolean(source && retargetOutcome(source) === expected);
}

export async function retargetSenderStillBound(workspaceId: string, accountId: unknown, wabaId: unknown) {
  if (!accountId || typeof wabaId !== 'string' || !wabaId) return false;
  return Boolean(await WhatsAppAccount.exists({ _id: accountId, workspaceId, status: 'CONNECTED', wabaId }));
}

function parseFilter(value: unknown): RetargetFilter {
  if (typeof value === 'string' && retargetFilters.includes(value as RetargetFilter)) return value as RetargetFilter;
  throw new AppError(400, 'INVALID_RETARGET_FILTER', 'Select Read, Delivered but not Read, or Failed.');
}

async function loadSourceCampaign(workspaceId: string, sourceCampaignId: string) {
  if (!mongoose.isValidObjectId(sourceCampaignId)) throw new AppError(400, 'INVALID_ID', 'Source campaign is invalid.');
  const campaign = await Campaign.findOne({ _id: sourceCampaignId, workspaceId, type: 'BROADCAST' }).lean();
  if (!campaign) throw new AppError(404, 'CAMPAIGN_NOT_FOUND', 'Source campaign was not found in this workspace.');
  if (!['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(campaign.status)) throw new AppError(409, 'SOURCE_NOT_COMPLETE', 'Retargeting requires a completed source campaign.');
  const account = await WhatsAppAccount.findOne({ _id: campaign.whatsappAccountId, workspaceId }).lean();
  if (!account) throw new AppError(409, 'SOURCE_ACCOUNT_UNAVAILABLE', 'The original WhatsApp account is unavailable.');
  return campaign;
}

async function scanSource(workspaceId: string, source: SourceCampaign, filter: RetargetFilter, cursor?: string, pageLimit = 25, collect = false) {
  if (cursor && !mongoose.isValidObjectId(cursor)) throw new AppError(400, 'INVALID_CURSOR', 'Preview cursor is invalid.');
  const seen = new Set<string>();
  const exclusions: Record<string, number> = {};
  const selected: Selection[] = [];
  const page: Array<{ sourceRecipientId: string; phone: string; outcome: string }> = [];
  let after: Types.ObjectId | undefined;
  let total = 0;
  let eligible = 0;
  let more = false;
  for (;;) {
    const rows = await CampaignRecipient.find({ workspaceId, campaignId: source._id, ...(after ? { _id: { $gt: after } } : {}) })
      .sort({ _id: 1 }).limit(PAGE_SIZE).lean() as SourceRecipient[];
    if (!rows.length) break;
    total += rows.length;
    if (total > MAX_SOURCE_RECIPIENTS) throw new AppError(413, 'RETARGET_SOURCE_TOO_LARGE', 'Source campaign exceeds the bounded retargeting limit.');
    const ids = rows.flatMap((row) => row.contactId ? [row.contactId] : []);
    const contacts = ids.length ? await Contact.find({ _id: { $in: ids }, workspaceId }).lean() as RetargetContact[] : [];
    const byId = new Map(contacts.map((contact) => [String(contact._id), contact]));
    for (const row of rows) {
      const contact = row.contactId ? byId.get(String(row.contactId)) : undefined;
      const reason = retargetExclusion(row, contact, filter, source.whatsappAccountId, seen);
      if (reason) { exclusions[reason] = (exclusions[reason] ?? 0) + 1; continue; }
      eligible++;
      const status = retargetOutcome(row) as Selection['sourceStatus'];
      if (collect) selected.push({ source: row, contact: contact!, sourceStatus: status });
      if (!cursor || String(row._id) > cursor) {
        if (page.length < pageLimit) page.push({ sourceRecipientId: String(row._id), phone: maskPhone(row.recipientPhone), outcome: status });
        else more = true;
      }
    }
    after = rows.at(-1)!._id;
    if (rows.length < PAGE_SIZE) break;
  }
  return { total, eligible, exclusions, items: page, nextCursor: more ? page.at(-1)?.sourceRecipientId ?? null : null, selected };
}

export async function retargetPreview(input: { workspaceId: string; sourceCampaignId: string; filter: unknown; cursor?: string; limit?: number }) {
  const filter = parseFilter(input.filter);
  const source = await loadSourceCampaign(input.workspaceId, input.sourceCampaignId);
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const result = await scanSource(input.workspaceId, source, filter, input.cursor, limit);
  return { source: { id: String(source._id), name: source.name, status: source.status, whatsappAccountId: String(source.whatsappAccountId), templateName: (source.templateSnapshot as { name?: string } | undefined)?.name }, filter, total: result.total, eligible: result.eligible, exclusions: result.exclusions, items: result.items, nextCursor: result.nextCursor };
}

export async function retargetTemplates(workspaceId: string, sourceCampaignId: string) {
  const source = await loadSourceCampaign(workspaceId, sourceCampaignId);
  const templates = await WhatsAppTemplate.find({ workspaceId, whatsappAccountId: source.whatsappAccountId, status: 'APPROVED', isActive: true })
    .sort({ name: 1, _id: 1 }).limit(100).lean();
  return templates.flatMap((template) => {
    try {
      validateParameterMapping(template.components, source.parameterMapping, source.mediaMapping);
      return [{ id: String(template._id), name: template.name, language: template.language }];
    } catch { return []; }
  });
}

export async function createRetargetDraft(input: { workspaceId: string; sourceCampaignId: string; filter: unknown; templateId: unknown; name: unknown; idempotencyKey: unknown }) {
  const filter = parseFilter(input.filter);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name || name.length > 160) throw new AppError(400, 'INVALID_NAME', 'A follow-up campaign name between 1 and 160 characters is required.');
  const key = typeof input.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(key)) throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key is required.');
  if (typeof input.templateId !== 'string' || !mongoose.isValidObjectId(input.templateId)) throw new AppError(400, 'INVALID_TEMPLATE', 'Select an approved template.');
  const source = await loadSourceCampaign(input.workspaceId, input.sourceCampaignId);
  const sourceAccount = await WhatsAppAccount.findOne({ _id: source.whatsappAccountId, workspaceId: input.workspaceId }).lean();
  if (!sourceAccount?.wabaId) throw new AppError(409, 'SOURCE_ACCOUNT_UNAVAILABLE', 'The original WhatsApp account binding is unavailable.');
  const template = await WhatsAppTemplate.findOne({ _id: input.templateId, workspaceId: input.workspaceId, whatsappAccountId: source.whatsappAccountId, status: 'APPROVED', isActive: true }).lean();
  if (!template) throw new AppError(409, 'TEMPLATE_UNAVAILABLE', 'The selected template is not approved on the original WhatsApp account.');
  const { mapping } = validateParameterMapping(template.components, source.parameterMapping, source.mediaMapping);
  const fingerprint = createHash('sha256').update(JSON.stringify([input.workspaceId, input.sourceCampaignId, filter, String(template._id), name])).digest('hex');
  const existing = await Campaign.findOne({ workspaceId: input.workspaceId, idempotencyKey: key }).select('+creationFingerprint');
  if (existing) {
    if (existing.creationFingerprint !== fingerprint || String(existing.sourceCampaignId) !== String(source._id)) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key belongs to another campaign request.');
    return { campaignId: String(existing._id), idempotent: true, snapshotCount: existing.audienceSnapshotCount ?? 0 };
  }
  const selection = await scanSource(input.workspaceId, source, filter, undefined, 1, true);
  if (!selection.eligible) throw new AppError(409, 'RETARGET_AUDIENCE_EMPTY', 'No eligible opted-in contacts remain.');
  const snapshotAt = new Date();
  const session = await mongoose.startSession();
  try {
    let createdId = '';
    await session.withTransaction(async () => {
      const [campaign] = await Campaign.create([{ workspaceId: input.workspaceId, whatsappAccountId: source.whatsappAccountId, phoneNumberId: source.phoneNumberId,
        name, status: 'DRAFT', channel: 'WHATSAPP', type: 'BROADCAST', whatsAppTemplateId: template._id,
        templateSnapshot: { metaTemplateId: template.metaTemplateId, name: template.name, language: template.language, category: template.category, status: template.status, components: template.components ?? [], capturedAt: snapshotAt },
        parameterMapping: source.parameterMapping ?? {}, mediaMapping: source.mediaMapping ?? {},
        audienceDefinition: { source: 'RETARGET', sourceCampaignId: String(source._id) }, audienceSnapshotCount: selection.eligible,
        sourceCampaignId: source._id, retargetingFilter: filter, retargetingSourceAccountId: source.whatsappAccountId, retargetingSourceWabaId: sourceAccount.wabaId, snapshotAt,
        idempotencyKey: key, creationFingerprint: fingerprint, sendMode: 'DRAFT', timezone: source.timezone ?? 'UTC', createdBy: 'DEVELOPMENT_UI' }], { session });
      createdId = String(campaign!._id);
      let pending = 0; let skipped = 0;
      for (let offset = 0; offset < selection.selected.length; offset += PAGE_SIZE) {
        const batch = selection.selected.slice(offset, offset + PAGE_SIZE).map(({ source: recipient, contact, sourceStatus }) => {
          const snapshot = createContactRecipient({ _id: campaign!._id, workspaceId: input.workspaceId, whatsappAccountId: source.whatsappAccountId,
            parameterMapping: source.parameterMapping as Record<string, unknown>, mediaMapping: source.mediaMapping as Record<string, unknown>, templateSnapshot: { components: template.components } }, contact, mapping);
          if (snapshot.status === 'PENDING') pending++; else skipped++;
          return { ...snapshot, sourceRecipientId: recipient._id, sourceStatus };
        });
        await CampaignRecipient.insertMany(batch, { session, ordered: true });
      }
      await Campaign.updateOne({ _id: campaign!._id, workspaceId: input.workspaceId }, { $set: { audienceSnapshotCount: pending + skipped, 'counters.total': pending + skipped, 'counters.pending': pending, 'counters.skipped': skipped } }, { session });
    });
    return { campaignId: createdId, idempotent: false, snapshotCount: selection.eligible };
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const recovered = await Campaign.findOne({ workspaceId: input.workspaceId, idempotencyKey: key }).select('+creationFingerprint');
    if (!recovered || recovered.creationFingerprint !== fingerprint || String(recovered.sourceCampaignId) !== String(source._id)) throw new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency-Key belongs to another campaign request.');
    return { campaignId: String(recovered._id), idempotent: true, snapshotCount: recovered.audienceSnapshotCount ?? 0 };
  } finally { await session.endSession(); }
}
