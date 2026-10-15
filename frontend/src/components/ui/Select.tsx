import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../utils/cn';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-10 w-full appearance-none rounded-control border border-border bg-background-subtle/70 py-0 pl-3 pr-9 text-sm text-text-primary shadow-control outline-none transition-[color,background-color,border-color,box-shadow] duration-200 hover:border-border-strong focus:border-primary focus:bg-surface focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-background-subtle disabled:hover:border-border',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-text-muted transition-colors duration-200" />
    </div>
  );
});
