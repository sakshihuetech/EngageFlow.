import { describe, expect, it } from 'vitest';
import { buildApiCampaignSample } from './integration-sample';
import type { ApiCampaign } from './types';

const campaign = {
  slug: 'payment_success',
  templateParameterSchema: [{ position: 1, name: 'customer', example: 'Alex' }, { position: 2, name: 'order', example: '1234' }],
  templateSnapshot: { components: [{ type: 'HEADER', format: 'IMAGE' }] },
} as ApiCampaign;

describe('API Campaign integration sample', () => {
  it('uses the configured API URL and exact campaign parameters with media when required', () => {
    const sample = buildApiCampaignSample(campaign, 'https://api.example.com');
    expect(sample).toContain('https://api.example.com/api/v1/whatsapp/api-campaigns/trigger');
    expect(sample).toContain('"templateParams": [\n    "Alex",\n    "1234"\n  ]');
    expect(sample).toContain('"type": "IMAGE"');
    expect(sample).toContain('YOUR_API_KEY');
    expect(sample).not.toContain('oc_');
  });

  it('omits media for a text-only template', () => {
    const sample = buildApiCampaignSample({ ...campaign, templateSnapshot: { components: [{ type: 'BODY' }] } }, 'http://localhost:5001');
    expect(sample).not.toContain('"media"');
  });
});
