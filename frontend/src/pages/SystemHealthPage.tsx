import { Activity, Database, Monitor, RefreshCw, Server, Workflow } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { PageHeader } from '../components/common/PageHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useHealthStatus } from '../features/health/useHealthStatus';
import type { ServiceStatus } from '../services/api/types';

export function SystemHealthPage() {
  const health = useHealthStatus();

  return (
    <div className="space-y-8">
      <PageHeader
        title="System Health"
        description="Current dependency availability, queue counts, and recent worker heartbeats."
        action={<Button variant="secondary" onClick={() => void health.refresh()} disabled={health.loading}><RefreshCw className={health.loading ? 'size-4 animate-spin' : 'size-4'} />Refresh</Button>}
      />
      {health.loading ? <Card><LoadingState label="Checking system health" /></Card> : health.error ? (
        <Card><ErrorState message={health.error} onRetry={() => void health.refresh()} /></Card>
      ) : (
        <section aria-label="Service health" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:gap-5">
          <HealthCard icon={Monitor} name="Frontend" status="HEALTHY" detail="This interface is running." />
          <HealthCard icon={Server} name="Backend" status={health.live ? 'HEALTHY' : 'UNAVAILABLE'} detail={health.live ? 'Liveness endpoint responded.' : 'Liveness endpoint did not respond.'} />
          <HealthCard icon={Database} name="MongoDB" status={health.ready?.dependencies.mongodb.status ?? 'NOT_CONFIGURED'} detail="Current database connection state." />
          <HealthCard icon={Workflow} name="Redis" status={health.ready?.dependencies.redis.status ?? 'NOT_CONFIGURED'} detail="Queue Redis connectivity check." />
          <HealthCard icon={Workflow} name="Broadcast Queue" status={health.ready?.dependencies.broadcastQueue.status ?? 'NOT_CONFIGURED'} detail={queueDetail(health.ready?.dependencies.broadcastQueue.counts)} />
          <HealthCard icon={Activity} name="Broadcast Worker" status={health.ready?.dependencies.broadcastWorker.status ?? 'NOT_VERIFIED'} detail="Healthy requires a heartbeat within 45 seconds. Missing leases are not verified." />
          <HealthCard icon={Workflow} name="API Campaign Queue" status={health.ready?.dependencies.apiCampaignQueue.status ?? 'NOT_CONFIGURED'} detail={queueDetail(health.ready?.dependencies.apiCampaignQueue.counts)} />
          <HealthCard icon={Activity} name="API Campaign Worker" status={health.ready?.dependencies.apiCampaignWorker.status ?? 'NOT_VERIFIED'} detail="Healthy requires a heartbeat within 45 seconds. Missing leases are not verified." />
        </section>
      )}
      <Card className="p-5 sm:p-6">
        <h2 className="text-base font-semibold tracking-[-0.01em]">Readiness policy</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">Unconfigured optional dependencies are reported explicitly. They are not presented as healthy, and they do not prevent the foundation API from serving liveness and readiness checks.</p>
        {health.ready?.timestamp ? <p className="mt-3 text-xs text-text-muted">Last checked: {new Date(health.ready.timestamp).toLocaleString()}</p> : null}
      </Card>
    </div>
  );
}

function queueDetail(counts?: Record<string, number>) {
  return counts ? ['waiting', 'active', 'delayed', 'failed'].map(key => `${key}: ${counts[key] ?? 0}`).join(' · ') : 'Queue counts are unavailable until Redis responds.';
}

function HealthCard({ icon: Icon, name, status, detail }: { icon: LucideIcon; name: string; status: ServiceStatus; detail: string }) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-10 place-items-center rounded-xl border border-border/70 bg-background-subtle/80 text-text-secondary shadow-control"><Icon className="size-5" /></div>
        <StatusBadge status={status} />
      </div>
      <h2 className="mt-5 text-base font-semibold tracking-[-0.01em]">{name}</h2>
      <p className="mt-1 text-xs leading-5 text-text-secondary">{detail}</p>
    </Card>
  );
}
