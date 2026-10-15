import { Brand } from './Brand';
import { SidebarNav } from './SidebarNav';

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-sidebar flex-col border-r border-white/[0.06] bg-sidebar shadow-[8px_0_28px_rgba(2,6,23,0.04)] lg:flex">
      <div className="flex h-16 items-center border-b border-white/[0.06] px-5"><Brand /></div>
      <SidebarNav />
      <div className="border-t border-white/[0.06] px-5 py-4 text-[11px] font-medium tracking-[0.01em] text-slate-500">Foundation workspace</div>
    </aside>
  );
}
