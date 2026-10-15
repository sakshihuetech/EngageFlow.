import { Bell, Menu, Search } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { isCampaignRoute, routeLabels } from '../../constants/navigation';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

export function Topbar({ onMenuOpen }: { onMenuOpen: () => void }) {
  const { pathname } = useLocation();
  const routeLabel = routeLabels[pathname]
    ?? (pathname === '/whatsapp/broadcasts/new' || pathname === '/whatsapp/campaigns/broadcast/new'
      ? 'New Broadcast' : isCampaignRoute(pathname) ? 'Campaigns' : 'Page');

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border/80 bg-surface/90 px-4 shadow-topbar backdrop-blur-xl sm:px-6 lg:px-8">
      <Button aria-label="Open navigation" variant="ghost" className="lg:hidden" onClick={onMenuOpen}><Menu className="size-5" /></Button>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">EngageFlow</p>
        <p className="truncate text-[13px] font-semibold text-text-primary">{routeLabel}</p>
      </div>
      <div className="ml-auto hidden max-w-xs flex-1 sm:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input disabled aria-label="Global search coming later" placeholder="Search — coming later" className="h-9 w-full rounded-control border border-border/80 bg-background-subtle/70 pl-9 pr-3 text-xs text-text-secondary shadow-control outline-none transition-[background-color,border-color,box-shadow] duration-200 placeholder:text-text-muted focus:border-primary focus:bg-surface focus:ring-3 focus:ring-primary/10" />
        </div>
      </div>
      <span className="hidden rounded-lg border border-border/80 bg-background-subtle/70 px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary shadow-control md:inline-flex">Workspace not configured</span>
      <Tooltip label="Notifications coming later">
        <Button disabled aria-label="Notifications coming later" variant="ghost" size="sm"><Bell className="size-4" /></Button>
      </Tooltip>
      <div className="grid size-8 place-items-center rounded-full border border-slate-700 bg-sidebar text-[11px] font-bold text-white shadow-control ring-2 ring-slate-100" aria-label="Workspace avatar">EF</div>
    </header>
  );
}
