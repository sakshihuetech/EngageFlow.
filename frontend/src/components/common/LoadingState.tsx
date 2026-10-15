export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-40 items-center justify-center gap-3 text-[13px] font-medium text-text-secondary" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-primary" aria-hidden="true" />
      {label}
    </div>
  );
}
