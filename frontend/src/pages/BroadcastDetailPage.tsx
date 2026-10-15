import { ArrowLeft, Copy, Pencil, Pause, Play, RefreshCw, Rocket, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Select } from '../components/ui/Select';
import { StatusBadge } from '../components/ui/StatusBadge';
import { ModalShell } from '../components/ui/ModalShell';
import { broadcastsApi } from '../features/broadcasts/api';
import type { BroadcastAnalytics, BroadcastCampaign, BroadcastReadiness, BroadcastRecipient, BroadcastRetryPreview } from '../features/broadcasts/types';
import { PaymentEligibilityNotice } from '../features/whatsapp/components/PaymentEligibilityNotice';
import { DisplayNameApprovalNotice } from '../features/whatsapp/components/DisplayNameApprovalNotice';
import { HistoryAccountLabel, useAccountScope } from '../features/whatsapp/account-view';
import { RetargetModal } from '../features/broadcasts/components/RetargetModal';

const recipientStatuses = ['', 'PENDING', 'QUEUED', 'SENDING', 'ACCEPTED', 'SENT', 'DELIVERED', 'READ', 'RETRY_WAIT', 'FAILED', 'SKIPPED', 'CANCELLED'];

export function BroadcastDetailPage() {
  const { scope, historical, query } = useAccountScope();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState<BroadcastCampaign>();
  const [analytics, setAnalytics] = useState<BroadcastAnalytics>();
  const [readiness, setReadiness] = useState<BroadcastReadiness>();
  const [recipients, setRecipients] = useState<BroadcastRecipient[]>([]);
  const [status, setStatus] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState('');
  const [retryOpen, setRetryOpen] = useState(false);
  const [retargetOpen, setRetargetOpen] = useState(false);
  const [retryPreview, setRetryPreview] = useState<BroadcastRetryPreview>();
  const [retryLoading, setRetryLoading] = useState(false);
  const [retryActing, setRetryActing] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [chargesConfirmed, setChargesConfirmed] = useState(false);
  const retryKey = useRef<string | undefined>(undefined);

  const openRetry = async () => {
    if (!campaign || retryLoading) return;
    setRetryOpen(true); setRetryLoading(true); setRetryError(''); setRetryPreview(undefined); setChargesConfirmed(false);
    retryKey.current ??= crypto.randomUUID();
    try { setRetryPreview(await broadcastsApi.retryPreview(campaign.id)); }
    catch (reason) { setRetryError(reason instanceof Error ? reason.message : 'Retry preview could not be loaded.'); }
    finally { setRetryLoading(false); }
  };

  const confirmRetry = async () => {
    if (!campaign || !retryPreview?.canRetry || !chargesConfirmed || retryActing) return;
    setRetryActing(true); setRetryError('');
    try {
      await broadcastsApi.retryFailed(campaign.id, retryKey.current ?? (retryKey.current = crypto.randomUUID()));
      setRetryOpen(false); retryKey.current = undefined; await load();
    } catch (reason) { setRetryError(reason instanceof Error ? reason.message : 'Retry could not be started.'); }
    finally { setRetryActing(false); }
  };

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const [campaignResult, analyticsResult, recipientPage, readinessResult] = await Promise.all([
        broadcastsApi.get(id, scope), broadcastsApi.analytics(id, scope), broadcastsApi.recipients(id, { status: status || undefined, scope }), historical ? Promise.resolve(undefined) : broadcastsApi.readiness(id),
      ]);
      setCampaign(campaignResult); setAnalytics(analyticsResult); setRecipients(recipientPage.items); setNextCursor(recipientPage.nextCursor); setReadiness(readinessResult);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Broadcast details could not be loaded.');
    } finally { setLoading(false); }
  }, [id, status, scope, historical]);

  useEffect(() => {
    if (!id) return;
    let active = true;
    Promise.all([
      broadcastsApi.get(id, scope), broadcastsApi.analytics(id, scope), broadcastsApi.recipients(id, { status: status || undefined, scope }), historical ? Promise.resolve(undefined) : broadcastsApi.readiness(id),
    ]).then(([campaignResult, analyticsResult, recipientPage, readinessResult]) => {
      if (!active) return;
      setCampaign(campaignResult); setAnalytics(analyticsResult); setRecipients(recipientPage.items); setNextCursor(recipientPage.nextCursor); setReadiness(readinessResult); setError('');
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : 'Broadcast details could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, status, scope, historical]);

  useEffect(() => {
    if (!campaign?.retryBatchId || !['QUEUED', 'PROCESSING'].includes(campaign.status)) return;
    const timer = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [campaign?.retryBatchId, campaign?.status, load]);

  const action = async (operation: 'launch' | 'pause' | 'resume' | 'cancel') => {
    if (!campaign) return;
    if (operation === 'cancel' && !window.confirm('Cancel unsent recipients for this broadcast? Messages already accepted by Meta cannot be recalled.')) return;
    setActing(true); setError('');
    try {
      if (operation === 'launch') await broadcastsApi.launch(campaign.id, { mode: 'SEND_NOW', timezone: campaign.timezone || 'UTC', launchKey: crypto.randomUUID() });
      else if (operation === 'pause') await broadcastsApi.pause(campaign.id);
      else if (operation === 'resume') await broadcastsApi.resume(campaign.id);
      else await broadcastsApi.cancel(campaign.id);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Campaign action failed.');
    } finally { setActing(false); }
  };

  const duplicate = async () => {
    setActing(true); setError('');
    try { const copy = await broadcastsApi.duplicate(id); navigate(`/whatsapp/broadcasts/${copy.id}/edit`); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Campaign could not be duplicated.'); }
    finally { setActing(false); }
  };

  const loadMore = async () => {
    if (!campaign || !nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await broadcastsApi.recipients(campaign.id, { status: status || undefined, cursor: nextCursor, scope });
      setRecipients((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))]);
      setNextCursor(page.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More recipients could not be loaded.'); }
    finally { setLoadingMore(false); }
  };

  if (loading && !campaign) return <Card><LoadingState label="Loading broadcast details" /></Card>;
  if (error && !campaign) return <Card><ErrorState message={error} onRetry={() => void load()} /></Card>;
  if (!campaign || !analytics) return <Card><ErrorState message="The broadcast is unavailable." /></Card>;

  const pausable = ['SCHEDULED', 'QUEUED', 'PROCESSING'].includes(campaign.status);
  const cancellable = ['SNAPSHOTTING', 'READY', 'SCHEDULED', 'QUEUED', 'PROCESSING', 'PAUSED'].includes(campaign.status);

  return (
    <div className="space-y-8">
      <Link to={`/whatsapp/broadcasts${query}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary"><ArrowLeft className="size-4" />Back to broadcasts</Link>
      <HistoryAccountLabel scope={scope} />
      <PageHeader title={campaign.name} description={`${campaign.templateSnapshot?.name ?? 'Template unavailable'} · Created ${formatDate(campaign.createdAt)}`} action={<div className="flex flex-wrap gap-2"><Button variant="secondary" disabled={loading || acting} onClick={() => void load()}><RefreshCw className="size-4" />Refresh</Button>{!historical && campaign.status === 'DRAFT' && !campaign.sourceCampaignId ? <Link to={`/whatsapp/broadcasts/${campaign.id}/edit`}><Button variant="secondary"><Pencil className="size-4" />Edit</Button></Link> : null}{!historical && !campaign.sourceCampaignId ? <Button variant="secondary" disabled={acting} onClick={() => void duplicate()}><Copy className="size-4" />Duplicate</Button> : null}{['COMPLETED', 'COMPLETED_WITH_ERRORS'].includes(campaign.status) ? <Button variant="secondary" onClick={() => setRetargetOpen(true)}>Retarget</Button> : null}{!historical && campaign.status === 'DRAFT' ? <Button disabled={!readiness?.valid || acting} onClick={() => void action('launch')}><Rocket className="size-4" />Launch</Button> : null}{!historical && pausable ? <Button variant="secondary" disabled={acting} onClick={() => void action('pause')}><Pause className="size-4" />Pause</Button> : null}{!historical && campaign.status === 'PAUSED' ? <Button disabled={acting} onClick={() => void action('resume')}><Play className="size-4" />Resume</Button> : null}{!historical && cancellable ? <Button variant="danger" disabled={acting} onClick={() => void action('cancel')}><XCircle className="size-4" />Cancel</Button> : null}</div>} />
      {campaign.sourceCampaignId ? <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm"><span className="font-semibold">Follow-up draft</span> · {campaign.retargetingFilter?.replaceAll('_', ' ').toLowerCase()} audience from <Link className="text-primary underline" to={`/whatsapp/broadcasts/${campaign.sourceCampaignId}${query}`}>source campaign</Link>. Snapshot {campaign.snapshotAt ? formatDate(campaign.snapshotAt) : 'pending'}.</div> : null}

      {!historical && campaign.status === 'COMPLETED_WITH_ERRORS' && analytics.counters.failed > 0 ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3"><div><p className="text-sm font-semibold">Failed recipients</p><p className="text-xs text-text-secondary">Review safe retry eligibility before another provider submission.</p></div><Button variant="secondary" disabled={acting || retryLoading} onClick={() => void openRetry()}><RefreshCw className="size-4" />Retry Failed</Button></div> : null}
      {!historical && campaign.retryBatchId && ['QUEUED', 'PROCESSING'].includes(campaign.status) ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Retry in progress. Refresh to see recipient progress and updated totals.</div> : null}
      {campaign.retryLastError ? <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">Retry paused: {campaign.retryLastError}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div> : null}
      {!historical && campaign.status === 'DRAFT' && !readiness?.valid ? <div className="rounded-xl border border-amber-200 bg-warning-soft px-4 py-3 text-sm text-warning">Launch unavailable: {readiness?.reason ?? 'Readiness could not be verified.'}</div> : null}
      {campaign.scheduledAt ? <div className="rounded-xl border border-border bg-background-subtle px-4 py-3 text-sm text-text-secondary">Scheduled for <strong className="text-text-primary">{formatDate(campaign.scheduledAt)}</strong> ({campaign.timezone}).</div> : null}

      <section aria-label="Campaign summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <Metric label="Total" value={analytics.counters.total} /><Metric label="Queued" value={analytics.counters.queued} /><Metric label="Accepted" value={analytics.counters.accepted} /><Metric label="Sent" value={analytics.counters.sent} /><Metric label="Delivered" value={analytics.counters.delivered} /><Metric label="Read" value={analytics.counters.read} /><Metric label="Failed" value={analytics.counters.failed} danger={analytics.counters.failed > 0} />
      </section>

      <Card className="overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-border/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 className="text-[17px] font-semibold tracking-[-0.01em]">Recipients</h2><p className="mt-1 text-xs text-text-secondary">Persisted delivery lifecycle records</p></div>
          <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label="Filter recipients by status" className="sm:w-48"><option value="">All statuses</option>{recipientStatuses.slice(1).map((value) => <option key={value} value={value}>{value.toLowerCase().replace('_', ' ')}</option>)}</Select>
        </div>
        {loading ? <LoadingState label="Refreshing recipients" /> : recipients.length === 0 ? <div className="px-5 py-14 text-center text-sm text-text-secondary">No recipients match this status.</div> : (
          <div className="overflow-x-auto">
            <table className="min-w-[1420px] w-full text-left text-[13px]">
              <caption className="sr-only">Campaign recipients</caption>
              <thead className="border-b border-border/80 bg-background/80 text-[10px] font-semibold uppercase tracking-[0.1em] text-text-secondary"><tr>{['Name', 'Phone', 'Status', 'Attempts', 'Accepted', 'Sent', 'Delivered', 'Read', 'Failed', 'Failure'].map((column) => <th key={column} className="whitespace-nowrap px-4 py-3.5">{column}</th>)}</tr></thead>
              <tbody className="divide-y divide-border/70">{recipients.map((recipient) => <RecipientRow key={recipient.id} recipient={recipient} />)}</tbody>
            </table>
          </div>
        )}
        {nextCursor ? <div className="border-t border-border/80 px-5 py-3"><Button size="sm" variant="secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : 'Load more recipients'}</Button></div> : null}
      </Card>

      <Card className="p-5 sm:p-6"><div className="flex flex-wrap items-center gap-3"><StatusBadge status={campaign.status} /><span className="text-xs text-text-secondary">Delivery {analytics.deliveryRate}%</span><span className="text-xs text-text-secondary">Read {analytics.readRate}%</span><span className="text-xs text-text-secondary">Failure {analytics.failureRate}%</span></div><p className="mt-4 text-xs leading-5 text-text-muted">Campaign ID: {campaign.id}</p></Card>
      <ModalShell open={retryOpen} title="Retry failed recipients" description="Only confirmed retry-safe failures are eligible. No delivered or uncertain outcomes will be resent." onClose={() => { if (!retryActing) setRetryOpen(false); }} footer={<div className="flex justify-end gap-2"><Button variant="secondary" disabled={retryActing} onClick={() => setRetryOpen(false)}>Cancel</Button><Button disabled={!retryPreview?.canRetry || !chargesConfirmed || retryActing} onClick={() => void confirmRetry()}>{retryActing ? 'Starting retry…' : `Retry ${retryPreview?.eligible ?? 0} recipients`}</Button></div>}>
        {retryLoading ? <LoadingState label="Checking retry eligibility" /> : retryError ? <ErrorState message={retryError} onRetry={() => void openRetry()} /> : retryPreview ? <div className="space-y-4 text-sm"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><RetryCount label="Failed" value={retryPreview.totalFailed} /><RetryCount label="Eligible now" value={retryPreview.eligible} /><RetryCount label="Temporary restrictions" value={retryPreview.temporaryRestrictions} /><RetryCount label="Permanent" value={retryPreview.permanentFailures} /><RetryCount label="Uncertain" value={retryPreview.uncertainOutcomes} /></div>{Object.entries(retryPreview.exclusionReasons).filter(([reason, count]) => reason !== 'ELIGIBLE' && count > 0).length > 0 ? <div><p className="font-medium">Excluded or waiting</p><ul className="mt-2 space-y-1 text-xs text-text-secondary">{Object.entries(retryPreview.exclusionReasons).filter(([reason, count]) => reason !== 'ELIGIBLE' && count > 0).map(([reason, count]) => <li key={reason}>{reason.replaceAll('_', ' ').toLowerCase()}: {count}</li>)}</ul></div> : null}{!retryPreview.senderReady || !retryPreview.queueReady ? <p className="text-danger">Retry unavailable: {retryPreview.senderReason ?? retryPreview.queueReason}</p> : null}<label className="flex items-start gap-2 rounded-lg border border-border p-3 text-xs leading-5"><input type="checkbox" checked={chargesConfirmed} onChange={(event) => setChargesConfirmed(event.target.checked)} disabled={!retryPreview.canRetry} className="mt-1" /><span>I confirm that up to {retryPreview.eligible} additional WhatsApp messages may be submitted and charged by Meta.</span></label></div> : null}
      </ModalShell>
      <RetargetModal campaign={retargetOpen ? { id: campaign.id, name: campaign.name } : undefined} historyAccountId={scope?.accountId} onClose={() => setRetargetOpen(false)} />
    </div>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return <Card className="p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-muted">{label}</p><p className={`mt-2 text-xl font-semibold tabular-nums ${danger ? 'text-danger' : 'text-text-primary'}`}>{value.toLocaleString()}</p></Card>;
}

function RetryCount({ label, value }: { label: string; value: number }) { return <div className="rounded-lg border border-border bg-background-subtle p-3"><p className="text-xs text-text-secondary">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value.toLocaleString()}</p></div>; }

function RecipientRow({ recipient }: { recipient: BroadcastRecipient }) {
  const failure = [recipient.failureCode ? `${recipient.failureCode}${recipient.failureSubcode ? `/${recipient.failureSubcode}` : ''}` : '', recipient.failureTitle, recipient.failureMessage].filter(Boolean).join(' · ');
  return <tr className={recipient.status === 'FAILED' ? 'bg-danger-soft/40' : 'transition-colors hover:bg-background/80'}><td className="px-4 py-3.5 font-medium text-text-primary">{recipient.contactName ?? '—'}</td><td className="whitespace-nowrap px-4 py-3.5 font-mono text-xs text-text-secondary">{recipient.recipientPhone}</td><td className="px-4 py-3.5"><StatusBadge status={recipient.status} /></td><td className="px-4 py-3.5 tabular-nums text-text-secondary">{recipient.attemptCount}</td><TimeCell value={recipient.acceptedAt} /><TimeCell value={recipient.sentAt} /><TimeCell value={recipient.deliveredAt} /><TimeCell value={recipient.readAt} /><TimeCell value={recipient.failedAt} /><td className="max-w-sm px-4 py-3.5 text-xs leading-5 text-text-secondary">{failure || '—'}{recipient.failureSource ? <p className="mt-1 text-text-muted">Source: {recipient.failureSource.replaceAll('_', ' ').toLowerCase()}</p> : null}{recipient.attemptHistory?.length ? <details className="mt-2"><summary className="cursor-pointer font-medium">Attempt history ({recipient.attemptHistory.length})</summary><ul className="mt-2 space-y-1">{recipient.attemptHistory.map((entry, index) => <li key={`${entry.at}-${index}`}>#{entry.attempt} · {entry.status} · {formatDate(entry.at)}{entry.failureCode ? ` · ${entry.failureCode}` : ''}{entry.failureTitle ? ` · ${entry.failureTitle}` : ''}{entry.failureMessage ? ` · ${entry.failureMessage}` : ''}</li>)}</ul></details> : null}<PaymentEligibilityNotice failure={recipient} compact /><DisplayNameApprovalNotice failure={recipient} compact /></td></tr>;
}

function TimeCell({ value }: { value?: string }) { return <td className="whitespace-nowrap px-4 py-3.5 text-xs text-text-secondary">{value ? formatDate(value) : '—'}</td>; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString(); }
