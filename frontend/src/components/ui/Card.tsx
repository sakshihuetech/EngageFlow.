import type { HTMLAttributes } from 'react';
import { cn } from '../../utils/cn';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-border/85 bg-surface shadow-card transition-[border-color,box-shadow] duration-200 ease-out', className)} {...props} />;
}
