import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { useOverlayAccessibility } from './useOverlayAccessibility';

interface DrawerShellProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}

export function DrawerShell({ open, title, children, onClose }: DrawerShellProps) {
  const drawerRef = useRef<HTMLElement>(null);
  useOverlayAccessibility(open, drawerRef, onClose);
  useEffect(() => {
    if (!open) return;
    const desktop = window.matchMedia('(min-width: 1024px)');
    const closeOnDesktop = () => { if (desktop.matches) onClose(); };
    desktop.addEventListener('change', closeOnDesktop);
    closeOnDesktop();
    return () => desktop.removeEventListener('change', closeOnDesktop);
  }, [open, onClose]);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 lg:hidden">
      <button className="absolute inset-0 bg-sidebar/60 backdrop-blur-[2px] transition-opacity duration-200" aria-label="Close navigation" onClick={onClose} />
      <aside ref={drawerRef} data-overlay-dialog role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="animate-drawer-in relative flex h-full w-[min(280px,calc(100vw-2rem))] flex-col overflow-hidden border-r border-white/[0.06] bg-sidebar shadow-float">
        <div className="flex h-16 items-center justify-between border-b border-white/[0.06] px-4 text-white">
          <span className="font-semibold tracking-[-0.01em]">{title}</span>
          <Button aria-label="Close navigation" variant="ghost" size="sm" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={onClose}>
            <X className="size-5" />
          </Button>
        </div>
        {children}
      </aside>
    </div>, document.body,
  );
}
