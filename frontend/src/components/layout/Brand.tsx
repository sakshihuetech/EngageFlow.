import { Layers3 } from 'lucide-react';

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-control border border-primary-highlight/20 bg-primary text-white shadow-emerald">
        <Layers3 className="size-[18px]" aria-hidden="true" />
      </div>
      {!compact ? (
        <div>
          <div className="text-[15px] font-bold tracking-[-0.015em] text-white">EngageFlow</div>
          <div className="mt-0.5 text-[10px] font-medium tracking-[0.01em] text-slate-400">Customer Engagement Platform</div>
        </div>
      ) : null}
    </div>
  );
}
