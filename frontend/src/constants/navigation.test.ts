import { describe, expect, it } from 'vitest';
import { isCampaignRoute, navigationGroups } from './navigation';
import { campaignArea } from '../layouts/campaign-navigation';

describe('navigation', () => {
  it('contains the supported product routes', () => {
    const paths = navigationGroups.flatMap((group) => group.items.map((item) => item.path));
    expect(paths).toEqual([
      '/',
      '/whatsapp/setup',
      '/whatsapp/templates',
      '/whatsapp/audience',
      '/whatsapp/campaigns',
      '/whatsapp/inbox',
      '/system/health',
      '/settings',
    ]);
  });

  it('keeps both campaign types and legacy routes under one active sidebar item', () => {
    expect(navigationGroups.some((group) => group.label === 'Developer')).toBe(false);
    expect(navigationGroups.find((group) => group.label === 'WhatsApp')?.items.map((item) => item.label)).toEqual([
      'Setup', 'Templates', 'Audience', 'Campaigns', 'Inbox',
    ]);
    for (const path of ['/whatsapp/campaigns/broadcast', '/whatsapp/campaigns/api/credentials', '/whatsapp/broadcasts/123/edit', '/developer/api-campaigns/123', '/developer/executions']) {
      expect(isCampaignRoute(path)).toBe(true);
    }
    expect(isCampaignRoute('/whatsapp/inbox')).toBe(false);
  });

  it('selects the right nested tabs for canonical and old campaign URLs', () => {
    expect(campaignArea('/whatsapp/campaigns/broadcast')).toEqual({ api: false, section: 'Overview' });
    expect(campaignArea('/whatsapp/campaigns/api/campaigns')).toEqual({ api: true, section: 'Overview' });
    expect(campaignArea('/whatsapp/campaigns/api/credentials')).toEqual({ api: true, section: 'Credentials' });
    expect(campaignArea('/developer/executions')).toEqual({ api: true, section: 'Execution Logs' });
    expect(campaignArea('/developer/api-campaigns/123')).toEqual({ api: true, section: 'Overview' });
  });
});
