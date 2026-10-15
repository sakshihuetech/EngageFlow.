import type { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div>
        <h1 className="text-[27px] font-bold leading-[1.2] tracking-[-0.03em] text-text-primary sm:text-[29px]">{title}</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-text-secondary">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}
