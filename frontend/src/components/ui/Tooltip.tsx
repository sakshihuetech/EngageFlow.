import type { ReactNode } from 'react';

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute right-0 top-full z-50 mt-2 translate-y-1 whitespace-nowrap rounded-lg border border-white/10 bg-sidebar px-2.5 py-1.5 text-[11px] font-medium text-white opacity-0 shadow-float transition-[opacity,transform,visibility] duration-150 group-hover/tooltip:visible group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100 group-focus-within/tooltip:visible group-focus-within/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}
