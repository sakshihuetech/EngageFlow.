import type { WhatsAppTemplate } from './types';

function component(template: WhatsAppTemplate, type: string) {
  return template.components.find((item) => item.type === type);
}

export function templateParts(template: WhatsAppTemplate) {
  const header = component(template, 'HEADER');
  const body = component(template, 'BODY');
  const footer = component(template, 'FOOTER');
  const buttons = component(template, 'BUTTONS');
  return {
    headerType: String(header?.format ?? 'NONE'),
    headerText: typeof header?.text === 'string' ? header.text : '',
    body: typeof body?.text === 'string' ? body.text : '',
    footer: typeof footer?.text === 'string' ? footer.text : '',
    buttons: Array.isArray(buttons?.buttons) ? buttons.buttons as Array<Record<string, unknown>> : [],
  };
}

export function variableCount(text: string) {
  return new Set([...text.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]))).size;
}
