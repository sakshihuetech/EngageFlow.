import { useState } from 'react';
import { Outlet, ScrollRestoration } from 'react-router-dom';
import { DrawerShell } from '../components/ui/DrawerShell';
import { Sidebar } from '../components/layout/Sidebar';
import { SidebarNav } from '../components/layout/SidebarNav';
import { Topbar } from '../components/layout/Topbar';

export function AppLayout() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  return (
    <div className="app-surface min-h-screen bg-background text-text-primary selection:bg-primary selection:text-white">
      <Sidebar />
      <DrawerShell open={mobileNavOpen} title="EngageFlow" onClose={() => setMobileNavOpen(false)}>
        <SidebarNav onNavigate={() => setMobileNavOpen(false)} />
      </DrawerShell>
      <div className="lg:pl-sidebar">
        <Topbar onMenuOpen={() => setMobileNavOpen(true)} />
        <main className="mx-auto w-full min-w-0 max-w-[1840px] px-4 py-6 sm:px-6 sm:py-7 lg:px-8 lg:py-8 xl:px-10">
          <Outlet />
        </main>
      </div>
      <ScrollRestoration />
    </div>
  );
}
