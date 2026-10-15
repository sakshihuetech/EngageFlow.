import { AppError } from '../../utils/app-error.js';

export type VariableMapping = { source: 'STATIC'; value: string } | { source: 'CONTACT_ATTRIBUTE'; key: string; fallback?: string };
export type ParameterMapping = { body?: VariableMapping[]; header?: VariableMapping[]; buttons?: Record<string, VariableMapping> };
export type ContactParameterContext = { name?: string; phoneE164?: string; email?: string; tags?: string[]; attributes?: Record<string, unknown> };
export type ResolvedParameters = { bodyVariables: string[]; headerVariables: string[]; buttonVariables: Record<string, string> };

const forbidden = /(?:^|\.)(?:__proto__|prototype|constructor|password|secret|token|credential|accessKey|apiKey)(?:\.|$)/i;
const builtins = new Set(['name', 'firstName', 'phoneE164', 'email', 'tags']);
export function safeAttributeKey(key: string) {
  return builtins.has(key) || /^attributes(?:\.[A-Za-z][A-Za-z0-9_]{0,63}){1,4}$/.test(key) && !forbidden.test(key);
}

function countVariables(text: unknown, label: string) {
  const found = [...String(text ?? '').matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]!);
  if (found.some((item) => !/^[1-9]\d*$/.test(item))) throw new AppError(409, 'UNSUPPORTED_TEMPLATE_PARAMETERS', `${label} uses an unsupported variable format.`);
  const indices = [...new Set(found.map(Number))].sort((a, b) => a - b);
  if (indices.length > 100 || indices.some((number, position) => number !== position + 1)) throw new AppError(409, 'UNSUPPORTED_TEMPLATE_PARAMETERS', `${label} variables must be sequential.`);
  return indices.length;
}

export function templateRequirements(components: unknown) {
  const parts = Array.isArray(components) ? components as Array<Record<string, unknown>> : [];
  const body = parts.find((part) => part.type === 'BODY');
  if (!body || typeof body.text !== 'string') throw new AppError(409, 'INVALID_TEMPLATE', 'Template body is missing.');
  const header = parts.find((part) => part.type === 'HEADER');
  const headerType = String(header?.format ?? 'NONE').toUpperCase();
  const buttons: number[] = [];
  const rawButtons = parts.find((part) => part.type === 'BUTTONS')?.buttons;
  if (Array.isArray(rawButtons)) rawButtons.forEach((button, index) => {
    if (button?.type === 'URL' && String(button.url ?? '').includes('{{')) {
      if (countVariables(button.url, `Button ${index + 1} URL`) !== 1) throw new AppError(409, 'UNSUPPORTED_TEMPLATE_PARAMETERS', `Button ${index + 1} URL must have one variable.`);
      buttons.push(index);
    }
  });
  return { body: countVariables(body.text, 'Body'), header: headerType === 'TEXT' ? countVariables(header?.text, 'Header') : 0, headerType, buttons };
}

function mappingEntry(value: unknown, label: string, max: number): VariableMapping {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} needs a mapping.`);
  const row = value as Record<string, unknown>;
  if (row.source === 'STATIC') {
    if (typeof row.value !== 'string' || !row.value.trim() || row.value.length > max) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} needs a static value.`);
    return { source: 'STATIC', value: row.value.trim() };
  }
  if (row.source === 'CONTACT_ATTRIBUTE') {
    if (typeof row.key !== 'string' || !safeAttributeKey(row.key)) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} needs a supported contact attribute.`);
    if (row.fallback !== undefined && (typeof row.fallback !== 'string' || row.fallback.length > max)) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} has an invalid fallback.`);
    return { source: 'CONTACT_ATTRIBUTE', key: row.key, ...(typeof row.fallback === 'string' && row.fallback.trim() ? { fallback: row.fallback.trim() } : {}) };
  }
  throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} needs a valid source.`);
}

function normalizeList(value: unknown, count: number, label: string): VariableMapping[] {
  if (count === 0 && (value === undefined || Array.isArray(value) && value.length === 0)) return [];
  if (!Array.isArray(value) || value.length !== count) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${label} requires exactly ${count} mapping${count === 1 ? '' : 's'}.`);
  return value.map((entry, index) => mappingEntry(entry, `${label} {{${index + 1}}}`, 1_024));
}

