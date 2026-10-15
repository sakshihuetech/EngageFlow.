import { afterEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppTemplate } from '../src/models/whatsapp-template.model.js';
import { createWorkspaceTemplate, deleteWorkspaceTemplate, editWorkspaceTemplate, listMetaLibrary, useMetaLibraryTemplate } from '../src/services/whatsapp/template-authoring.service.js';
import { resolveConnectedWhatsApp } from '../src/services/whatsapp/connection-context.service.js';
import { createMessageTemplate, deleteMessageTemplate, fetchMessageTemplateLibrary, MetaGraphError } from '../src/services/whatsapp/meta-graph.service.js';
import { templateLibraryProviderError } from '../src/controllers/whatsapp.controller.js';

vi.mock('../src/services/whatsapp/connection-context.service.js', () => ({ resolveConnectedWhatsApp: vi.fn() }));
vi.mock('../src/services/whatsapp/meta-graph.service.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/whatsapp/meta-graph.service.js')>();
  return { ...original, createMessageTemplate: vi.fn(), deleteMessageTemplate: vi.fn(), fetchMessageTemplateLibrary: vi.fn() };
});
const W1 = '64b000000000000000000001', A1 = '64b000000000000000000002', T1 = '64b000000000000000000003';
const input = { name: 'order_update', language: 'en_US', category: 'UTILITY', body: 'Hello customer.' };
afterEach(() => vi.restoreAllMocks());
function context() { vi.mocked(resolveConnectedWhatsApp).mockResolvedValue({ account: { _id: A1, wabaId: '12345' }, accessToken: 'private-token' } as never); }
function saved(status = 'PENDING') { return { toObject: () => ({ _id: T1, metaTemplateId: '67890', name: input.name, language: input.language, category: input.category, status, components: [{ type: 'BODY', text: input.body }], source: 'CUSTOM', lastSyncedAt: new Date() }) }; }

describe('template provider-backed flows', () => {
  it('creates only after Meta returns a real ID and status, scoped to workspace/account', async () => {
    context(); vi.mocked(createMessageTemplate).mockResolvedValue({ id: '67890', status: 'PENDING' });
    const upsert = vi.spyOn(WhatsAppTemplate, 'findOneAndUpdate').mockResolvedValue(saved() as never);
    expect((await createWorkspaceTemplate(W1, input)).status).toBe('PENDING');
    expect(upsert).toHaveBeenCalledWith({ workspaceId: W1, whatsappAccountId: A1, metaTemplateId: '67890' }, expect.anything(), expect.objectContaining({ upsert: true }));
  });
  it('rejects missing provider status without writing local approval', async () => {
    context(); vi.mocked(createMessageTemplate).mockResolvedValue({ id: '67890' });
    const upsert = vi.spyOn(WhatsAppTemplate, 'findOneAndUpdate');
    await expect(createWorkspaceTemplate(W1, input)).rejects.toThrow('Meta did not return');
    expect(upsert).not.toHaveBeenCalled();
  });
  it('blocks editing a pending or library template before a provider mutation', async () => {
    context();
    vi.spyOn(WhatsAppTemplate, 'findOne').mockResolvedValue({ _id: T1, source: 'META_LIBRARY', status: 'APPROVED' } as never);
    await expect(editWorkspaceTemplate(W1, T1, input)).rejects.toThrow('cannot be edited');
  });
  it('calls Meta before deactivating a template', async () => {
    context();
    vi.spyOn(WhatsAppTemplate, 'findOne').mockResolvedValue({ _id: T1, metaTemplateId: '67890', name: input.name, isActive: true } as never);
    vi.mocked(deleteMessageTemplate).mockResolvedValue({ success: true });
    const update = vi.spyOn(WhatsAppTemplate, 'updateOne').mockResolvedValue({ modifiedCount: 1 } as never);
    await deleteWorkspaceTemplate(W1, T1);
    expect(deleteMessageTemplate).toHaveBeenCalledWith('12345', 'private-token', '67890', input.name);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: W1, whatsappAccountId: A1, isActive: true }), expect.objectContaining({ $set: expect.objectContaining({ isActive: false, deleteSource: 'USER' }) }));
  });
  it('reads bounded live library pages and refetches selection before creating', async () => {
    context();
    vi.mocked(fetchMessageTemplateLibrary).mockResolvedValue({ data: [{ name: 'welcome', language: 'en_US', category: 'UTILITY', body: 'Welcome' }], paging: { cursors: { after: 'next' }, next: 'provider-url' } });
    expect((await listMetaLibrary(W1, { language: 'en_US', limit: 20 })).paging.hasNext).toBe(true);
    vi.mocked(createMessageTemplate).mockResolvedValue({ id: '67890', status: 'PENDING' });
    vi.spyOn(WhatsAppTemplate, 'findOneAndUpdate').mockResolvedValue(saved() as never);
    await useMetaLibraryTemplate(W1, { libraryTemplateName: 'welcome', language: 'en_US', name: 'welcome_copy' });
    expect(fetchMessageTemplateLibrary).toHaveBeenCalledWith('private-token', expect.objectContaining({ search: 'welcome', language: 'en_US' }));
    expect(createMessageTemplate).toHaveBeenCalledWith('12345', 'private-token', expect.objectContaining({ library_template_name: 'welcome', name: 'welcome_copy' }));
  });
  it('does not persist a library template after Meta rejects its creation', async () => {
    context();
    vi.mocked(fetchMessageTemplateLibrary).mockResolvedValue({ data: [{ name: 'verify_account_2', language: 'en_US', category: 'AUTHENTICATION', body: 'Preview only' }] });
    vi.mocked(createMessageTemplate).mockRejectedValue(new MetaGraphError('Rejected', 400, '100', { code: 100, errorSubcode: 2388026 }));
    const upsert = vi.spyOn(WhatsAppTemplate, 'findOneAndUpdate');
    await expect(useMetaLibraryTemplate(W1, { libraryTemplateName: 'verify_account_2', language: 'en_US', name: 'verify_account_2_copy' })).rejects.toBeInstanceOf(MetaGraphError);
    expect(createMessageTemplate).toHaveBeenCalledWith('12345', 'private-token', {
      name: 'verify_account_2_copy', language: 'en_US', category: 'AUTHENTICATION', library_template_name: 'verify_account_2',
    });
    expect(upsert).not.toHaveBeenCalled();
  });
  it('exposes only sanitized Meta diagnostics for a provider 4xx', () => {
    const error = templateLibraryProviderError(new MetaGraphError('raw token', 400, '100', {
      code: 100, errorSubcode: 2388026, userTitle: 'Invalid template',
      userMessage: 'Bearer secret-token contact +15551234567 at https://example.com/customer', traceId: 'ABC123',
    }));
    expect(error.provider).toMatchObject({ httpStatus: 400, metaCode: 100, metaSubcode: 2388026, title: 'Invalid template', traceId: 'ABC123' });
    expect(JSON.stringify(error.provider)).not.toMatch(/secret-token|15551234567|example\.com|raw token/);
    const missing = templateLibraryProviderError(new MetaGraphError('raw secret', 400, 'META_GRAPH_ERROR'));
    expect(missing.provider).toEqual({ httpStatus: 400, message: expect.stringContaining('Meta could not complete') });
  });
});
