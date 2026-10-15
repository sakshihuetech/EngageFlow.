import type { Types } from 'mongoose';
import { WhatsAppMessage } from '../../models/whatsapp-message.model.js';
import { apiCampaignProviderFailure } from './tracking.service.js';

type ExecutionRow = {
  status: string;
  failureCode?: string | null;
  failureTitle?: string | null;
  failureMessage?: string | null;
  whatsappMessageId?: Types.ObjectId | null;
  metaMessageId?: string | null;
};

// Read-only compatibility for executions that failed before webhook failure fields were copied.
export async function withStoredProviderFailures<T extends ExecutionRow>(rows: T[], workspaceId: string): Promise<T[]> {
  const missing = rows.filter((row) => row.status === 'FAILED'
    && !row.failureCode && !row.failureTitle && !row.failureMessage
    && (row.whatsappMessageId || row.metaMessageId));
  if (!missing.length) return rows;
  const ids = missing.flatMap((row) => row.whatsappMessageId ? [row.whatsappMessageId] : []);
  const metaIds = missing.flatMap((row) => row.metaMessageId ? [row.metaMessageId] : []);
  const messages = await WhatsAppMessage.find({
    workspaceId,
    status: 'FAILED',
    $or: [
      ...(ids.length ? [{ _id: { $in: ids } }] : []),
      ...(metaIds.length ? [{ metaMessageId: { $in: metaIds } }] : []),
    ],
  }).select('_id metaMessageId failureCode failureTitle failureMessage').lean();
  const byId = new Map(messages.map((message) => [String(message._id), message]));
  const byMetaId = new Map(messages.flatMap((message) => message.metaMessageId ? [[message.metaMessageId, message] as const] : []));
  return rows.map((row) => {
    if (!missing.includes(row)) return row;
    const message = row.whatsappMessageId ? byId.get(String(row.whatsappMessageId)) : undefined;
    const related = message ?? (row.metaMessageId ? byMetaId.get(row.metaMessageId) : undefined);
    return related ? { ...row, ...apiCampaignProviderFailure(related) } : row;
  });
}
