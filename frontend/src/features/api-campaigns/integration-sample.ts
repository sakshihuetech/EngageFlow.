import type { ApiCampaign } from './types';

export const apiCampaignTriggerPath = '/api/v1/whatsapp/api-campaigns/trigger';

export function buildApiCampaignSample(campaign: ApiCampaign, apiBaseUrl: string) {
  const body: Record<string, unknown> = {
    campaign: campaign.slug,
    destination: '+15551234567',
    templateParams: campaign.templateParameterSchema.map((entry, index) => entry.example || `value_${index + 1}`),
    userName: 'Example customer',
    tags: ['integration'],
    attributes: { customerTier: 'gold' },
    source: 'billing-service',
  };
  const header = campaign.templateSnapshot.components?.find((component) => component.type === 'HEADER');
  if (header && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(String(header.format))) {
    body.media = { type: header.format, url: 'https://example.com/media-file' };
  }
  const json = JSON.stringify(body, null, 2).replace(/'/g, "'\\''");
  return `curl -X POST '${apiBaseUrl}${apiCampaignTriggerPath}' \\\n+  -H 'Authorization: Bearer YOUR_API_KEY' \\\n+  -H 'Idempotency-Key: order-123-event-1' \\\n+  -H 'Content-Type: application/json' \\\n+  -d '${json}'`;
}
