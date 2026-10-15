import { NavLink, useLocation } from 'react-router-dom';
import { isCampaignRoute, navigationGroups } from '../../constants/navigation';
import { cn } from '../../utils/cn';

export function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const { pathname } = useLocation();

  return (
    <nav aria-label="Primary navigation" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {navigationGroups.map((group, groupIndex) => (
        <div key={group.label ?? `group-${groupIndex}`} className={groupIndex ? 'mt-5' : ''}>
          {group.label ? <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{group.label}</div> : null}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const Icon = item.icon;
              const campaignActive = item.path === '/whatsapp/campaigns' && isCampaignRoute(pathname);
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  onClick={onNavigate}
                  className={({ isActive }) => cn(
                    'group flex items-center gap-3 rounded-control border border-transparent px-3 py-2.5 text-[13px] font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-highlight/50 active:translate-x-px',
                    isActive || campaignActive ? 'border-primary-highlight/20 bg-gradient-to-r from-primary/25 to-primary/10 text-white shadow-sidebar-active' : 'text-slate-400 hover:border-white/[0.04] hover:bg-white/[0.06] hover:text-slate-100',
                  )}
                >
                  <Icon className="size-[17px] shrink-0 transition-[color,transform] duration-200 group-hover:translate-x-px group-hover:text-primary-highlight" aria-hidden="true" />
                  {item.label}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
