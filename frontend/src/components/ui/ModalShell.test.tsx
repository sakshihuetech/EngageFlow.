import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { ModalShell } from './ModalShell';

vi.mock('react-dom', () => ({ createPortal: (content: ReactNode) => content }));

afterEach(() => vi.unstubAllGlobals());

describe('ModalShell viewport structure', () => {
  it('keeps the header and actions outside the bounded scrolling body', () => {
    vi.stubGlobal('document', { body: {} });
    const html = renderToStaticMarkup(
      <ModalShell open title="Create API Campaign" description="Details" onClose={() => {}} footer={<button>Create Campaign</button>}>
        <input aria-label="Campaign name" />
      </ModalShell>,
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('100dvh-1.5rem');
    expect(html).toContain('overflow-y-auto');
    expect(html.indexOf('Create API Campaign')).toBeLessThan(html.indexOf('Campaign name'));
    expect(html.indexOf('Campaign name')).toBeLessThan(html.indexOf('Create Campaign'));
  });
});
