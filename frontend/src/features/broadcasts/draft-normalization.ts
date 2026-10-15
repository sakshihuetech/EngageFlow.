import type { BroadcastCampaign, BroadcastMedia, BroadcastOptions, BroadcastParameterMapping, BroadcastVariableMapping } from './types';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const strings = (value: unknown) => array(value).filter((item): item is string => typeof item === 'string');
const text = (value: unknown) => typeof value === 'string' ? value : '';
export const emptyMapping = (): BroadcastParameterMapping => ({ body: [], header: [], buttons: {} });
export const emptyValue = (): BroadcastVariableMapping => ({ source: 'STATIC', value: '' });

function variableCount(value: unknown) {
  const matches = [...String(value ?? '').matchAll(/\{\{([^{}]+)\}\}/g)].map(match => match[1]!);
  if (matches.some(item => !/^[1-9]\d*$/.test(item))) throw new Error('This template has an unsupported variable format.');
  const indices = [...new Set(matches.map(Number))].sort((a, b) => a - b);
  if (indices.some((number, index) => number !== index + 1)) throw new Error('Template variables must be numbered sequentially.');
  return indices.length;
}

export function requirements(components: unknown) {
  const parts = array(components).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)));
  const body = parts.find(item => item.type === 'BODY');
  const header = parts.find(item => item.type === 'HEADER');
  const buttonRows = array(parts.find(item => item.type === 'BUTTONS')?.buttons).map(object);
  const headerType = String(header?.format ?? 'NONE').toUpperCase();
  const dynamicButtons = buttonRows.flatMap((item, index) => item.type === 'URL' && String(item.url ?? '').includes('{{') ? [index] : []);
  for (const index of dynamicButtons) if (variableCount(buttonRows[index]?.url) !== 1) throw new Error(`Button ${index + 1} URL must have one variable.`);
  return { error: undefined as string | undefined, body: variableCount(body?.text), header: headerType === 'TEXT' ? variableCount(header?.text) : 0, mediaType: ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(headerType) ? headerType as BroadcastMedia['type'] : undefined, buttons: dynamicButtons };
}

export function normalizeBroadcastOptions(input?: BroadcastOptions): BroadcastOptions | undefined {
  if (!input) return undefined;
  return {
    ...input,
    templates: array(input.templates).filter(item => typeof object(item).id === 'string').map(item => ({ ...object(item), components: array(object(item).components) })) as BroadcastOptions['templates'],
    segments: array(input.segments).filter(item => typeof object(item).id === 'string').map(item => {
      const segment = object(item);
      return { ...segment, type: typeof segment.type === 'string' ? segment.type : 'STATIC', estimatedCount: typeof segment.estimatedCount === 'number' ? segment.estimatedCount : 0 };
    }) as BroadcastOptions['segments'],
    attributeKeys: strings(input.attributeKeys),
  };
}

function mappingRow(value: unknown): BroadcastVariableMapping {
  const row = object(value);
  return row.source === 'CONTACT_ATTRIBUTE'
    ? { source: 'CONTACT_ATTRIBUTE', key: text(row.key), ...(typeof row.fallback === 'string' ? { fallback: row.fallback } : {}) }
    : { source: 'STATIC', value: text(row.value) };
}

export function normalizeParameterMapping(value: unknown): BroadcastParameterMapping {
  const mapping = object(value);
  const list = (modern: unknown, legacy: unknown) => Array.isArray(modern) ? modern.map(mappingRow) : array(legacy).map(value => ({ source: 'STATIC' as const, value: text(value) }));
  const modernButtons = object(mapping.buttons);
  const legacyButtons = object(mapping.buttonVariables);
  return {
    body: list(mapping.body, mapping.bodyVariables),
    header: list(mapping.header, mapping.headerVariables),
    buttons: Object.fromEntries(Object.entries({ ...legacyButtons, ...modernButtons }).map(([index, value]) => [index, Object.hasOwn(modernButtons, index) ? mappingRow(value) : { source: 'STATIC' as const, value: text(value) }])),
  };
}

