import { cn } from '../../utils/cn';
import type { ServiceStatus } from '../../services/api/types';
import type { BroadcastStatus, RecipientStatus } from '../../features/broadcasts/types';

type BadgeStatus = ServiceStatus | BroadcastStatus | RecipientStatus | 'ACTIVE' | 'INACTIVE' | 'CONNECTED' | 'DISCONNECTED' | 'NOT_CONNECTED' | 'UNVERIFIED' | 'SUBSCRIPTION_RECORDED' | 'REQUIRES_ACTION' | 'ERROR' | 'APPROVED' | 'REJECTED' | 'DISABLED' | 'BLOCKED' | 'DELETED' | 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN' | 'STATIC' | 'DYNAMIC' | 'ARCHIVED' | 'RECEIVED' | 'OPEN' | 'CLOSED' | 'LIVE' | 'REVOKED';

const styles: Record<BadgeStatus, string> = {
  HEALTHY: 'bg-success-soft text-success-strong',
  STALE: 'bg-warning-soft text-warning',
  DELIVERED: 'bg-success-soft text-success-strong',
  READ: 'bg-info-soft text-info',
  ACTIVE: 'bg-success-soft text-success-strong',
  CONNECTED: 'bg-success-soft text-success-strong',
  SUBSCRIPTION_RECORDED: 'bg-info-soft text-info',
  UNVERIFIED: 'bg-warning-soft text-warning',
  NOT_CONNECTED: 'bg-neutral-soft text-text-secondary',
  APPROVED: 'bg-success-soft text-success-strong',
  DEGRADED: 'bg-warning-soft text-warning',
  QUEUED: 'bg-warning-soft text-warning',
  ACCEPTED: 'bg-info-soft text-info',
  SENT: 'bg-info-soft text-info',
  UNAVAILABLE: 'bg-danger-soft text-danger',
  FAILED: 'bg-danger-soft text-danger',
  ERROR: 'bg-danger-soft text-danger',
  REJECTED: 'bg-danger-soft text-danger',
  NOT_CONFIGURED: 'bg-neutral-soft text-text-secondary',
  NOT_VERIFIED: 'bg-neutral-soft text-text-secondary',
  INACTIVE: 'bg-neutral-soft text-text-secondary',
  DISCONNECTED: 'bg-neutral-soft text-text-secondary',
  DISABLED: 'bg-neutral-soft text-text-secondary',
  BLOCKED: 'bg-danger-soft text-danger',
  DELETED: 'bg-neutral-soft text-text-secondary',
  OPTED_IN: 'bg-success-soft text-success-strong',
  OPTED_OUT: 'bg-danger-soft text-danger',
  UNKNOWN: 'bg-neutral-soft text-text-secondary',
  STATIC: 'bg-neutral-soft text-text-secondary',
  DYNAMIC: 'bg-info-soft text-info',
  ARCHIVED: 'bg-neutral-soft text-text-secondary',
  RECEIVED: 'bg-info-soft text-info',
  OPEN: 'bg-success-soft text-success-strong',
  CLOSED: 'bg-neutral-soft text-text-secondary',
  LIVE: 'bg-success-soft text-success-strong',
  REVOKED: 'bg-neutral-soft text-text-secondary',
  REQUIRES_ACTION: 'bg-warning-soft text-warning',
  DRAFT: 'bg-neutral-soft text-text-secondary',
  SNAPSHOTTING: 'bg-info-soft text-info',
  READY: 'bg-info-soft text-info',
  SCHEDULED: 'bg-warning-soft text-warning',
  PROCESSING: 'bg-info-soft text-info',
  PAUSED: 'bg-warning-soft text-warning',
  COMPLETED: 'bg-success-soft text-success-strong',
  COMPLETED_WITH_ERRORS: 'bg-warning-soft text-warning',
  CANCELLED: 'bg-neutral-soft text-text-secondary',
  PENDING: 'bg-neutral-soft text-text-secondary',
  SENDING: 'bg-info-soft text-info',
  RETRY_WAIT: 'bg-warning-soft text-warning',
  SKIPPED: 'bg-neutral-soft text-text-secondary',
};

function labelFor(status: BadgeStatus) {
  return status
    .toLowerCase()
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function StatusBadge({ status }: { status: BadgeStatus }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border border-current/15 px-2.5 py-1 text-[11px] font-semibold leading-none tracking-[0.01em]', styles[status])}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {labelFor(status)}
    </span>
  );
}
