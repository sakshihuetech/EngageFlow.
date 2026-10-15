import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-card border border-border/80 bg-background-subtle/80 text-text-secondary shadow-control">
        <Inbox className="size-5" aria-hidden="true" />
      </div>
      <h3 className="mt-4 text-[15px] font-semibold tracking-[-0.01em] text-text-primary">{title}</h3>
      <p className="mt-1.5 max-w-md text-[13px] leading-5 text-text-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
