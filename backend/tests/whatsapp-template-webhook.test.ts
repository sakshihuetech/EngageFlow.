import { afterEach, describe, expect, it, vi } from 'vitest';
import { webhookTestables } from '../src/controllers/whatsapp-webhook.controller.js';
import { WhatsAppAccount } from '../src/models/whatsapp-account.model.js';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';

const workspaceId = '64b000000000000000000001', accountId = '64b000000000000000000002';
afterEach(() => vi.restoreAllMocks());
describe('signed template-status webhook processor', () => {
  it('refuses ambiguous WABA ownership', async () => {
    vi.spyOn(WhatsAppAccount, 'find').mockReturnValue({ limit: () => ({ lean: async () => [{ _id: accountId }, { _id: 'other' }] }) } as never);
    const find = vi.spyOn(WhatsAppTemplate, 'findOne');
    expect(await webhookTestables.updateTemplateStatus('12345', { message_template_id: '67890', event: 'APPROVED' })).toBe('unmatched');
    expect(find).not.toHaveBeenCalled();
  });
  it('updates a scoped record and persists a rejection reason', async () => {
    vi.spyOn(WhatsAppAccount, 'find').mockReturnValue({ limit: () => ({ lean: async () => [{ _id: accountId, workspaceId }] }) } as never);
    const find = vi.spyOn(WhatsAppTemplate, 'findOne').mockReturnValue({ lean: async () => ({ status: 'PENDING', lastSyncedAt: new Date('2026-01-01'), rejectionReason: undefined }) } as never);
    const update = vi.spyOn(WhatsAppTemplate, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    expect(await webhookTestables.updateTemplateStatus('12345', { message_template_id: '67890', event: 'REJECTED', reason: 'Policy issue', timestamp: 1790000000 })).toBe('updated');
    expect(find).toHaveBeenCalledWith({ workspaceId, whatsappAccountId: accountId, metaTemplateId: '67890', isActive: true });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, whatsappAccountId: accountId, metaTemplateId: '67890' }), expect.objectContaining({ $set: expect.objectContaining({ status: 'REJECTED', rejectionReason: 'Policy issue' }) }));
  });
  it('does not rewrite duplicate or stale events', async () => {
    vi.spyOn(WhatsAppAccount, 'find').mockReturnValue({ limit: () => ({ lean: async () => [{ _id: accountId, workspaceId }] }) } as never);
    vi.spyOn(WhatsAppTemplate, 'findOne').mockReturnValue({ lean: async () => ({ status: 'APPROVED', lastSyncedAt: new Date('2026-10-01'), rejectionReason: undefined }) } as never);
    const update = vi.spyOn(WhatsAppTemplate, 'updateOne');
    expect(await webhookTestables.updateTemplateStatus('12345', { message_template_id: '67890', event: 'APPROVED' })).toBe('duplicate');
    expect(await webhookTestables.updateTemplateStatus('12345', { message_template_id: '67890', event: 'REJECTED', timestamp: 1700000000 })).toBe('outOfOrder');
    expect(update).not.toHaveBeenCalled();
  });
});
