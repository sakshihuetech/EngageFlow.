export interface WhatsAppSetup {
  configured: boolean;
  connection: { status: string; onboardingMode?: string; businessName?: string; metaBusinessId?: string; webhookSubscribed?: boolean; connectedAt?: string; lastSyncedAt?: string };
  account: { id: string; wabaId: string; name?: string; currency?: string; timezone?: string; status: string } | null;
  phones: Array<{ id: string; phoneNumberId: string; displayPhoneNumber?: string; verifiedName?: string; qualityRating?: string; registrationStatus?: string; codeVerificationStatus?: string; nameStatus?: string; lastSyncedAt?: string }>;
  credential: { configured: boolean; expired?: boolean; expiresAt?: string };
  templateSummary: { total: number; approved: number; pending: number; rejected: number };
  liveSendEnabled: boolean;
  transport: 'META' | 'MOCK' | 'DISABLED';
  webhook: { configured: boolean; subscribed: boolean };
}

export interface WhatsAppTemplate {
  id: string;
  metaTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components: Array<Record<string, unknown>>;
  source: string;
  rejectionReason?: string;
  lastSyncedAt: string;
  updatedAt?: string;
}

export interface TemplateAuthoringInput {
  name: string; language: string; category: string; body: string;
  header?: { type: string; text?: string; mediaHandle?: string };
  footer?: string; sampleValues?: string[];
  buttons?: Array<{ type: string; text: string; url?: string; urlExample?: string; phoneNumber?: string }>;
}

export interface MetaLibraryItem {
  name: string; language: string; category: string; topic?: string; usecase?: string; industry?: string[];
  header?: string; body?: string; footer?: string; bodyParams?: string[]; buttons?: Array<Record<string, unknown>>;
}

export interface TestMessageStatus {
  recordId: string;
  messageId: string;
  status: string;
  acceptedAt?: string;
  sentAt?: string;
  deliveredAt?: string;
  readAt?: string;
  failedAt?: string;
  failureCode?: string;
  failureTitle?: string;
  failureMessage?: string;
  nextAction?: string;
  actionUrl?: string;
}

export interface SendTestMessageInput {
  phoneNumberId: string;
  templateRecordId: string;
  recipient: string;
  bodyVariables?: string[];
  headerVariables?: string[];
  buttonVariables?: Record<string, string>;
  media?: { type: string; source: 'LINK' | 'ID'; value: string; fileName?: string };
}
