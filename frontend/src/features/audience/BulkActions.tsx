import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { audienceApi } from './api';

export function BulkActions({ ids, onDone }: { ids: string[]; onDone: () => void }) {
  const [action, setAction] = useState('ADD_TAG'); const [tag, setTag] = useState(''); const [status, setStatus] = useState('ACTIVE'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function apply() {
    if ((action === 'DELETE' || action === 'RESTORE') && !window.confirm(`${action === 'DELETE' ? 'Soft delete' : 'Restore'} ${ids.length} selected contacts? Consent and history are preserved.`)) return;
    setBusy(true); setError('');
    try { await audienceApi.bulk(ids, action, { ...(action.endsWith('TAG') ? { tags: [tag] } : {}), ...(action === 'STATUS' ? { status } : {}) }); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Bulk action failed.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2 border-b border-border p-4"><span className="text-sm">{ids.length} selected (maximum 100)</span><Select className="w-40" value={action} disabled={busy} onChange={event => setAction(event.target.value)}><option value="ADD_TAG">Add tag</option><option value="REMOVE_TAG">Remove tag</option><option value="STATUS">Change status</option><option value="DELETE">Soft delete</option><option value="RESTORE">Restore</option></Select>{action.endsWith('TAG') ? <Input className="w-40" aria-label="Tag" maxLength={80} value={tag} disabled={busy} onChange={event => setTag(event.target.value)} /> : action === 'STATUS' ? <Select className="w-36" value={status} disabled={busy} onChange={event => setStatus(event.target.value)}><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option></Select> : null}<Button disabled={busy || !ids.length || (action.endsWith('TAG') && !tag.trim())} onClick={() => void apply()}>{busy ? 'Applying…' : 'Apply'}</Button>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</div>;
}
