import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        'h-10 w-full rounded-control border border-border bg-background-subtle/70 px-3 text-sm text-text-primary shadow-control outline-none transition-[color,background-color,border-color,box-shadow] duration-200 placeholder:text-text-muted hover:border-border-strong focus:border-primary focus:bg-surface focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-background-subtle disabled:hover:border-border',
        className,
      )}
      {...props}
    />
  );
});
