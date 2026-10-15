export type BroadcastStatus = 'DRAFT' | 'SNAPSHOTTING' | 'READY' | 'SCHEDULED' | 'QUEUED' | 'PROCESSING' | 'PAUSED' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED' | 'CANCELLED';
export type RecipientStatus = 'PENDING' | 'QUEUED' | 'SENDING' | 'ACCEPTED' | 'SENT' | 'DELIVERED' | 'READ' | 'RETRY_WAIT' | 'FAILED' | 'SKIPPED' | 'CANCELLED';

export interface BroadcastCounters {
  total: number;
  pending: number;
  queued: number;
  accepted: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export interface BroadcastCampaign {
  id: string;
  name: string;
  channel: 'WHATSAPP';
  type: 'BROADCAST';
  status: BroadcastStatus;
  whatsappAccountId: string;
  phoneNumberId: string;
  whatsAppTemplateId?: string;
  templateSnapshot?: { name?: string; language?: string; category?: string; components?: unknown[] };
  parameterMapping?: Partial<BroadcastParameterMapping> & { bodyVariables?: string[]; headerVariables?: string[]; buttonVariables?: Record<string, string> };
  templateParams?: unknown[];
  mediaMapping?: { media?: BroadcastMedia };
  audienceDefinition?: { source?: string; segmentId?: string; contactIds?: string[]; phones?: string[] };
  audienceSnapshotCount: number;
  sourceCampaignId?: string;
  retargetingFilter?: 'READ' | 'DELIVERED_NOT_READ' | 'FAILED';
  retargetingSourceAccountId?: string;
  retargetingSourceWabaId?: string;
  snapshotAt?: string;
  sendMode: 'DRAFT' | 'SEND_NOW' | 'SCHEDULE';
  scheduledAt?: string;
  timezone: string;
  counters: BroadcastCounters;
  launchKey?: string;
  retryBatchId?: string;
  retryRequestedAt?: string;
  retryLastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BroadcastOptions {
  configured: boolean;
  reason?: 'NO_WHATSAPP_ACCOUNT' | 'MULTIPLE_WHATSAPP_ACCOUNTS' | 'NO_SENDING_PHONE' | 'MULTIPLE_SENDING_PHONES';
  templates: Array<{ id: string; name: string; language: string; category: string; components: unknown[] }>;
  segments: Array<{ id: string; name: string; type: 'STATIC' | 'DYNAMIC'; estimatedCount: number }>;
  attributeKeys: string[];
}

export type BroadcastVariableMapping = { source: 'STATIC'; value: string } | { source: 'CONTACT_ATTRIBUTE'; key: string; fallback?: string };
export interface BroadcastParameterMapping { body: BroadcastVariableMapping[]; header: BroadcastVariableMapping[]; buttons: Record<string, BroadcastVariableMapping> }
export interface BroadcastMedia { type: 'IMAGE' | 'VIDEO' | 'DOCUMENT'; source: 'LINK' | 'ID'; value: string; fileName?: string }

export interface BroadcastReadiness {
  valid: boolean;
  campaignStatus: BroadcastStatus;
  queueReady: boolean;
  queueReason?: string;
  liveSendEnabled: boolean;
  transportConfigured: boolean;
  audienceCount: number;
  reason?: string;
}

export interface BroadcastAnalytics {
  campaignId: string;
  status: BroadcastStatus;
  counters: BroadcastCounters;
  deliveryRate: number;
  readRate: number;
  failureRate: number;
  updatedAt?: string;
}

export interface BroadcastRecipient {
  id: string;
  contactId?: string;
  recipientPhone: string;
  contactName?: string;
  status: RecipientStatus;
  attemptCount: number;
  acceptedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  failureCode?: string;
  failureTitle?: string;
  failureMessage?: string;
  failureSubcode?: number;
  failureSource?: string;
  retrySafety?: string;
  nextEligibleRetryAt?: string;
  retryExclusionReason?: string;
  attemptHistory?: Array<{ attempt: number; at: string; status: string; failureCode?: string; failureSubcode?: number; failureTitle?: string; failureMessage?: string; failureSource?: string; retrySafety?: string }>;
}

export interface BroadcastRetryPreview {
  campaignStatus: BroadcastStatus;
  totalFailed: number;
  eligible: number;
  temporaryRestrictions: number;
  permanentFailures: number;
  uncertainOutcomes: number;
  exclusionReasons: Record<string, number>;
  senderReady: boolean;
  senderReason?: string;
  queueReady: boolean;
  queueReason?: string;
  canRetry: boolean;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CreateBroadcastInput {
  name: string;
  whatsAppTemplateId: string;
  audienceDefinition:
    | { source: 'SEGMENT'; segmentId: string }
    | { source: 'CONTACTS'; contactIds: string[] }
    | { source: 'PASTED'; phones: string[] };
  timezone: string;
  parameterMapping: BroadcastParameterMapping;
  mediaMapping?: { media: BroadcastMedia };
}
