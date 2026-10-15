import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ModalShell } from '../../../components/ui/ModalShell';
import { Select } from '../../../components/ui/Select';
import { retargetingApi, type RetargetFilter, type RetargetPreview, type RetargetTemplate } from '../retargeting-api';

export function RetargetModal({ campaign, historyAccountId, onClose }: { campaign?: { id: string; name: string }; historyAccountId?: string; onClose: () => void }) {
  return campaign ? <RetargetDialog key={campaign.id} campaign={campaign} historyAccountId={historyAccountId} onClose={onClose} /> : null;
}

function RetargetDialog({ campaign, historyAccountId, onClose }: { campaign: { id: string; name: string }; historyAccountId?: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<RetargetFilter>('READ');
  const [preview, setPreview] = useState<RetargetPreview>();
  const [templates, setTemplates] = useState<RetargetTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [name, setName] = useState(`${campaign.name.slice(0, 141)} follow-up`);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const key = useRef<string>(crypto.randomUUID());

  useEffect(() => {
    let active = true;
    Promise.all([retargetingApi.preview(campaign.id, filter), retargetingApi.templates(campaign.id)])
      .then(([result, options]) => { if (active) { setPreview(result); setTemplates(options.items); setTemplateId(options.items[0]?.id ?? ''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Retargeting preview is unavailable.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [campaign.id, filter]);

  const loadMore = async () => {
    if (!campaign || !preview?.nextCursor || loading) return;
    setLoading(true); setError('');
    try {
      const next = await retargetingApi.preview(campaign.id, filter, preview.nextCursor);
      setPreview({ ...next, items: [...preview.items, ...next.items] });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More recipients could not be loaded.'); }
    finally { setLoading(false); }
  };

  const create = async () => {
    if (!campaign || !preview?.eligible || !templateId || !name.trim() || creating) return;
    setCreating(true); setError('');
    try {
      const result = await retargetingApi.create(campaign.id, { filter, templateId, name: name.trim() }, key.current);
      onClose(); navigate(`/whatsapp/broadcasts/${result.campaignId}${historyAccountId ? `?view=history&accountId=${encodeURIComponent(historyAccountId)}` : ''}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Follow-up draft could not be created.'); }
    finally { setCreating(false); }
  };

  return <ModalShell open={Boolean(campaign)} title="Retarget campaign" description="Create a follow-up draft from confirmed outcomes; no messages are sent at this step." size="wide" onClose={onClose}
    footer={<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button disabled={!preview?.eligible || !templateId || !name.trim() || creating || loading} onClick={() => void create()}>{creating ? 'Creating…' : 'Create follow-up draft'}</Button></div>}>
    <div className="space-y-4 text-sm">
      <p><span className="font-semibold">Source campaign:</span> {campaign?.name ?? '—'}</p>
      <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs text-warning">Development only. Retargeting access remains disabled until dashboard authentication and workspace authorization are installed. A public tunnel does not grant access.</p>
      <label className="block space-y-1"><span className="font-medium">Audience outcome</span><Select value={filter} onChange={(event) => { setPreview(undefined); setTemplates([]); setError(''); setLoading(true); setFilter(event.target.value as RetargetFilter); key.current = crypto.randomUUID(); }}><option value="READ">Read</option><option value="DELIVERED_NOT_READ">Delivered, not read</option><option value="FAILED">Confirmed failed</option><option disabled value="REPLIED">Replied — attribution not verified</option></Select></label>
      {loading && !preview ? <p role="status" className="text-text-secondary">Checking audience…</p> : null}
      {error ? <p role="alert" className="rounded-lg bg-danger-soft p-3 text-danger">{error}</p> : null}
      {preview ? <><p className="font-medium">{preview.eligible.toLocaleString()} eligible of {preview.total.toLocaleString()} source recipients</p>
        {Object.keys(preview.exclusions).length ? <div className="flex flex-wrap gap-2 text-xs text-text-secondary">{Object.entries(preview.exclusions).map(([reason, count]) => <span key={reason} className="rounded-md border border-border px-2 py-1">{reason.replaceAll('_', ' ')}: {count}</span>)}</div> : null}
        <div className="rounded-lg border border-border"><div className="border-b border-border px-3 py-2 text-xs font-semibold">Recipient preview · masked numbers</div>{preview.items.length ? <ul className="divide-y divide-border">{preview.items.map((item) => <li key={item.sourceRecipientId} className="flex justify-between gap-3 px-3 py-2"><span>{item.phone}</span><span className="text-text-secondary">{item.outcome}</span></li>)}</ul> : <p className="p-3 text-text-secondary">No eligible recipients.</p>}</div>
        {preview.nextCursor ? <Button variant="secondary" disabled={loading} onClick={() => void loadMore()}>{loading ? 'Loading…' : 'Load more'}</Button> : null}</> : null}
      <label className="block space-y-1"><span className="font-medium">Follow-up name</span><Input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
      <label className="block space-y-1"><span className="font-medium">Compatible approved template on the original WABA</span><Select value={templateId} onChange={(event) => setTemplateId(event.target.value)}><option value="">Select template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</Select></label>
      <p className="text-xs text-text-secondary">The original sender is preserved. Launch remains subject to sender readiness, consent, template and queue checks.</p>
    </div>
  </ModalShell>;
}
