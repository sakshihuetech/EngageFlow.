import mongoose, { type Types } from 'mongoose';
import { WhatsAppTemplate } from '../../models/whatsapp-template.model.js';
import { AppError } from '../../utils/app-error.js';
import { resolveConnectedWhatsApp } from './connection-context.service.js';
import { createMessageTemplate, deleteMessageTemplate, editMessageTemplate, fetchMessageTemplate, fetchMessageTemplateLibrary, type LibraryFilters, MetaGraphError } from './meta-graph.service.js';
import { toClientTemplate } from './template.service.js';

const categories = new Set(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
const languages = new Set(['en_IN', 'en_US', 'hi', 'bn', 'ta', 'es_ES', 'fr_FR']);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
function invalid(message: string): never { throw new AppError(400, 'INVALID_TEMPLATE', message); }

export function validateAndBuildTemplate(input: unknown) {
  const value = object(input);
  const name = string(value.name), language = string(value.language), category = string(value.category).toUpperCase(), bodyText = string(value.body);
  if (!/^[a-z0-9_]{1,512}$/.test(name)) invalid('Template name must use lowercase letters, numbers, and underscores.');
  if (!languages.has(language)) invalid('Select a supported template language.');
  if (!categories.has(category)) invalid('Select a supported template category.');
  if (!bodyText || bodyText.length > 1024) invalid('Body is required and must be at most 1024 characters.');
  if (/^\{\{\d+\}\}/.test(bodyText) || /\{\{\d+\}\}[\s.!?,;:]*$/.test(bodyText)) invalid('Body variables cannot be at the beginning or end.');
  const components: Array<Record<string, unknown>> = [];
  if (value.header !== undefined && string(object(value.header).type) !== 'NONE') {
    const header = object(value.header), type = string(header.type);
    if (type === 'TEXT') {
      const text = string(header.text);
      if (!text || text.length > 60 || /\{\{\d+\}\}|[\r\n*_~`]|\p{Extended_Pictographic}/u.test(text)) invalid('Text header must be 1–60 characters without variables, formatting, line breaks, or emoji.');
      components.push({ type: 'HEADER', format: 'TEXT', text });
    } else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(type)) {
      const handle = string(header.mediaHandle);
      if (!handle || handle.length > 4096) invalid('Media header requires a Meta upload handle.');
      components.push({ type: 'HEADER', format: type, example: { header_handle: [handle] } });
    } else invalid('Unsupported header type.');
  }
  const body: Record<string, unknown> = { type: 'BODY', text: bodyText };
  const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)].map((match) => Number(match[1]));
  const variables = [...new Set(matches)];
  if (variables.some((number, index) => number !== index + 1)) invalid('Body variables must be sequential, starting with {{1}}.');
  if (variables.length) {
    if (!Array.isArray(value.sampleValues) || value.sampleValues.length !== variables.length || value.sampleValues.some((sample) => !string(sample))) invalid('A sample value is required for every body variable.');
    body.example = { body_text: [value.sampleValues.map(string)] };
  }
  components.push(body);
  const footer = string(value.footer);
  if (footer.length > 60) invalid('Footer must be at most 60 characters.');
  if (footer) components.push({ type: 'FOOTER', text: footer });
  if (value.buttons !== undefined && !Array.isArray(value.buttons)) invalid('Buttons must be an array.');
  if (Array.isArray(value.buttons) && value.buttons.length) {
    if (value.buttons.length > 3) invalid('A maximum of three buttons is supported.');
    const buttons = value.buttons.map((raw: unknown) => {
      const button = object(raw), type = string(button.type), text = string(button.text);
      if (!['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].includes(type) || !text) invalid('Every button needs a supported type and label.');
      const result: Record<string, unknown> = { type, text };
      if (type === 'URL') {
        const url = string(button.url), matches = [...url.matchAll(/\{\{(\d+)\}\}/g)];
        if (matches.length > 1 || (matches.length === 1 && (matches[0]![1] !== '1' || !url.endsWith('{{1}}')))) invalid('Dynamic URLs support one trailing {{1}} variable.');
        try { if (!['http:', 'https:'].includes(new URL(url.replace('{{1}}', 'example')).protocol)) throw new Error(); } catch { invalid('URL button requires a valid HTTP(S) URL.'); }
        result.url = url;
        if (matches.length) {
          const example = string(button.urlExample);
          try { if (!['http:', 'https:'].includes(new URL(example).protocol)) throw new Error(); } catch { invalid('Dynamic URL requires a valid full example URL.'); }
          result.example = [example];
        }
      }
      if (type === 'PHONE_NUMBER') {
        if (!/^\+[1-9]\d{6,14}$/.test(string(button.phoneNumber))) invalid('Phone button requires an international phone number.');
        result.phone_number = string(button.phoneNumber);
      }
      return result;
    });
    components.push({ type: 'BUTTONS', buttons });
  }
  return { name, language, category, components };
}

function providerState(result: Record<string, unknown>) {
  const id = string(result.id), status = string(result.status).toUpperCase();
  if (!id || !status) throw new AppError(502, 'META_TEMPLATE_STATE_UNKNOWN', 'Meta did not return the template ID and status. Sync templates before retrying.');
  return { id, status };
}

export async function createWorkspaceTemplate(workspaceId: Types.ObjectId | string, input: unknown) {
  const payload = validateAndBuildTemplate(input);
  const { account, accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  const result = await createMessageTemplate(account.wabaId, accessToken, payload);
  const state = providerState(result);
  const saved = await WhatsAppTemplate.findOneAndUpdate({ workspaceId, whatsappAccountId: account._id, metaTemplateId: state.id }, { $set: { ...payload, metaTemplateId: state.id, status: state.status, source: 'CUSTOM', isActive: true, lastSyncedAt: new Date() }, $setOnInsert: { workspaceId, whatsappAccountId: account._id } }, { upsert: true, new: true });
  return toClientTemplate(saved!.toObject() as Record<string, unknown> & { _id: unknown });
}

export async function editWorkspaceTemplate(workspaceId: Types.ObjectId | string, recordId: string, input: unknown) {
  if (!mongoose.isValidObjectId(recordId)) invalid('Invalid template record ID.');
  const { account, accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  const existing = await WhatsAppTemplate.findOne({ _id: recordId, workspaceId, whatsappAccountId: account._id, isActive: true });
  if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template was not found in this workspace.');
  if (existing.source !== 'CUSTOM' || !['APPROVED', 'REJECTED', 'PAUSED'].includes(existing.status)) throw new AppError(409, 'TEMPLATE_NOT_EDITABLE', 'This template cannot be edited in its current state.');
  const payload = validateAndBuildTemplate({ ...object(input), name: existing.name, language: existing.language, category: existing.category });
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  await editMessageTemplate(existing.metaTemplateId, accessToken, payload.components);
  const current = await fetchMessageTemplate(existing.metaTemplateId, accessToken);
  const state = providerState(current);
  if (state.id !== existing.metaTemplateId) throw new AppError(502, 'META_TEMPLATE_MISMATCH', 'Meta returned a different template.');
  const components = Array.isArray(current.components) ? current.components : payload.components;
  const header = components.find((entry: unknown) => object(entry).type === 'HEADER') as Record<string, unknown> | undefined;
  const localHeader = payload.components.find((entry) => entry.type === 'HEADER');
  if (header && localHeader && ['IMAGE', 'VIDEO', 'DOCUMENT'].includes(string(header.format)) && !object(header.example).header_handle && localHeader.format === header.format) header.example = localHeader.example;
  const saved = await WhatsAppTemplate.findOneAndUpdate({ _id: existing._id, workspaceId, whatsappAccountId: account._id, metaTemplateId: state.id, isActive: true }, { $set: { name: string(current.name), language: string(current.language), category: string(current.category), status: state.status, components, lastSyncedAt: new Date(), ...(string(current.rejected_reason) ? { rejectionReason: string(current.rejected_reason) } : {}) }, ...(!string(current.rejected_reason) ? { $unset: { rejectionReason: '' } } : {}) }, { new: true });
  if (!saved) throw new AppError(409, 'TEMPLATE_CHANGED', 'Template changed while editing. Sync templates.');
  return toClientTemplate(saved.toObject() as Record<string, unknown> & { _id: unknown });
}

export async function deleteWorkspaceTemplate(workspaceId: Types.ObjectId | string, recordId: string) {
  if (!mongoose.isValidObjectId(recordId)) invalid('Invalid template record ID.');
  const { account, accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  const existing = await WhatsAppTemplate.findOne({ _id: recordId, workspaceId, whatsappAccountId: account._id });
  if (!existing) throw new AppError(404, 'TEMPLATE_NOT_FOUND', 'Template was not found in this workspace.');
  if (!existing.isActive) return { alreadyDeleted: true };
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  try {
    const result = await deleteMessageTemplate(account.wabaId, accessToken, existing.metaTemplateId, existing.name);
    if (result.success !== true) throw new AppError(502, 'META_DELETE_UNCONFIRMED', 'Meta did not confirm template deletion.');
  } catch (error) {
    if (!(error instanceof MetaGraphError && error.status === 404)) throw error;
  }
  const deletedAt = new Date();
  await WhatsAppTemplate.updateOne({ _id: existing._id, workspaceId, whatsappAccountId: account._id, isActive: true }, { $set: { isActive: false, deletedAt, deleteSource: 'USER', lastSyncedAt: deletedAt } });
  return { alreadyDeleted: false };
}

export async function listMetaLibrary(workspaceId: Types.ObjectId | string, filters: LibraryFilters) {
  const { accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  if (filters.category && !categories.has(filters.category)) invalid('Invalid library category.');
  if (filters.language && !languages.has(filters.language)) invalid('Invalid library language.');
  const page = await fetchMessageTemplateLibrary(accessToken, filters);
  const items = (page.data ?? []).filter((item) => string(item.name)).map((item) => ({ name: string(item.name), language: string(item.language), category: string(item.category), topic: string(item.topic), usecase: string(item.usecase), industry: Array.isArray(item.industry) ? item.industry.filter((value): value is string => typeof value === 'string').slice(0, 20) : [], header: string(item.header), body: string(item.body), footer: string(item.footer), bodyParams: Array.isArray(item.body_params) ? item.body_params.filter((value): value is string => typeof value === 'string').slice(0, 50) : [], buttons: Array.isArray(item.buttons) ? item.buttons.slice(0, 10) : [] }));
  return { items, paging: { after: page.paging?.next ? page.paging.cursors?.after : undefined, hasNext: Boolean(page.paging?.next && page.paging.cursors?.after) } };
}

export async function useMetaLibraryTemplate(workspaceId: Types.ObjectId | string, input: unknown) {
  const value = object(input), libraryTemplateName = string(value.libraryTemplateName), language = string(value.language), name = string(value.name);
  if (!libraryTemplateName || !languages.has(language) || !/^[a-z][a-z0-9_]{0,511}$/.test(name)) invalid('Select a library template, supported language, and valid new name.');
  const { account, accessToken } = await resolveConnectedWhatsApp(workspaceId, true);
  if (!accessToken) throw new AppError(409, 'META_CREDENTIAL_UNAVAILABLE', 'Meta credential is unavailable.');
  let after: string | undefined;
  let item: Record<string, unknown> | undefined;
  for (let index = 0; index < 10; index += 1) {
    const page = await fetchMessageTemplateLibrary(accessToken, { search: libraryTemplateName, language, ...(after ? { after } : {}), limit: 50 });
    item = page.data?.find((candidate) => candidate.name === libraryTemplateName && candidate.language === language);
    if (item) break;
    after = page.paging?.next ? page.paging.cursors?.after : undefined;
    if (!after) break;
  }
  if (!item) throw new AppError(404, 'LIBRARY_TEMPLATE_NOT_FOUND', 'Selected Meta library template is no longer available.');
  const category = string(item.category).toUpperCase();
  if (!categories.has(category)) invalid('Library template category is unsupported.');
  const payload: Record<string, unknown> = { name, language, category, library_template_name: libraryTemplateName };
  if (value.bodyInputs !== undefined) {
    const inputs = object(value.bodyInputs), allowed = new Set(['add_contact_number', 'add_learn_more_link', 'add_security_recommendation', 'add_track_package_link', 'code_expiration_minutes']);
    for (const [key, entry] of Object.entries(inputs)) {
      if (!allowed.has(key)) invalid('Unsupported library body input.');
      if (key === 'code_expiration_minutes' ? !Number.isInteger(entry) || Number(entry) < 1 || Number(entry) > 90 : typeof entry !== 'boolean') invalid('Invalid library body input.');
    }
    if (Object.keys(inputs).length) payload.library_template_body_inputs = inputs;
  }
  if (value.bodyParamInputs !== undefined) {
    if (!Array.isArray(value.bodyParamInputs) || value.bodyParamInputs.some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).some((key) => !['param_name', 'body_text_named_params', 'positional_params'].includes(key)))) invalid('Invalid library body parameter inputs.');
    payload.library_template_body_param_inputs = value.bodyParamInputs.map((raw: unknown) => {
      const entry = object(raw), result: Record<string, unknown> = {};
      if (entry.param_name !== undefined) {
        if (!string(entry.param_name)) invalid('Library parameter names must be non-empty strings.');
        result.param_name = string(entry.param_name).slice(0, 512);
      }
      for (const key of ['body_text_named_params', 'positional_params']) if (entry[key] !== undefined) {
        if (!Array.isArray(entry[key]) || entry[key].some((item: unknown) => typeof item !== 'string')) invalid('Library parameter values must be arrays of strings.');
        result[key] = (entry[key] as string[]).map((item) => item.slice(0, 512));
      }
      return result;
    });
  }
  if (value.buttonInputs !== undefined) {
    if (!Array.isArray(value.buttonInputs)) invalid('Library button inputs must be an array.');
    const expected = Array.isArray(item.buttons) ? item.buttons.filter((button) => ['URL', 'PHONE_NUMBER'].includes(string(object(button).type))) : [];
    if (value.buttonInputs.length !== expected.length) invalid('Provide configuration for each library URL or phone button.');
    payload.library_template_button_inputs = value.buttonInputs.map((raw, index) => {
      const entry = object(raw), type = string(entry.type);
      if (type !== string(object(expected[index]).type)) invalid('Library button configuration does not match the selected template.');
      if (type === 'PHONE_NUMBER') {
        if (!/^\+[1-9]\d{6,14}$/.test(string(entry.phone_number))) invalid('Library phone button requires an international number.');
        return { type, phone_number: string(entry.phone_number) };
      }
      const url = object(entry.url), base = string(url.base_url);
      try { if (!['http:', 'https:'].includes(new URL(base).protocol)) throw new Error(); } catch { invalid('Library URL button requires an HTTP(S) base URL.'); }
      return { type, url: { base_url: base, ...(string(url.url_suffix_example) ? { url_suffix_example: string(url.url_suffix_example).slice(0, 2048) } : {}) } };
    });
  }
  const result = await createMessageTemplate(account.wabaId, accessToken, payload);
  const state = providerState(result);
  const components = [
    ...(string(item.header) ? [{ type: 'HEADER', format: 'TEXT', text: string(item.header) }] : []),
    ...(string(item.body) ? [{ type: 'BODY', text: string(item.body) }] : []),
    ...(string(item.footer) ? [{ type: 'FOOTER', text: string(item.footer) }] : []),
    ...(Array.isArray(item.buttons) && item.buttons.length ? [{ type: 'BUTTONS', buttons: item.buttons }] : []),
  ];
  const saved = await WhatsAppTemplate.findOneAndUpdate({ workspaceId, whatsappAccountId: account._id, metaTemplateId: state.id }, { $set: { name, language, category: string(result.category) || category, status: state.status, components, source: 'META_LIBRARY', libraryTemplateName, isActive: true, lastSyncedAt: new Date() }, $setOnInsert: { workspaceId, whatsappAccountId: account._id } }, { upsert: true, new: true });
  return toClientTemplate(saved!.toObject() as Record<string, unknown> & { _id: unknown });
}
