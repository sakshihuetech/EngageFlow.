import type { Types } from 'mongoose';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';
import { fetchMessageTemplates } from './meta-graph.service.js';

export interface ClientTemplate {
  id: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: unknown[];
  source: string;
  rejectionReason?: string;
  lastSyncedAt: Date;
  updatedAt?: Date;
}

export function toClientTemplate(template: Record<string, unknown> & { _id: unknown }) : ClientTemplate {
  return {
    id: String(template._id),
    metaTemplateId: String(template.metaTemplateId),
    name: String(template.name),
    language: String(template.language),
    category: String(template.category),
    status: String(template.status),
    components: Array.isArray(template.components) ? template.components : [],
    source: typeof template.source === 'string' ? template.source : 'CUSTOM',
    ...(typeof template.rejectionReason === 'string' ? { rejectionReason: template.rejectionReason } : {}),
    lastSyncedAt: template.lastSyncedAt as Date,
    ...(template.updatedAt instanceof Date ? { updatedAt: template.updatedAt } : {}),
  };
}

export async function listWorkspaceTemplates(workspaceId: Types.ObjectId | string, input: { status?: string; search?: string } = {}) {
  const { account } = await resolveConnectedWhatsApp(workspaceId);
  const filter: Record<string, unknown> = { workspaceId, whatsappAccountId: account._id, isActive: true };
  if (input.status && input.status !== 'ALL') filter.status = input.status;
  if (input.search) filter.name = { $regex: input.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const templates = await WhatsAppTemplate.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(500).lean();
  return templates.map((template) => toClientTemplate(template as unknown as Record<string, unknown> & { _id: unknown }));
}

function cleanMetaTemplate(value: Record<string, unknown>) {
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const language = typeof value.language === 'string' ? value.language.trim() : '';
  const category = typeof value.category === 'string' ? value.category.toUpperCase() : '';
  const status = typeof value.status === 'string' ? value.status.toUpperCase() : '';
  if (!id || !name || !language || !['MARKETING', 'UTILITY', 'AUTHENTICATION'].includes(category) || !status) return null;
  return { id, name, language, category, status, components: Array.isArray(value.components) ? value.components : [], rejectionReason: typeof value.rejected_reason === 'string' ? value.rejected_reason.slice(0, 1_000) : undefined };
}

export async function syncWorkspaceTemplates(
  workspaceId: Types.ObjectId | string,
  dependency: typeof fetchMessageTemplates = fetchMessageTemplates,
) {
  const { account, accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'The Meta credential is unavailable.');
  const raw = await dependency(account.wabaId, accessToken);
  const cleaned = raw.map(cleanMetaTemplate).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const templates = [...new Map(cleaned.map((template) => [template.id, template])).values()];
  const syncedAt = new Date();
  const existing = await WhatsAppTemplate.find({ workspaceId, whatsappAccountId: account._id, metaTemplateId: { $in: templates.map((item) => item.id) } }).select('metaTemplateId components').lean();
  const existingById = new Map(existing.map((item) => [item.metaTemplateId, item.components]));
  const preserveMediaExample = (incoming: unknown[], previous: unknown[] | undefined) => {
    const current = incoming.map((item) => item && typeof item === 'object' ? { ...item as Record<string, unknown> } : item);
    const header = current.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'HEADER') as Record<string, unknown> | undefined;
    const old = previous?.find((item) => item && typeof item === 'object' && (item as Record<string, unknown>).type === 'HEADER') as Record<string, unknown> | undefined;
    const oldExample = old?.example as { header_handle?: string[] } | undefined;
    const newExample = header?.example as { header_handle?: string[] } | undefined;
    if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format)) && old?.format === header.format && !newExample?.header_handle?.[0] && oldExample?.header_handle?.[0]) header.example = { ...newExample, header_handle: [oldExample.header_handle[0]] };
    return current;
  };
  if (templates.length) {
    await WhatsAppTemplate.bulkWrite(templates.map((template) => ({ updateOne: {
      filter: { workspaceId, whatsappAccountId: account._id, metaTemplateId: template.id },
      update: {
          $set: { name: template.name, language: template.language, category: template.category, status: template.status, components: preserveMediaExample(template.components, existingById.get(template.id)), ...(template.rejectionReason ? { rejectionReason: template.rejectionReason } : {}), isActive: true, lastSyncedAt: syncedAt },
          $unset: { deletedAt: '', deleteSource: '', ...(!template.rejectionReason ? { rejectionReason: '' } : {}) },
        $setOnInsert: { workspaceId, whatsappAccountId: account._id, metaTemplateId: template.id },
      },
      upsert: true,
    } })) as never, { ordered: false });
  }
  await WhatsAppTemplate.updateMany({ workspaceId, whatsappAccountId: account._id, ...(templates.length ? { metaTemplateId: { $nin: templates.map((item) => item.id) } } : {}) }, { $set: { isActive: false, lastSyncedAt: syncedAt } });
  return listWorkspaceTemplates(workspaceId);
}

export function approvedTemplateOptions(templates: ClientTemplate[]) {
  return templates.filter((template) => template.status === 'APPROVED');
}

export function validateTemplateStatus(status: unknown) {
  const value = typeof status === 'string' ? status.toUpperCase() : 'ALL';
  if (!['ALL', 'APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'].includes(value)) throw new AppError(400, 'INVALID_TEMPLATE_STATUS', 'Invalid template status filter.');
  return value;
}
