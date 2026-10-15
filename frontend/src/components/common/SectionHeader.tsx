import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

export function SectionHeader({ title, description, action }: SectionHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <h2 className="text-[18px] font-semibold leading-snug tracking-[-0.02em] text-text-primary">{title}</h2>
        {description ? <p className="mt-1 text-[13px] leading-5 text-text-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
