import { X } from 'lucide-react';
import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';
import { useOverlayAccessibility } from './useOverlayAccessibility';

interface ModalShellProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  scrollable?: boolean;
  size?: 'default' | 'wide';
}

export function ModalShell({ open, title, description, children, footer, onClose, size = 'default' }: ModalShellProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useOverlayAccessibility(open, dialogRef, onClose);
  if (!open || typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-sidebar/60 p-3 backdrop-blur-[2px] sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        data-overlay-dialog
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`animate-modal-in flex max-h-[calc(100dvh-1.5rem)] w-full min-w-0 flex-col overflow-hidden rounded-card border border-border/80 bg-surface shadow-float sm:max-h-[calc(100dvh-2rem)] ${size === 'wide' ? 'max-w-[680px]' : 'max-w-lg'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border/80 px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-[-0.01em]">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1 text-xs leading-5 text-text-secondary">{description}</p> : null}
          </div>
          <Button aria-label="Close dialog" variant="ghost" size="sm" onClick={onClose}><X className="size-4" /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">{children}</div>
        {footer ? <footer className="shrink-0 border-t border-border/80 bg-surface px-5 py-3.5">{footer}</footer> : null}
      </section>
    </div>, document.body,
  );
}
