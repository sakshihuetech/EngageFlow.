import { ExternalLink, FileText, Image, Video } from 'lucide-react';
import { templateParts } from '../template-utils';
import type { WhatsAppTemplate } from '../types';

export function TemplatePreview({ template }: { template: WhatsAppTemplate }) {
  const parts = templateParts(template);
  return (
    <div className="rounded-card border border-[#d7e7dd] bg-[#efeae2] p-4 shadow-control">
      <div className="max-w-md rounded-xl rounded-tl-sm bg-white p-3 shadow-card">
        {parts.headerType !== 'NONE' ? <div className="mb-2 flex min-h-20 items-center justify-center rounded-lg bg-background-subtle text-text-secondary">
          {parts.headerType === 'IMAGE' ? <Image className="size-5" /> : parts.headerType === 'VIDEO' ? <Video className="size-5" /> : parts.headerType === 'DOCUMENT' ? <FileText className="size-5" /> : <span className="px-3 text-sm font-semibold">{parts.headerText}</span>}
        </div> : null}
        <p className="whitespace-pre-wrap text-sm leading-6 text-text-primary">{parts.body || 'No body text available.'}</p>
        {parts.footer ? <p className="mt-2 text-xs text-text-muted">{parts.footer}</p> : null}
        {parts.buttons.length ? <div className="mt-3 divide-y divide-border border-t border-border">{parts.buttons.map((button, index) => <div key={index} className="flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-info"><ExternalLink className="size-3" />{String(button.text ?? 'Action')}</div>)}</div> : null}
      </div>
    </div>
  );
}
