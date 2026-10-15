import { ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/StatusBadge';
import { broadcastsApi } from '../features/broadcasts/api';
import type { BroadcastCampaign, BroadcastStatus } from '../features/broadcasts/types';
import { RetargetModal } from '../features/broadcasts/components/RetargetModal';
import { AccountViewPicker, useAccountScope } from '../features/whatsapp/account-view';

const statusOptions: Array<{ value: '' | BroadcastStatus; label: string }> = [
  { value: '', label: 'All statuses' }, { value: 'DRAFT', label: 'Draft' },
  { value: 'SCHEDULED', label: 'Scheduled' },
  { value: 'QUEUED', label: 'Queued' }, { value: 'PROCESSING', label: 'Running' },
  { value: 'PAUSED', label: 'Paused' }, { value: 'COMPLETED', label: 'Completed' },
  { value: 'COMPLETED_WITH_ERRORS', label: 'Completed with errors' },
  { value: 'FAILED', label: 'Failed' }, { value: 'CANCELLED', label: 'Cancelled' },
];

export function BroadcastCampaignsPage() {
  const { scope, select, historical, query } = useAccountScope();
  const [campaigns, setCampaigns] = useState<BroadcastCampaign[]>([]);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [cursorHistory, setCursorHistory] = useState<Array<string | undefined>>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retargetSource, setRetargetSource] = useState<{ id: string; name: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const page = await broadcastsApi.list({ search, status, cursor, scope });
      setCampaigns(page.items);
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Broadcast campaigns could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [cursor, search, status, scope]);

  useEffect(() => {
    let active = true;
    broadcastsApi.list({ search, status, cursor, scope }).then((page) => {
      if (!active) return;
      setCampaigns(page.items); setNextCursor(page.nextCursor); setError('');
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Broadcast campaigns could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cursor, search, status, scope]);

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setCursor(undefined);
    setCursorHistory([]);
    setSearch(searchInput.trim());
  };

  const changeStatus = (value: string) => {
    setStatus(value);
    setCursor(undefined);
    setCursorHistory([]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Broadcast Campaigns"
        description="Create and track workspace-scoped WhatsApp template broadcasts."
        action={!historical ? <Link to="/whatsapp/broadcasts/new"><Button><Plus className="size-4" />New Broadcast</Button></Link> : undefined}
      />
      <AccountViewPicker scope={scope} onSelect={(value) => { setCursor(undefined); setCursorHistory([]); select(value); }} />
      <Card className="overflow-hidden">
        <form className="flex flex-col gap-3 border-b border-border/80 p-4 sm:flex-row sm:px-5" onSubmit={applySearch}>
          <div className="relative flex-1 sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <Input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} aria-label="Search broadcast campaigns" placeholder="Search campaigns" className="pl-9" />
          </div>
          <Select value={status} onChange={(event) => changeStatus(event.target.value)} aria-label="Filter campaigns by status" className="sm:w-52">
            {statusOptions.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
          </Select>
          <Button type="submit" variant="secondary">Search</Button>
        </form>

        {loading ? <LoadingState label="Loading broadcasts" /> : error ? <ErrorState message={error} onRetry={() => void load()} /> : campaigns.length === 0 ? (
          <EmptyState title="No broadcast campaigns yet" description="Create a draft after a WhatsApp account, approved template, and audience segment are available." />
        ) : (
          <div className="overflow-x-auto">
            <table className="campaign-table min-w-[1120px] w-full text-left text-[13px]">
              <caption className="sr-only">Broadcast campaigns</caption>
              <thead className="border-b border-border/80">
                <tr>
                  {['Campaign', 'Audience', 'Template', 'Status', 'Recipients', 'Delivered', 'Read', 'Failed', 'Created', 'Actions'].map((column) => (
                    <th key={column} className={`whitespace-nowrap px-5 py-3.5 ${column === 'Actions' ? 'sticky right-0 bg-surface text-right' : ''}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {campaigns.map((campaign) => <CampaignRow key={campaign.id} campaign={campaign} onError={setError} historical={historical} query={query} onRetarget={setRetargetSource} />)}
              </tbody>
            </table>
          </div>
        )}

        {!loading && !error && campaigns.length > 0 ? (
          <div className="flex items-center justify-between border-t border-border/80 px-5 py-3">
            <p className="text-xs text-text-secondary">Cursor-paginated results</p>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={cursorHistory.length === 0} onClick={() => {
                const previous = [...cursorHistory];
                setCursor(previous.pop());
                setCursorHistory(previous);
              }}><ChevronLeft className="size-4" />Previous</Button>
              <Button size="sm" variant="secondary" disabled={!nextCursor} onClick={() => {
                if (!nextCursor) return;
                setCursorHistory((previous) => [...previous, cursor]);
                setCursor(nextCursor);
              }}>Next<ChevronRight className="size-4" /></Button>
            </div>
          </div>
        ) : null}
      </Card>
      <RetargetModal campaign={retargetSource} historyAccountId={scope?.accountId} onClose={() => setRetargetSource(undefined)} />
    </div>
  );
}

function CampaignRow({ campaign, onError, historical, query, onRetarget }: { campaign: BroadcastCampaign; onError: (message: string) => void; historical: boolean; query: string; onRetarget: (campaign: { id: string; name: string }) => void }) {
  const navigate = useNavigate();
  const [duplicating, setDuplicating] = useState(false);
  const counters = campaign.counters ?? { total: 0, delivered: 0, read: 0, failed: 0 };
  const audience = campaign.audienceDefinition?.source === 'SEGMENT' ? 'Segment' : campaign.audienceDefinition?.source ?? 'Not configured';
  return (
    <tr>
      <td className="px-5 py-4"><p className="font-semibold text-text-primary">{campaign.name}</p><p className="mt-0.5 text-xs text-text-muted">{campaign.channel}</p></td>
      <td className="px-5 py-4 text-text-secondary">{audience}</td>
      <td className="px-5 py-4"><p className="font-medium text-text-primary">{campaign.templateSnapshot?.name ?? 'Unavailable'}</p><p className="mt-0.5 text-xs text-text-muted">{campaign.templateSnapshot?.language ?? '—'}</p></td>
      <td className="px-5 py-4"><StatusBadge status={campaign.status} />{campaign.status === 'SCHEDULED' && campaign.scheduledAt ? <p className="mt-1 whitespace-nowrap text-xs text-text-secondary">{new Date(campaign.scheduledAt).toLocaleString()}</p> : null}</td>
      <td className="px-5 py-4 tabular-nums text-text-secondary">{(counters.total ?? 0).toLocaleString()}</td>
      <td className="px-5 py-4 tabular-nums text-text-secondary">{(counters.delivered ?? 0).toLocaleString()}</td>
      <td className="px-5 py-4 tabular-nums text-text-secondary">{(counters.read ?? 0).toLocaleString()}</td>
      <td className="px-5 py-4 tabular-nums text-text-secondary">{(counters.failed ?? 0).toLocaleString()}</td>
      <td className="whitespace-nowrap px-5 py-4 text-text-secondary">{new Date(campaign.createdAt).toLocaleDateString()}</td>
      <td className="sticky right-0 bg-surface px-5 py-4"><div className="flex justify-end gap-3">{!historical && campaign.status === 'DRAFT' && !campaign.sourceCampaignId ? <Link to={`/whatsapp/broadcasts/${campaign.id}/edit`} className="rounded text-xs font-semibold text-primary transition-colors hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">Edit</Link> : null}{!historical && !campaign.sourceCampaignId ? <button className="rounded text-xs font-semibold text-text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" disabled={duplicating} onClick={async()=>{setDuplicating(true);try{const copy=await broadcastsApi.duplicate(campaign.id);navigate(`/whatsapp/broadcasts/${copy.id}/edit`)}catch(reason){onError(reason instanceof Error?reason.message:'Campaign could not be duplicated.')}finally{setDuplicating(false)}}}>{duplicating?'Copying…':'Duplicate'}</button> : null}{['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(campaign.status) ? <button className="rounded text-xs font-semibold text-primary transition-colors hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" onClick={() => onRetarget({ id: campaign.id, name: campaign.name })}>Retarget</button> : null}<Link to={`/whatsapp/broadcasts/${campaign.id}${query}`} className="rounded text-xs font-semibold text-primary transition-colors hover:text-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">View</Link></div></td>
    </tr>
  );
}
