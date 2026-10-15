import { CircleAlert, RefreshCw } from 'lucide-react';
import { Button } from '../ui/Button';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 py-8 text-center" role="alert">
      <CircleAlert className="size-6 text-danger drop-shadow-sm" aria-hidden="true" />
      <p className="mt-3 text-sm font-semibold text-text-primary">Unable to load data</p>
      <p className="mt-1 text-[13px] leading-5 text-text-secondary">{message}</p>
      {onRetry ? <Button className="mt-4" size="sm" variant="secondary" onClick={onRetry}><RefreshCw className="size-3.5" />Retry</Button> : null}
    </div>
  );
}
