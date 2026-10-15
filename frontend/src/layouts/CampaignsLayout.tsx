import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { PageHeader } from '../components/common/PageHeader';
import { cn } from '../utils/cn';
import { campaignArea } from './campaign-navigation';

const primaryTabs = [
  { label: 'Broadcast', path: '/whatsapp/campaigns/broadcast' },
  { label: 'API Campaigns', path: '/whatsapp/campaigns/api/campaigns' },
];

const apiTabs = [
  { label: 'Overview', path: '/whatsapp/campaigns/api/campaigns' },
  { label: 'Credentials', path: '/whatsapp/campaigns/api/credentials' },
  { label: 'Execution Logs', path: '/whatsapp/campaigns/api/executions' },
];

export function CampaignsLayout() {
  const { pathname } = useLocation();
  const { api, section } = campaignArea(pathname);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[1680px] space-y-5 sm:space-y-6">
      <PageHeader title="Campaigns" description="Manage WhatsApp campaigns from one place." />
      <nav aria-label="Campaign type" className="sticky top-16 z-10 flex flex-wrap gap-1 border-b border-border-strong/80 bg-background/95 backdrop-blur-sm">
          {primaryTabs.map((tab, index) => <NavLink
            key={tab.path}
            to={tab.path}
            aria-current={api === Boolean(index) ? 'page' : undefined}
            className={cn('rounded-t-lg border-b-2 px-4 py-3 text-sm font-semibold transition-[color,background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              api === Boolean(index) ? 'border-primary bg-primary-soft/60 text-primary-strong' : 'border-transparent text-text-secondary hover:border-border-strong hover:bg-surface/80 hover:text-text-primary')}
          >{tab.label}</NavLink>)}
      </nav>
      {api ? <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold tracking-[-0.02em] text-text-primary">API Campaigns</h2>
          <p className="mt-1 text-[13px] leading-5 text-text-secondary">Trigger approved WhatsApp templates from external systems.</p>
        </div>
        <nav aria-label="API Campaign sections" className="flex gap-1 overflow-x-auto border-b border-border/80 [scrollbar-width:thin]">
          {apiTabs.map((tab) => <NavLink
            key={tab.path}
            to={tab.path}
            aria-current={section === tab.label ? 'page' : undefined}
            className={cn('shrink-0 rounded-t-md border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-[color,background-color,border-color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
              section === tab.label ? 'border-primary text-primary-strong' : 'border-transparent text-text-secondary hover:border-border-strong hover:bg-surface/80 hover:text-text-primary')}
          >{tab.label}</NavLink>)}
        </nav>
      </section> : null}
      <div key={pathname} className="animate-campaign-in"><Outlet /></div>
    </div>
  );
}
