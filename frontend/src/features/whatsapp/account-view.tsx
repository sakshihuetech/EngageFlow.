import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Select } from '../../components/ui/Select';
import { apiClient } from '../../services/api/client';

export type AccountScope = { view: 'history'; accountId: string } | undefined;
type AccountView = { id: string; wabaId: string; name?: string; senders: string[] };

export function scopeSuffix(scope: AccountScope) {
  return scope ? `view=history&accountId=${encodeURIComponent(scope.accountId)}` : '';
}

export function useAccountScope() {
  const [params, setParams] = useSearchParams();
  const accountId = params.get('view') === 'history' ? params.get('accountId') : null;
  const scope: AccountScope = useMemo(() => accountId ? { view: 'history', accountId } : undefined, [accountId]);
  const select = (id: string) => setParams(id ? { view: 'history', accountId: id } : {});
  return { scope, select, historical: Boolean(scope), query: scope ? `?${scopeSuffix(scope)}` : '' };
}

export function AccountViewPicker({ scope, onSelect }: { scope: AccountScope; onSelect: (accountId: string) => void }) {
  const [views, setViews] = useState<{ current: AccountView; previous: AccountView[] }>();
  const [error, setError] = useState('');
  useEffect(() => { let active = true; void apiClient.get<{ current: AccountView; previous: AccountView[] }>('/api/whatsapp/accounts/views').then((value) => { if (active) setViews(value); }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'WABA views unavailable.'); }); return () => { active = false; }; }, []);
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
    <label className="font-semibold" htmlFor="waba-account-view">WhatsApp account view</label>
    <Select id="waba-account-view" className="max-w-full sm:w-80" value={scope?.accountId ?? ''} onChange={(event) => onSelect(event.target.value)}>
      <option value="">Current WABA{views?.current ? ` · ${views.current.name || views.current.wabaId}` : ''}</option>
      {views?.previous.map((account) => <option key={account.id} value={account.id}>Previous WABA History · {account.name || account.wabaId} · {account.senders.join(', ') || account.wabaId}</option>)}
    </Select>
    {scope ? <span className="text-xs text-warning">Read-only history. Sending and edits are unavailable.</span> : null}
    {error ? <span role="alert" className="text-xs text-danger">{error}</span> : null}
  </div>;
}

export function HistoryAccountLabel({ scope }: { scope: AccountScope }) {
  const [account, setAccount] = useState<AccountView>();
  useEffect(() => { if (!scope) return; let active = true; void apiClient.get<{ previous: AccountView[] }>('/api/whatsapp/accounts/views').then((views) => { if (active) setAccount(views.previous.find((item) => item.id === scope.accountId)); }).catch(() => { if (active) setAccount(undefined); }); return () => { active = false; }; }, [scope]);
  if (!scope) return null;
  return <div className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">Previous WABA History · read-only{account ? ` · WABA ${account.wabaId} · ${account.senders.join(', ') || 'Sender unavailable'}` : ''}</div>;
}
