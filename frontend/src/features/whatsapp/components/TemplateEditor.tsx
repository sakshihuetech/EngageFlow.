import { useMemo, useState } from 'react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { ModalShell } from '../../../components/ui/ModalShell';
import { Select } from '../../../components/ui/Select';
import { whatsAppApi } from '../api';
import type { TemplateAuthoringInput, WhatsAppTemplate } from '../types';

const languages = ['en_IN', 'en_US', 'hi', 'bn', 'ta', 'es_ES', 'fr_FR'];
type ButtonInput = NonNullable<TemplateAuthoringInput['buttons']>[number];
function readExisting(template?: WhatsAppTemplate): TemplateAuthoringInput {
  const components = template?.components ?? [];
  const part = (type: string) => components.find((component) => component.type === type) ?? {};
  const header = part('HEADER'), body = part('BODY'), footer = part('FOOTER'), buttons = part('BUTTONS');
  const example = body.example as { body_text?: string[][] } | undefined;
  const headerExample = header.example as { header_handle?: string[] } | undefined;
  return {
    name: template?.name ?? '', language: template?.language ?? 'en_US', category: template?.category ?? 'UTILITY',
    body: typeof body.text === 'string' ? body.text : '', footer: typeof footer.text === 'string' ? footer.text : '',
    sampleValues: example?.body_text?.[0] ?? [],
    header: { type: typeof header.format === 'string' ? header.format : 'NONE', text: typeof header.text === 'string' ? header.text : '', mediaHandle: headerExample?.header_handle?.[0] ?? '' },
    buttons: Array.isArray(buttons.buttons) ? buttons.buttons.map((raw) => { const button = raw as Record<string, unknown>; return { type: String(button.type ?? 'QUICK_REPLY'), text: String(button.text ?? ''), url: String(button.url ?? ''), urlExample: Array.isArray(button.example) ? String(button.example[0] ?? '') : '', phoneNumber: String(button.phone_number ?? '') }; }) : [],
  };
}

export function TemplateEditor({ open, template, onClose, onSaved }: { open: boolean; template?: WhatsAppTemplate; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState<TemplateAuthoringInput>(() => readExisting(template));
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uploading, setUploading] = useState(false);
  const variableCount = useMemo(() => new Set([...value.body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1])).size, [value.body]);
  const update = (patch: Partial<TemplateAuthoringInput>) => setValue((current) => ({ ...current, ...patch }));
  const setButton = (index: number, patch: Partial<ButtonInput>) => update({ buttons: (value.buttons ?? []).map((button, current) => current === index ? { ...button, ...patch } : button) });
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const input = { ...value, sampleValues: Array.from({ length: variableCount }, (_, index) => value.sampleValues?.[index] ?? '') };
      if (template) await whatsAppApi.editTemplate(template.id, input); else await whatsAppApi.createTemplate(input);
      onSaved(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Template could not be saved.'); }
    finally { setBusy(false); }
  };
  const upload = async (file?: File) => {
    if (!file || !value.header?.type) return;
    setUploading(true); setError('');
    try { const result = await whatsAppApi.uploadTemplateMedia(value.header.type, file); update({ header: { ...value.header, mediaHandle: result.handle } }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Media upload failed.'); }
    finally { setUploading(false); }
  };
  return <ModalShell open={open} title={template ? 'Edit template' : 'Create template'} onClose={onClose}>
    <div className="space-y-4 text-sm">
      <div className="grid gap-3 sm:grid-cols-2"><label>Name<Input disabled={Boolean(template)} value={value.name} onChange={(event) => update({ name: event.target.value })} placeholder="order_update" /></label><label>Language<Select disabled={Boolean(template)} value={value.language} onChange={(event) => update({ language: event.target.value })}>{languages.map((language) => <option key={language}>{language}</option>)}</Select></label></div>
      <label>Category<Select disabled={Boolean(template)} value={value.category} onChange={(event) => update({ category: event.target.value })}>{['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((category) => <option key={category}>{category}</option>)}</Select></label>
      <label>Header<Select value={value.header?.type ?? 'NONE'} onChange={(event) => update({ header: { type: event.target.value } })}>{['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'].map((type) => <option key={type}>{type}</option>)}</Select></label>
      {value.header?.type === 'TEXT' ? <label>Header text<Input maxLength={60} value={value.header.text ?? ''} onChange={(event) => update({ header: { ...value.header!, text: event.target.value } })} /></label> : null}
      {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(value.header?.type ?? '') ? <label className="block">Header example file<Input type="file" accept={value.header?.type === 'IMAGE' ? '.jpg,.jpeg,.png' : value.header?.type === 'VIDEO' ? '.mp4' : '.pdf'} onChange={(event) => void upload(event.target.files?.[0])} />{uploading ? <span>Uploading to Meta…</span> : value.header?.mediaHandle ? <span className="text-success-strong">Meta example uploaded</span> : <span className="text-text-muted">Upload an example before saving.</span>}</label> : null}
      <label className="block">Body<textarea className="mt-1 min-h-28 w-full rounded-control border border-border bg-background-subtle/70 p-3 text-sm outline-none focus:border-primary" maxLength={1024} value={value.body} onChange={(event) => update({ body: event.target.value })} /></label>
      {Array.from({ length: variableCount }, (_, index) => <label key={index}>Example for {'{{'}{index + 1}{'}}'}<Input value={value.sampleValues?.[index] ?? ''} onChange={(event) => update({ sampleValues: Array.from({ length: Math.max(variableCount, value.sampleValues?.length ?? 0) }, (_, current) => current === index ? event.target.value : value.sampleValues?.[current] ?? '') })} /></label>)}
      <label>Footer<Input maxLength={60} value={value.footer ?? ''} onChange={(event) => update({ footer: event.target.value })} /></label>
      <div className="flex items-center justify-between"><span className="font-medium">Buttons</span><Button size="sm" variant="secondary" disabled={(value.buttons?.length ?? 0) >= 3} onClick={() => update({ buttons: [...(value.buttons ?? []), { type: 'QUICK_REPLY', text: '' }] })}>Add button</Button></div>
      {(value.buttons ?? []).map((button, index) => <div key={index} className="space-y-2 rounded-xl border border-border p-3"><Select value={button.type} onChange={(event) => setButton(index, { type: event.target.value })}>{['QUICK_REPLY', 'URL', 'PHONE_NUMBER'].map((type) => <option key={type}>{type}</option>)}</Select><Input value={button.text} placeholder="Button label" onChange={(event) => setButton(index, { text: event.target.value })} />{button.type === 'URL' ? <><Input value={button.url ?? ''} placeholder="https://example.com/{{1}}" onChange={(event) => setButton(index, { url: event.target.value })} /><Input value={button.urlExample ?? ''} placeholder="Full example URL if dynamic" onChange={(event) => setButton(index, { urlExample: event.target.value })} /></> : null}{button.type === 'PHONE_NUMBER' ? <Input value={button.phoneNumber ?? ''} placeholder="+1234567890" onChange={(event) => setButton(index, { phoneNumber: event.target.value })} /> : null}<Button size="sm" variant="ghost" onClick={() => update({ buttons: value.buttons?.filter((_, current) => current !== index) })}>Remove button</Button></div>)}
      {error ? <p role="alert" className="text-danger">{error}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || uploading} onClick={() => void submit()}>{busy ? 'Saving…' : template ? 'Save changes' : 'Submit to Meta'}</Button></div>
    </div>
  </ModalShell>;
}
