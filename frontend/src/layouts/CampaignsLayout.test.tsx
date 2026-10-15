import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { CampaignsLayout } from './CampaignsLayout';

function render(path: string) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<CampaignsLayout />}>
          {[
            '/whatsapp/campaigns/broadcast',
            '/whatsapp/campaigns/broadcast/new',
            '/whatsapp/campaigns/broadcast/:id',
            '/whatsapp/campaigns/api/campaigns',
            '/whatsapp/campaigns/api/campaigns/:id',
            '/whatsapp/campaigns/api/credentials',
            '/whatsapp/campaigns/api/executions',
            '/whatsapp/broadcasts',
            '/developer/api-campaigns',
            '/developer/api-credentials',
            '/developer/executions',
          ].map((route) => <Route key={route} path={route} element={<div>Campaign content</div>} />)}
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('shared Campaigns layout', () => {
  it.each([
    '/whatsapp/campaigns/broadcast', '/whatsapp/campaigns/broadcast/new', '/whatsapp/campaigns/broadcast/123',
    '/whatsapp/campaigns/api/campaigns', '/whatsapp/campaigns/api/campaigns/123',
    '/whatsapp/campaigns/api/credentials', '/whatsapp/campaigns/api/executions',
    '/whatsapp/broadcasts', '/developer/api-campaigns', '/developer/api-credentials', '/developer/executions',
  ])('keeps the sticky primary tabs on %s', (path) => {
    const html = render(path);
    expect(html).toContain('aria-label="Campaign type"');
    expect(html).toContain('sticky top-16');
    expect(html).toContain('>Broadcast</a>');
    expect(html).toContain('>API Campaigns</a>');
    expect(html).toContain('Campaign content');
  });

  it('shows secondary tabs only in the API Campaign area', () => {
    expect(render('/whatsapp/campaigns/broadcast')).not.toContain('aria-label="API Campaign sections"');
    const api = render('/whatsapp/campaigns/api/executions');
    expect(api).toContain('aria-label="API Campaign sections"');
    expect(api).toContain('>Overview</a>');
    expect(api).toContain('>Credentials</a>');
    expect(api).toContain('>Execution Logs</a>');
  });
});