function mediaValue(value: unknown): BroadcastMedia | null {
  const media = object(value);
  if (!['IMAGE','VIDEO','DOCUMENT'].includes(String(media.type)) || !['LINK','ID'].includes(String(media.source))) return null;
  return { type: media.type as BroadcastMedia['type'], source: media.source as BroadcastMedia['source'], value: text(media.value), ...(typeof media.fileName === 'string' ? { fileName: media.fileName } : {}) };
}

function timezone(value: unknown, fallback: string) {
  try { if (typeof value === 'string' && value) { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); return value; } } catch { /* Missing/invalid legacy timezone uses the model's UTC default. */ }
  return fallback;
}

export function scheduleLocalValue(scheduledAt: string | null, zone: string): string {
  if (!scheduledAt) return '';
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** Read-side adaptation only: never mutates campaign/options or writes defaults to MongoDB. */
export function normalizeBroadcastDraft(campaign?: BroadcastCampaign, options?: BroadcastOptions, browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC') {
  const raw = object(campaign);
  const audience = object(raw.audienceDefinition);
  const source = String(audience.source ?? (campaign ? 'CONTACTS' : 'SEGMENT')).toUpperCase();
  const audienceSource: 'CONTACTS' | 'PASTED' | 'SEGMENT' = source === 'CONTACTS' || source === 'PASTED' ? source : 'SEGMENT';
  const mapping = normalizeParameterMapping(raw.parameterMapping);
  const selectedTemplate = normalizeBroadcastOptions(options)?.templates.find(item => item.id === raw.whatsAppTemplateId);
  let media = mediaValue(object(raw.mediaMapping).media);
  if (selectedTemplate) {
    try {
      const needed = requirements(selectedTemplate.components);
      // Missing required mappings must be editable blank inputs, not fabricated send values.
      while (mapping.body.length < needed.body) mapping.body.push(emptyValue());
      while (mapping.header.length < needed.header) mapping.header.push(emptyValue());
      for (const index of needed.buttons) mapping.buttons[String(index)] ??= emptyValue();
      if (!media && needed.mediaType) media = { type: needed.mediaType, source: 'LINK', value: '' };
    } catch { /* The wizard displays the existing unsupported-template error. */ }
  }
  const zone = timezone(raw.timezone, campaign ? 'UTC' : browserTimezone);
  const scheduledAt = typeof raw.scheduledAt === 'string' && !Number.isNaN(Date.parse(raw.scheduledAt)) ? raw.scheduledAt : null;
  return {
    name: text(raw.name), templateId: text(raw.whatsAppTemplateId),
    audienceSource, segmentId: audienceSource === 'SEGMENT' ? text(audience.segmentId) : '',
    selectedContactIds: audienceSource === 'CONTACTS' ? strings(audience.contactIds) : [],
    pastedPhones: audienceSource === 'PASTED' ? strings(audience.phones).join('\n') : '',
    parameterMapping: mapping, mediaMapping: media ? { media } : {}, media,
    templateParams: array(raw.templateParams),
    templateSnapshot: { ...object(raw.templateSnapshot), components: array(object(raw.templateSnapshot).components) },
    scheduledAt, scheduledLocal: scheduleLocalValue(scheduledAt, zone), timezone: zone,
  };
}

export function futureSchedule(value: string, zone: string, now = Date.now()) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return false;
  const wanted = match.slice(1).map(Number);
  const target = Date.UTC(wanted[0]!, wanted[1]! - 1, wanted[2]!, wanted[3]!, wanted[4]!);
  let timestamp = target;
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let iteration = 0; iteration < 3; iteration++) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(part => [part.type, Number(part.value)]));
    timestamp += target - Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!);
  }
  return timestamp > now + 5000 && scheduleLocalValue(new Date(timestamp).toISOString(), zone) === value;
}
