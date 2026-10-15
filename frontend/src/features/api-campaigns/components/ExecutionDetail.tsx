import { useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { ModalShell } from '../../../components/ui/ModalShell';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { PaymentEligibilityNotice } from '../../whatsapp/components/PaymentEligibilityNotice';
import { DisplayNameApprovalNotice } from '../../whatsapp/components/DisplayNameApprovalNotice';
import type { ApiExecution, ApiRetryPreview } from '../types';
import { executionFailureLabel } from '../failure-label';
import { apiCampaignsApi } from '../api';
import type { AccountScope } from '../../whatsapp/account-view';

export function ExecutionDetail({ execution, retrying, readOnly = false, scope, onClose, onRetry }: { execution?: ApiExecution; retrying?: boolean; readOnly?: boolean; scope?: AccountScope; onClose: () => void; onRetry: () => void }) {
  const [fresh, setFresh] = useState<ApiExecution>();
  const [preview, setPreview] = useState<{ id: string; value: ApiRetryPreview }>();
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const current = fresh && execution && fresh.id === execution.id && new Date(fresh.updatedAt).getTime() > new Date(execution.updatedAt).getTime() ? fresh : execution;
  const retryable = !readOnly && current?.status === 'FAILED' && current.retrySafety === 'SAFE';
  const activePreview = preview && preview.id === current?.id ? preview.value : undefined;
  const refresh = async () => { if (!current) return; setRefreshing(true); setError(''); try { setFresh(await apiCampaignsApi.execution(current.apiCampaignId, current.id, scope)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Execution could not be refreshed.'); } finally { setRefreshing(false); } };
  const checkRetry = async () => { if (!current || checking) return; setChecking(true); setError(''); setConfirmed(false); try { setPreview({ id: current.id, value: await apiCampaignsApi.retryPreview(current.apiCampaignId, current.id) }); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Retry eligibility could not be checked.'); } finally { setChecking(false); } };
  return <ModalShell open={Boolean(current)} title="Execution details" onClose={onClose}>{current ? <div className="space-y-4 text-sm">
    <div className="flex items-center justify-between gap-3"><code className="break-all text-xs">{current.id}</code><StatusBadge status={current.status as never}/></div>
    <dl className="grid grid-cols-2 gap-4"><Fact label="Campaign" value={current.campaignSlug}/><Fact label="Attempts" value={String(current.attempts)}/><Fact label="Source" value={current.source ?? '—'}/><Fact label="Received" value={format(current.receivedAt)}/><Fact label="Queued" value={format(current.queuedAt)}/><Fact label="Accepted" value={format(current.acceptedAt)}/><Fact label="Sent" value={format(current.sentAt)}/><Fact label="Delivered" value={format(current.deliveredAt)}/><Fact label="Read" value={format(current.readAt)}/><Fact label="Failed" value={format(current.failedAt)}/><Fact label="Failure code" value={current.failureCode ? `${current.failureCode}${current.failureSubcode ? `/${current.failureSubcode}` : ''}` : '—'}/><Fact label="Failure category" value={current.failureCategory ?? '—'}/><Fact label="Retry safety" value={current.retrySafety ?? '—'}/></dl>
    {current.status === 'FAILED' || current.status === 'REJECTED' ? <div className="rounded-xl bg-danger-soft p-3 text-danger"><p className="font-semibold">{executionFailureLabel(current)}</p>{current.failureMessage && current.failureMessage !== executionFailureLabel(current) ? <p className="mt-1 text-xs">{current.failureMessage}</p> : null}<PaymentEligibilityNotice failure={current} compact/><DisplayNameApprovalNotice failure={current} compact/></div> : null}
    {current.status === 'QUEUED' && current.retryMode === 'AUTO' && current.nextEligibleRetryAt ? <p role="status" className="rounded-xl bg-background-subtle p-3 text-xs">Automatic retry scheduled after {format(current.nextEligibleRetryAt)}.</p> : null}
    {current.status === 'QUEUED' && current.retryMode === 'MANUAL' ? <p role="status" className="rounded-xl bg-background-subtle p-3 text-xs">Manual retry queued. Refresh for progress.</p> : null}
    {current.attemptHistory?.length ? <div><p className="font-semibold">Attempt history</p><ol className="mt-2 space-y-2 text-xs text-text-secondary">{current.attemptHistory.map((entry, index) => <li key={`${entry.at}-${index}`} className="rounded-lg border border-border p-2">#{entry.attempt} · {entry.status} · {format(entry.at)}{entry.failureCode ? ` · ${entry.failureCode}` : ''}{entry.failureTitle ? ` · ${entry.failureTitle}` : ''}{entry.failureMessage ? ` · ${entry.failureMessage}` : ''}</li>)}</ol></div> : null}
    {retryable && activePreview ? <div className="space-y-2 rounded-xl border border-border bg-background-subtle p-3 text-xs"><p className="font-semibold">Retry preview</p><p>{activePreview.eligible ? 'This failed execution is eligible for one more provider submission.' : `Retry unavailable: ${activePreview.reason?.replaceAll('_', ' ').toLowerCase() ?? 'not retry-safe'}`}</p><p>{[activePreview.failureCode, activePreview.failureSubcode, activePreview.failureTitle, activePreview.failureMessage].filter(Boolean).join(' · ') || 'No provider detail is available.'}</p>{activePreview.nextEligibleRetryAt ? <p>Next eligible: {format(activePreview.nextEligibleRetryAt)}</p> : null}{activePreview.eligible ? <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}/><span>I confirm this additional WhatsApp message may incur a Meta charge.</span></label> : null}</div> : null}
    {error ? <p role="alert" className="text-xs text-danger">{error}</p> : null}
    {!retryable ? <p className="text-xs text-text-secondary">Retry is unavailable for pending, successful, uncertain or permanently blocked executions.</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button variant="secondary" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing…' : 'Refresh'}</Button>{retryable && !activePreview ? <Button disabled={checking} onClick={() => void checkRetry()}>{checking ? 'Checking…' : 'Check retry'}</Button> : null}{retryable && activePreview?.eligible ? <Button disabled={!confirmed || retrying} onClick={onRetry}>{retrying ? 'Retrying…' : 'Confirm retry'}</Button> : null}</div>
  </div> : null}</ModalShell>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold uppercase text-text-muted">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>; }
const format = (value?: string) => value ? new Date(value).toLocaleString() : '—';
