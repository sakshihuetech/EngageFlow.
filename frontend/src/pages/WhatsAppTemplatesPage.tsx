import { Eye, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { ModalShell } from '../components/ui/ModalShell';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/StatusBadge';
import { TemplatePreview } from '../features/whatsapp/components/TemplatePreview';
import { TemplateEditor } from '../features/whatsapp/components/TemplateEditor';
import { whatsAppApi } from '../features/whatsapp/api';
import { templateParts } from '../features/whatsapp/template-utils';
import type { WhatsAppTemplate } from '../features/whatsapp/types';

const filters = ['ALL', 'APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DISABLED'];

export function WhatsAppTemplatesPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WhatsAppTemplate[]>([]);
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<WhatsAppTemplate>();
  const [editing, setEditing] = useState<WhatsAppTemplate | null>();
  const [deleting, setDeleting] = useState<WhatsAppTemplate>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setItems((await whatsAppApi.templates({ status, search })).items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Templates could not be loaded.'); }
    finally { setLoading(false); }
  }, [search, status]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load]);
  const sync = async () => {
    setSyncing(true); setError(''); setNotice('');
    try { const result = await whatsAppApi.syncTemplates(); setNotice(`${result.synced} active template${result.synced === 1 ? '' : 's'} synchronized from Meta.`); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Templates could not be synchronized.'); }
    finally { setSyncing(false); }
  };
  const remove = async () => {
    if (!deleting) return;
    setDeleteBusy(true); setError('');
    try { await whatsAppApi.deleteTemplate(deleting.id); setDeleting(undefined); setNotice('Template deleted in Meta and deactivated locally.'); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Template could not be deleted.'); }
    finally { setDeleteBusy(false); }
  };
  return <div className="space-y-6">
    <PageHeader title="WhatsApp Templates" description="Create, review, and synchronize templates for your connected WhatsApp account." action={<div className="flex flex-wrap gap-2"><Button onClick={() => setEditing(null)}>Create Template</Button><Button variant="secondary" onClick={() => navigate('/whatsapp/templates/library')}>Browse Meta Library</Button><Button variant="secondary" disabled={syncing} onClick={() => void sync()}><RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />{syncing ? 'Syncing…' : 'Sync from Meta'}</Button></div>} />
    {notice ? <div className="rounded-xl border border-primary-border bg-primary-soft px-4 py-3 text-sm text-success-strong">{notice}</div> : null}
    {error ? <Card><ErrorState message={error} onRetry={() => void load()} /></Card> : null}
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search templates" /></div><Select className="sm:w-44" value={status} onChange={(event) => setStatus(event.target.value)}>{filters.map((value) => <option key={value} value={value}>{value === 'ALL' ? 'All statuses' : value.charAt(0) + value.slice(1).toLowerCase()}</option>)}</Select></div>
      {loading ? <LoadingState label="Loading templates" /> : items.length === 0 ? <EmptyState title="No templates found" description="Synchronize from Meta or adjust the current filters." /> : <div className="overflow-x-auto"><table className="min-w-full text-left text-[13px]"><thead className="border-b border-border bg-background text-[10px] uppercase tracking-[0.1em] text-text-secondary"><tr><th className="px-5 py-3.5">Template</th><th className="px-5 py-3.5">Category</th><th className="px-5 py-3.5">Language</th><th className="px-5 py-3.5">Header</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5">Last synced</th><th className="px-5 py-3.5 text-right">Actions</th></tr></thead><tbody>{items.map((template) => { const parts = templateParts(template); return <tr key={template.id} className="border-b border-border/70 hover:bg-background/80"><td className="px-5 py-3.5"><p className="font-semibold text-text-primary">{template.name}</p></td><td className="px-5 py-3.5">{template.category}</td><td className="px-5 py-3.5">{template.language}</td><td className="px-5 py-3.5">{parts.headerType}</td><td className="px-5 py-3.5"><StatusBadge status={template.status as never} /></td><td className="whitespace-nowrap px-5 py-3.5 text-text-secondary">{new Date(template.lastSyncedAt).toLocaleString()}</td><td className="whitespace-nowrap px-5 py-3.5 text-right"><Button size="sm" variant="ghost" onClick={() => setSelected(template)}><Eye className="size-4" />View</Button>{template.source === 'CUSTOM' && ['APPROVED', 'REJECTED', 'PAUSED'].includes(template.status) ? <Button size="sm" variant="ghost" onClick={() => setEditing(template)}>Edit</Button> : null}<Button size="sm" variant="ghost" onClick={() => setDeleting(template)}>Delete</Button></td></tr>; })}</tbody></table></div>}
    </Card>
    <TemplateDetail template={selected} onClose={() => setSelected(undefined)} />
    {editing !== undefined ? <TemplateEditor key={editing?.id ?? 'create'} open template={editing ?? undefined} onClose={() => setEditing(undefined)} onSaved={() => void load()} /> : null}
    <ModalShell open={Boolean(deleting)} title="Delete template" onClose={() => setDeleting(undefined)}><p className="text-sm text-text-secondary">Delete {deleting?.name} from Meta? It will no longer be available for new sends. Existing history remains.</p><div className="mt-5 flex justify-end gap-2"><Button variant="secondary" onClick={() => setDeleting(undefined)}>Cancel</Button><Button variant="danger" disabled={deleteBusy} onClick={() => void remove()}>{deleteBusy ? 'Deleting…' : 'Delete template'}</Button></div></ModalShell>
  </div>;
}

function TemplateDetail({ template, onClose }: { template?: WhatsAppTemplate; onClose: () => void }) {
  const parts = useMemo(() => template ? templateParts(template) : null, [template]);
  return <ModalShell open={Boolean(template)} title="Template details" onClose={onClose}>{template && parts ? <div className="space-y-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{template.name}</h3><p className="mt-1 font-mono text-xs text-text-muted">{template.metaTemplateId}</p></div><StatusBadge status={template.status as never} /></div><dl className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-background p-4 text-sm"><Detail label="Category" value={template.category} /><Detail label="Language" value={template.language} /><Detail label="Header" value={parts.headerType} /><Detail label="Source" value={template.source} /><Detail label="Last synced" value={new Date(template.lastSyncedAt).toLocaleString()} /></dl>{template.rejectionReason ? <div className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger"><p className="font-semibold">Rejection reason</p><p className="mt-1">{template.rejectionReason}</p></div> : null}<TemplatePreview template={template} /></div> : null}</ModalShell>;
}
function Detail({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs text-text-muted">{label}</dt><dd className="mt-1 font-medium text-text-primary">{value}</dd></div>; }
