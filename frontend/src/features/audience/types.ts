export type ConsentStatus = 'OPTED_IN' | 'OPTED_OUT' | 'UNKNOWN';
export type ContactStatus = 'ACTIVE' | 'BLOCKED' | 'DELETED';
export interface Contact {
  id: string; name: string; phoneE164: string; email?: string; tags: string[]; attributes: Record<string, unknown>;
  status: ContactStatus; source: string; whatsappConsent: { status: ConsentStatus; timestamp?: string; source?: string; evidence?: string; accountId?: string };
  optedOutAt?: string; createdAt: string; updatedAt: string; restored?: boolean;
}
export type SegmentField = 'tags' | 'status' | 'source' | 'whatsappConsent.status' | 'attributes.lifecycleStage' | 'attributes.leadScore' | 'attributes.ecommerceData.totalSpend' | 'attributes.ecommerceData.totalOrders' | 'attributes.saasData.plan' | 'attributes.saasData.mrr';
export type SegmentOperator = 'CONTAINS' | 'NOT_CONTAINS' | 'EQ' | 'NE' | 'GT' | 'LT';
export interface SegmentCondition { field: SegmentField; operator: SegmentOperator; value: string | number; }
export interface Segment { id: string; name: string; type: 'STATIC' | 'DYNAMIC'; definition: { match: 'ALL' | 'ANY'; conditions: SegmentCondition[] }; status: 'ACTIVE' | 'ARCHIVED'; estimatedCount: number; createdAt: string; updatedAt: string; }
export interface CursorPage<T> { items: T[]; nextCursor: string | null; }
export interface ContactInput { name: string; phoneE164: string; email?: string; tags: string[]; attributes: Record<string, unknown>; status?: 'ACTIVE' | 'BLOCKED'; whatsappConsent: { status: ConsentStatus; source?: string; evidence?: string; timestamp?: string }; confirmConsentForActiveAccount?: boolean; }
export interface SegmentInput { name: string; type: 'STATIC' | 'DYNAMIC'; definition: { match: 'ALL' | 'ANY'; conditions: SegmentCondition[] }; }
