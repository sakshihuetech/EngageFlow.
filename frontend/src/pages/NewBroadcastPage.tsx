import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader';
import { BroadcastWizard } from '../features/broadcasts/components/BroadcastWizard';
import { broadcastsApi } from '../features/broadcasts/api';
import type { BroadcastCampaign, BroadcastOptions } from '../features/broadcasts/types';

export function NewBroadcastPage() {
  const { id } = useParams();
  const [options, setOptions] = useState<BroadcastOptions>();
  const [campaign, setCampaign] = useState<BroadcastCampaign>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const [nextOptions, nextCampaign] = await Promise.all([broadcastsApi.options(), id ? broadcastsApi.get(id) : Promise.resolve(undefined)]); setOptions(nextOptions); setCampaign(nextCampaign); setError(nextCampaign && nextCampaign.status !== 'DRAFT' ? 'Only draft broadcasts can be edited.' : ''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Broadcast configuration could not be loaded.'); }
    finally { setLoading(false); }
  }, [id]);
  useEffect(() => {
    let active = true;
    Promise.all([broadcastsApi.options(), id ? broadcastsApi.get(id) : Promise.resolve(undefined)]).then(([result, existing]) => { if (active) { setOptions(result); setCampaign(existing); setError(existing && existing.status !== 'DRAFT' ? 'Only draft broadcasts can be edited.' : ''); } })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'Broadcast configuration could not be loaded.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);
  const existing = id && campaign?.id === id ? campaign : undefined;
  return <div className="space-y-8"><PageHeader title={id ? 'Edit Broadcast' : 'New Broadcast'} description={id ? 'Update this draft without changing its identity or delivery history.' : 'Create a workspace-scoped WhatsApp template broadcast in four reviewable steps.'} /><BroadcastWizard key={existing?.id ?? 'new'} options={options} initialCampaign={existing} loading={loading || Boolean(id && !existing && !error)} error={error} onRetry={() => void load()} /></div>;
}
