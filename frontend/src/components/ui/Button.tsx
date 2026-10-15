import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-gradient-to-b from-primary to-primary-strong text-white shadow-emerald hover:from-primary-secondary hover:to-primary-strong hover:shadow-[0_8px_20px_rgba(22,163,74,0.22)] hover:-translate-y-px active:translate-y-px active:shadow-emerald disabled:from-primary/45 disabled:to-primary/45 disabled:shadow-none',
  secondary: 'border border-border bg-surface text-text-primary shadow-control hover:border-border-strong hover:bg-background-subtle active:bg-background-subtle',
  ghost: 'text-text-secondary hover:bg-background-subtle hover:text-text-primary active:bg-background-subtle',
  danger: 'border border-danger-border bg-danger-soft text-danger shadow-control hover:border-danger hover:bg-danger-hover active:bg-danger-hover',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 active:translate-y-px disabled:cursor-not-allowed disabled:translate-y-0',
        size === 'sm' ? 'h-9 px-3 text-xs' : 'h-10 px-4 text-[13px]',
        variants[variant],
        className,
      )}
      {...props}
    />
  );
});