export function validateParameterMapping(components: unknown, raw: unknown, rawMedia: unknown = {}) {
  const required = templateRequirements(components);
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const legacy = 'bodyVariables' in input || 'headerVariables' in input || 'buttonVariables' in input;
  const asStatic = (value: unknown) => Array.isArray(value) ? value.map((item) => ({ source: 'STATIC', value: item })) : value;
  const body = normalizeList(legacy ? asStatic(input.bodyVariables) : input.body, required.body, 'Body');
  const header = normalizeList(legacy ? asStatic(input.headerVariables) : input.header, required.header, 'Header');
  const rawButtons = legacy ? input.buttonVariables : input.buttons;
  const supplied = rawButtons && typeof rawButtons === 'object' && !Array.isArray(rawButtons) ? rawButtons as Record<string, unknown> : {};
  const buttons: Record<string, VariableMapping> = {};
  for (const index of required.buttons) buttons[String(index)] = mappingEntry(legacy ? { source: 'STATIC', value: supplied[String(index)] } : supplied[String(index)], `Button ${index + 1} URL`, 2_000);
  if (Object.keys(supplied).some((key) => !required.buttons.includes(Number(key)))) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', 'Unexpected button mapping.');
  const mediaObject = rawMedia && typeof rawMedia === 'object' && !Array.isArray(rawMedia) ? rawMedia as Record<string, unknown> : {};
  const media = mediaObject.media && typeof mediaObject.media === 'object' ? mediaObject.media as Record<string, unknown> : undefined;
  if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(required.headerType)) {
    if (media?.type !== required.headerType || !['LINK', 'ID'].includes(String(media.source)) || typeof media.value !== 'string' || !media.value.trim() || media.value.length > 2_048) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', `${required.headerType} header needs matching send-time media.`);
    if (media.source === 'LINK') {
      try { const url = new URL(media.value); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); } catch { throw new AppError(400, 'INVALID_PARAMETER_MAPPING', 'Media needs a public HTTPS URL.'); }
    } else if (!/^\d{1,64}$/.test(media.value)) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', 'Media ID is invalid.');
  } else if (media) throw new AppError(400, 'INVALID_PARAMETER_MAPPING', 'This template does not accept header media.');
  return { mapping: { body, header, buttons }, media: media ? { type: media.type as string, source: media.source as 'LINK' | 'ID', value: media.value as string, ...(typeof media.fileName === 'string' ? { fileName: media.fileName.slice(0, 240) } : {}) } : undefined };
}

function attributeValue(contact: ContactParameterContext | undefined, key: string): unknown {
  if (!contact) return undefined;
  if (key === 'firstName') return contact.name?.trim().split(/\s+/)[0];
  if (builtins.has(key)) return contact[key as keyof ContactParameterContext];
  let current: unknown = contact.attributes;
  for (const part of key.slice('attributes.'.length).split('.')) {
    if (!current || typeof current !== 'object' || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export class ParameterResolutionError extends Error {
  readonly code = 'PARAMETER_RESOLUTION_FAILED';
  constructor(message: string) { super(message); }
}

export function resolveParameterMapping(mapping: ParameterMapping, contact?: ContactParameterContext): ResolvedParameters {
  const resolve = (entry: VariableMapping, label: string, max: number) => {
    const raw = entry.source === 'STATIC' ? entry.value : attributeValue(contact, entry.key);
    const value = Array.isArray(raw) ? raw.filter((item) => typeof item === 'string').join(', ') : typeof raw === 'string' || typeof raw === 'number' ? String(raw) : '';
    const finalValue = value.trim() || (entry.source === 'CONTACT_ATTRIBUTE' ? entry.fallback?.trim() : '') || '';
    if (!finalValue || finalValue.length > max) throw new ParameterResolutionError(`${label} has no usable contact value or fallback within the supported length.`);
    return finalValue;
  };
  return {
    bodyVariables: (mapping.body ?? []).map((entry, index) => resolve(entry, `Body {{${index + 1}}}`, 1_024)),
    headerVariables: (mapping.header ?? []).map((entry, index) => resolve(entry, `Header {{${index + 1}}}`, 1_024)),
    buttonVariables: Object.fromEntries(Object.entries(mapping.buttons ?? {}).map(([index, entry]) => [index, resolve(entry, `Button ${Number(index) + 1} URL`, 2_000)])),
  };
}
