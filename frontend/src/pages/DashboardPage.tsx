import { Activity, ArrowRight, Database, Megaphone } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { PageHeader } from '../components/common/PageHeader';
import { SectionHeader } from '../components/common/SectionHeader';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useHealthStatus } from '../features/health/useHealthStatus';
import type { ServiceStatus } from '../services/api/types';

const summaries = [
  { title: 'API campaigns', value: 'No data yet', note: 'Campaign migration is pending', icon: Megaphone },
  { title: 'Recent executions', value: 'No data yet', note: 'Execution data is not connected', icon: Activity },
  { title: 'Data source', value: 'Not connected', note: 'Migration will be reviewed first', icon: Database },
];

export function DashboardPage() {
  const health = useHealthStatus();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Welcome to EngageFlow"
        description="Your WhatsApp-first customer engagement workspace is ready for a careful, feature-by-feature migration."
        action={<Link to="/whatsapp/api-campaigns"><Button>View API Campaigns <ArrowRight className="size-4" /></Button></Link>}
      />

      <section aria-label="Workspace summary" className="grid gap-4 md:grid-cols-3 lg:gap-5">
        {summaries.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-secondary">{item.title}</p>
                  <p className="mt-2 text-lg font-semibold tracking-[-0.015em] text-text-primary">{item.value}</p>
                  <p className="mt-1.5 text-xs leading-5 text-text-muted">{item.note}</p>
                </div>
                <div className="grid size-10 place-items-center rounded-xl border border-primary-border bg-primary-soft text-primary shadow-control"><Icon className="size-[18px]" /></div>
              </div>
            </Card>
          );
        })}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:gap-6">
        <Card>
          <div className="border-b border-border/80 px-5 py-4 sm:px-6"><SectionHeader title="Recent activity" description="Campaign and execution activity will appear after migration." /></div>
          <EmptyState title="No campaign data yet" description="Feature data will appear after migration. No placeholder activity has been generated." />
        </Card>

        <Card className="h-fit">
          <div className="border-b border-border/80 px-5 py-4"><SectionHeader title="System status" description="Live foundation checks" /></div>
          {health.loading ? <LoadingState label="Checking services" /> : health.error ? <ErrorState message={health.error} onRetry={() => void health.refresh()} /> : (
            <div className="divide-y divide-border/70 px-5">
              <StatusRow name="Frontend" status="HEALTHY" />
              <StatusRow name="Backend" status={health.live ? 'HEALTHY' : 'UNAVAILABLE'} />
              <StatusRow name="MongoDB" status={health.ready?.dependencies.mongodb.status ?? 'NOT_CONFIGURED'} />
              <StatusRow name="Redis" status={health.ready?.dependencies.redis.status ?? 'NOT_CONFIGURED'} />
              <div className="py-4"><Link className="text-xs font-semibold text-primary transition-colors duration-200 hover:text-primary-strong focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" to="/system/health">View system health →</Link></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function StatusRow({ name, status }: { name: string; status: ServiceStatus }) {
  return <div className="flex items-center justify-between gap-4 py-3.5"><span className="text-[13px] font-medium text-text-primary">{name}</span><StatusBadge status={status} /></div>;
}
