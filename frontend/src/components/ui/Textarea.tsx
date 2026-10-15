import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        'min-h-28 w-full resize-y rounded-control border border-border bg-background-subtle/70 px-3 py-2.5 text-sm text-text-primary shadow-control outline-none transition-[color,background-color,border-color,box-shadow] duration-200 placeholder:text-text-muted hover:border-border-strong focus:border-primary focus:bg-surface focus:ring-3 focus:ring-primary/10 disabled:cursor-not-allowed disabled:bg-background-subtle disabled:hover:border-border',
        className,
      )}
      {...props}
    />
  );
});
