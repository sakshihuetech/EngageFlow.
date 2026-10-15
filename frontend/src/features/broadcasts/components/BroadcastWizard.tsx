import { Check, ChevronLeft, ChevronRight, FileText, Rocket, Save } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ErrorState } from '../../../components/common/ErrorState';
import { LoadingState } from '../../../components/common/LoadingState';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Input } from '../../../components/ui/Input';
import { Select } from '../../../components/ui/Select';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { broadcastsApi } from '../api';
import { audienceApi } from '../../audience/api';
import type { Contact } from '../../audience/types';
import type { BroadcastCampaign, BroadcastMedia, BroadcastOptions, BroadcastParameterMapping, BroadcastVariableMapping, CreateBroadcastInput } from '../types';
import { emptyMapping, emptyValue, futureSchedule, normalizeBroadcastDraft, normalizeBroadcastOptions, requirements, scheduleLocalValue } from '../draft-normalization';

const steps = ['Campaign details', 'Audience', 'Template', 'Review & launch'];
const mappingValid = (row?: BroadcastVariableMapping) => row?.source === 'STATIC' ? Boolean(row.value.trim()) : row?.source === 'CONTACT_ATTRIBUTE' ? Boolean(row.key) : false;

interface BroadcastWizardProps {
  options?: BroadcastOptions;
  initialCampaign?: BroadcastCampaign;
  loading: boolean;
  error?: string;
  onRetry: () => void;
}

export function BroadcastWizard({ options: rawOptions, initialCampaign, loading, error, onRetry }: BroadcastWizardProps) {
  const navigate = useNavigate();
  const options = useMemo(() => normalizeBroadcastOptions(rawOptions), [rawOptions]);
  const initial = useMemo(() => normalizeBroadcastDraft(initialCampaign, options), [initialCampaign, options]);
  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial.name);
  const [segmentId, setSegmentId] = useState(initial.segmentId);
  const [audienceSource, setAudienceSource] = useState(initial.audienceSource);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsCursor, setContactsCursor] = useState<string | null>(null);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState('');
  const contactsRequest = useRef(0);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>(initial.selectedContactIds);
  const [contactSearch, setContactSearch] = useState('');
  const [pastedPhones, setPastedPhones] = useState(initial.pastedPhones);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [mapping, setMapping] = useState<BroadcastParameterMapping>(initial.parameterMapping);
  const [media, setMedia] = useState<BroadcastMedia | null>(initial.media);
  const [submitting, setSubmitting] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(initialCampaign?.id);
  const [submitError, setSubmitError] = useState('');
  const [scheduledLocal, setScheduledLocal] = useState(initial.scheduledLocal);
  const [timezone] = useState(initial.timezone);
  const [minimumSchedule] = useState(() => scheduleLocalValue(new Date(Date.now() + 60_000).toISOString(), initial.timezone));
  const [creationKey] = useState(() => crypto.randomUUID());
  const [launchKey] = useState(() => crypto.randomUUID());
  const segment = options?.segments.find((item) => item.id === segmentId);
  const template = options?.templates.find((item) => item.id === templateId);
  const needed = useMemo(() => {
    if (!template) return undefined;
    try { return requirements(template.components); } catch (reason) { return { error: reason instanceof Error ? reason.message : 'Template variables are unsupported.', body: 0, header: 0, buttons: [] as number[], mediaType: undefined }; }
  }, [template]);
  const templateBody = useMemo(() => {
    const component = template?.components.find((item) => item && typeof item === 'object' && (item as { type?: string }).type === 'BODY');
    return component && typeof (component as { text?: unknown }).text === 'string' ? (component as { text: string }).text : '';
  }, [template]);

  useEffect(() => {
    const request = ++contactsRequest.current;
    if (audienceSource !== 'CONTACTS' || step !== 1) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setContactsLoading(true); setContactsError('');
      void audienceApi.contacts({ search: contactSearch, status: 'ACTIVE', limit: 25 }).then((page) => {
        if (active && contactsRequest.current === request) { setContacts(page.items); setContactsCursor(page.nextCursor); }
      }).catch((reason) => { if (active && contactsRequest.current === request) setContactsError(reason instanceof Error ? reason.message : 'Contacts could not be loaded.'); }).finally(() => { if (active && contactsRequest.current === request) setContactsLoading(false); });
    }, contactSearch ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [audienceSource, step, contactSearch]);

  const loadMoreContacts = async () => {
    if (!contactsCursor || contactsLoading) return;
    const request = contactsRequest.current;
    setContactsLoading(true); setContactsError('');
    try {
      const page = await audienceApi.contacts({ search: contactSearch, status: 'ACTIVE', cursor: contactsCursor, limit: 25 });
      if (contactsRequest.current === request) { setContacts((current) => [...current, ...page.items.filter((item) => !current.some((row) => row.id === item.id))]); setContactsCursor(page.nextCursor); }
    } catch (reason) { if (contactsRequest.current === request) setContactsError(reason instanceof Error ? reason.message : 'More contacts could not be loaded.'); }
    finally { if (contactsRequest.current === request) setContactsLoading(false); }
  };

  const chooseTemplate = (id: string) => {
    setTemplateId(id); setSubmitError('');
    const next = options?.templates.find((item) => item.id === id);
    if (!next) { setMapping(emptyMapping()); setMedia(null); return; }
    try {
      const req = requirements(next.components);
      setMapping({ body: Array.from({ length: req.body }, emptyValue), header: Array.from({ length: req.header }, emptyValue), buttons: Object.fromEntries(req.buttons.map((index) => [String(index), emptyValue()])) });
      setMedia(req.mediaType ? { type: req.mediaType, source: 'LINK', value: '' } : null);
    } catch { setMapping(emptyMapping()); setMedia(null); }
  };
  const setRow = (section: 'body' | 'header' | 'buttons', index: number, value: BroadcastVariableMapping) => setMapping((current) => section === 'buttons' ? { ...current, buttons: { ...current.buttons, [String(index)]: value } } : { ...current, [section]: current[section].map((item, position) => position === index ? value : item) });
  const mediaError = !media ? '' : !media.value.trim() ? 'Enter the required header media reference.' : media.source === 'ID' ? /^\d{1,64}$/.test(media.value.trim()) ? '' : 'Enter a valid Meta media ID.' : (() => { try { const url = new URL(media.value); return url.protocol === 'https:' && !url.username && !url.password ? '' : 'Use a public HTTPS media URL.'; } catch { return 'Use a public HTTPS media URL.'; } })();
  const missingMappings = Boolean(needed && (needed.error || mapping.body.length !== needed.body || mapping.header.length !== needed.header || mapping.body.some((row) => !mappingValid(row)) || mapping.header.some((row) => !mappingValid(row)) || needed.buttons.some((index) => !mappingValid(mapping.buttons[String(index)])) || needed.mediaType && mediaError));

  if (loading) return <Card><LoadingState label="Loading WhatsApp configuration" /></Card>;
  if (error) return <Card><ErrorState message={error} onRetry={onRetry} /></Card>;
  if (!options?.configured) return <ConfigurationState reason={options?.reason} />;
  if (options.templates.length === 0) return <ConfigurationState reason="NO_TEMPLATE" />;

  const normalizedPastedPhones = pastedPhones.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
  const canContinue = step === 0 ? Boolean(name.trim()) : step === 1 ? audienceSource === 'SEGMENT' ? Boolean(segmentId) : audienceSource === 'CONTACTS' ? selectedContactIds.length > 0 : normalizedPastedPhones.length > 0 && normalizedPastedPhones.length <= 1_000 : step === 2 ? Boolean(templateId) && !missingMappings : true;

  const submit = async (mode: 'DRAFT' | 'SEND_NOW' | 'SCHEDULE') => {
    if (!name.trim() || !templateId || missingMappings || !canContinue) return;
    if (mode === 'SCHEDULE' && !futureSchedule(scheduledLocal, timezone)) { setSubmitError('Choose a future local date and time.'); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const input: CreateBroadcastInput = {
        name: name.trim(),
        whatsAppTemplateId: templateId,
        audienceDefinition: audienceSource === 'SEGMENT' ? { source: 'SEGMENT', segmentId } : audienceSource === 'CONTACTS' ? { source: 'CONTACTS', contactIds: selectedContactIds } : { source: 'PASTED', phones: normalizedPastedPhones },
        timezone,
        parameterMapping: mapping,
        ...(media ? { mediaMapping: { media } } : {}),
      };
      const campaign = draftId ? await broadcastsApi.update(draftId, input) : await broadcastsApi.create(input, creationKey);
      setDraftId(campaign.id);
      if (mode !== 'DRAFT') await broadcastsApi.launch(campaign.id, { mode, ...(mode === 'SCHEDULE' ? { scheduledLocal } : {}), timezone, launchKey });
      navigate(`/whatsapp/broadcasts/${campaign.id}`);
    } catch (reason) {
      setSubmitError(reason instanceof Error ? reason.message : 'The broadcast could not be created.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border/80 px-5 py-5 sm:px-7">
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Broadcast creation progress">
          {steps.map((label, index) => (
            <li key={label} className="flex items-center gap-2.5">
              <span className={`grid size-8 shrink-0 place-items-center rounded-full border text-xs font-bold transition-colors ${index < step ? 'border-primary bg-primary text-white' : index === step ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-background-subtle text-text-muted'}`}>
                {index < step ? <Check className="size-4" /> : index + 1}
              </span>
              <span className={`text-xs font-semibold ${index <= step ? 'text-text-primary' : 'text-text-muted'}`}>{label}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="min-h-[360px] p-5 sm:p-7">
        {step === 0 ? (
          <div className="mx-auto max-w-xl space-y-5">
            <div><label htmlFor="broadcast-name" className="mb-2 block text-sm font-semibold">Campaign name</label><Input id="broadcast-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={160} placeholder="Enter a clear internal campaign name" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><label className="mb-2 block text-sm font-semibold">Channel</label><Input disabled value="WhatsApp" aria-label="Channel" /></div>
              <div><label className="mb-2 block text-sm font-semibold">Type</label><Input disabled value="Broadcast" aria-label="Campaign type" /></div>
            </div>
            <p className="text-xs leading-5 text-text-secondary">Sender account and phone are resolved server-side from the active workspace configuration.</p>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="mx-auto max-w-xl space-y-5">
            <div><label className="mb-2 block text-sm font-semibold">Audience source</label><Select value={audienceSource} onChange={(event) => setAudienceSource(event.target.value as typeof audienceSource)}><option value="SEGMENT">Segment</option><option value="CONTACTS">Selected contacts</option><option value="PASTED">Pasted phone numbers</option></Select></div>
            {audienceSource === 'SEGMENT' ? <><div><label htmlFor="broadcast-segment" className="mb-2 block text-sm font-semibold">Audience segment</label><Select id="broadcast-segment" value={segmentId} onChange={(event) => setSegmentId(event.target.value)}><option value="">Select an active segment</option>{options.segments.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div>{!options.segments.length ? <p className="rounded-xl bg-warning-soft p-3 text-sm text-warning">No active segments are available. Create one in Audience or select another source.</p> : null}{segment ? <div className="rounded-card border border-border/80 bg-background p-4"><p className="text-sm font-semibold">{segment.name}</p><p className="mt-1 text-xs text-text-secondary">{segment.type.toLowerCase()} segment · estimated {segment.estimatedCount.toLocaleString()} recipients</p></div> : null}</> : null}
            {audienceSource === 'CONTACTS' ? <div className="space-y-3"><Input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Search active contacts" aria-label="Search active contacts" /><div className="max-h-52 space-y-1 overflow-y-auto rounded-card border border-border p-2">{contacts.length ? contacts.map((contact) => <label key={contact.id} className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-background-subtle"><input type="checkbox" checked={selectedContactIds.includes(contact.id)} onChange={() => setSelectedContactIds((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} /><span><span className="block text-sm font-medium">{contact.name}</span><span className="text-xs text-text-secondary">{contact.phoneE164}</span><span className="mt-1 flex gap-1"><StatusBadge status={contact.status} /><StatusBadge status={contact.whatsappConsent.status} /></span></span></label>) : <p className="p-4 text-center text-xs text-text-muted">{contactsLoading ? 'Loading active contacts…' : 'No active contacts match this search.'}</p>}</div>{contactsCursor ? <Button variant="secondary" disabled={contactsLoading} onClick={() => void loadMoreContacts()}>{contactsLoading ? 'Loading…' : 'Load more contacts'}</Button> : null}{contactsError ? <p role="alert" className="text-sm text-danger">{contactsError}</p> : null}<p className="text-xs text-text-secondary">{selectedContactIds.length} selected. Consent and active status are rechecked when the audience is snapshotted.</p></div> : null}
            {audienceSource === 'PASTED' ? <div><label className="mb-2 block text-sm font-semibold">Phone numbers</label><textarea className="min-h-40 w-full rounded-control border border-border bg-background-subtle p-3 text-sm outline-none focus:border-primary" value={pastedPhones} onChange={(event) => setPastedPhones(event.target.value)} placeholder={"+919876543210\n+14155552671"} /><p className="mt-2 text-xs text-text-secondary">{normalizedPastedPhones.length} numbers. Pasted recipients fail closed without persisted consent, except the existing development-only bypass.</p></div> : null}
            <p className="text-xs leading-5 text-text-muted">The exact consent-eligible audience is snapshotted by the backend at launch.</p>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="mx-auto grid max-w-3xl gap-5 md:grid-cols-2">
            <div><label htmlFor="broadcast-template" className="mb-2 block text-sm font-semibold">Approved template</label><Select id="broadcast-template" value={templateId} onChange={(event) => chooseTemplate(event.target.value)}><option value="">Select an approved template</option>{options.templates.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</Select><p className="mt-2 text-xs leading-5 text-text-secondary">Only approved, active templates from the workspace account are available.</p></div>
            <div className="rounded-card border border-border/80 bg-background p-4"><div className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-primary" />Template preview</div>{template ? <><p className="mt-4 text-sm font-semibold">{template.name}</p><p className="mt-1 text-xs text-text-secondary">{template.language} · {template.category}</p><p className="mt-4 whitespace-pre-wrap rounded-xl bg-surface p-3 text-sm leading-6 text-text-secondary shadow-control">{templateBody || 'This template has no text body preview.'}</p></> : <p className="mt-4 text-sm text-text-muted">Select a template to preview its persisted body.</p>}</div>
            {needed ? <div className="space-y-4 md:col-span-2"><div><h3 className="text-sm font-semibold">Personalization mapping</h3><p className="mt-1 text-xs text-text-secondary">Choose each value once. Contact attributes resolve separately for each eligible recipient.</p></div>{needed.error ? <p role="alert" className="text-sm text-danger">{needed.error}</p> : null}{mapping.header.map((row, index) => <ParameterRow key={`header-${index}`} label={`Header {{${index + 1}}}`} value={row} attributeKeys={options.attributeKeys ?? []} onChange={(value) => setRow('header', index, value)} />)}{mapping.body.map((row, index) => <ParameterRow key={`body-${index}`} label={`Body {{${index + 1}}}`} value={row} attributeKeys={options.attributeKeys ?? []} onChange={(value) => setRow('body', index, value)} />)}{needed.buttons.map((index) => <ParameterRow key={`button-${index}`} label={`Button ${index + 1} URL value`} value={mapping.buttons[String(index)] ?? emptyValue()} attributeKeys={options.attributeKeys ?? []} onChange={(value) => setRow('buttons', index, value)} />)}{media ? <div className="rounded-xl border border-border p-4"><p className="mb-3 text-sm font-semibold">{media.type} header media</p><div className="grid gap-3 sm:grid-cols-[140px_1fr]"><Select value={media.source} onChange={(event) => setMedia({ ...media, source: event.target.value as BroadcastMedia['source'], value: '' })}><option value="LINK">HTTPS link</option><option value="ID">Meta media ID</option></Select><Input aria-label="Header media reference" value={media.value} onChange={(event) => setMedia({ ...media, value: event.target.value })} placeholder={media.source === 'LINK' ? 'https://example.com/media' : 'Meta media ID'} /></div>{media.type === 'DOCUMENT' ? <Input className="mt-3" aria-label="Document filename" value={media.fileName ?? ''} onChange={(event) => setMedia({ ...media, fileName: event.target.value })} placeholder="Optional document filename" /> : null}{mediaError ? <p role="alert" className="mt-2 text-xs text-danger">{mediaError}</p> : null}</div> : null}{!mapping.header.length && !mapping.body.length && !needed.buttons.length && !media ? <p className="rounded-xl bg-background-subtle p-3 text-xs text-text-secondary">This template needs no parameter mapping.</p> : null}{audienceSource === 'PASTED' ? <p className="text-xs text-warning">A pasted number needs persisted WhatsApp opt-in to send. A fallback covers missing attributes, not consent; recipients without a usable value are skipped.</p> : null}{missingMappings && !needed.error ? <p role="alert" className="text-xs text-danger">Complete each mapping and required media reference to continue.</p> : null}</div> : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div className="mx-auto max-w-2xl space-y-5">
            <h2 className="text-lg font-semibold tracking-[-0.01em]">Review your broadcast</h2>
            <dl className="divide-y divide-border/70 rounded-card border border-border/80 bg-background px-5">
              <ReviewRow label="Campaign" value={name} /><ReviewRow label="Audience" value={audienceSource === 'SEGMENT' ? `${segment?.name ?? 'Unavailable'} · estimated ${segment?.estimatedCount.toLocaleString() ?? 0}` : audienceSource === 'CONTACTS' ? `${selectedContactIds.length} selected contacts` : `${normalizedPastedPhones.length} pasted numbers`} /><ReviewRow label="Template" value={`${template?.name ?? 'Unavailable'} · ${template?.language ?? '—'}`} /><ReviewRow label="Timezone" value={timezone} />
            </dl>
            <div className="rounded-card border border-border/80 bg-background p-5"><h3 className="text-sm font-semibold">Parameter mapping</h3><div className="mt-3 space-y-2 text-xs text-text-secondary">{[...mapping.header.map((value, index) => ({ label: `Header {{${index + 1}}}`, value })), ...mapping.body.map((value, index) => ({ label: `Body {{${index + 1}}}`, value })), ...Object.entries(mapping.buttons).map(([index, value]) => ({ label: `Button ${Number(index) + 1} URL`, value }))].map(({ label, value }) => <p key={label}><span className="font-semibold text-text-primary">{label}</span> → {value.source === 'STATIC' ? `Static: ${value.value}` : `Contact: ${attributeLabel(value.key)}${value.fallback ? ` · fallback: ${value.fallback}` : ''}`}</p>)}{!mapping.header.length && !mapping.body.length && !Object.keys(mapping.buttons).length ? <p>No text variables required.</p> : null}{media ? <p>Header media: {media.type} via {media.source}</p> : null}</div></div>
            <div className="rounded-xl border border-border p-4"><label htmlFor="broadcast-schedule" className="mb-2 block text-sm font-semibold">Schedule for later (optional)</label><Input id="broadcast-schedule" type="datetime-local" value={scheduledLocal} min={minimumSchedule} onChange={(event) => setScheduledLocal(event.target.value)} /><p className="mt-2 text-xs text-text-secondary">Interpreted in {timezone}. Scheduling creates the recipient snapshot now and queues delivery for the selected time.</p></div>
            <p className="text-xs leading-5 text-text-secondary">Launch remains server-gated by database, Redis, consent, approved assets, live-send configuration, and transport readiness.</p>
            {submitError ? <p role="alert" className="rounded-xl border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger">{submitError}</p> : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col-reverse gap-3 border-t border-border/80 bg-background/70 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <Button variant="secondary" disabled={step === 0 || submitting} onClick={() => setStep((value) => value - 1)}><ChevronLeft className="size-4" />Back</Button>
        {step < 3 ? <Button disabled={!canContinue} onClick={() => setStep((value) => value + 1)}>Continue<ChevronRight className="size-4" /></Button> : <div className="flex flex-col gap-2 sm:flex-row"><Button variant="secondary" disabled={submitting} onClick={() => void submit('DRAFT')}><Save className="size-4" />Save Draft</Button><Button disabled={submitting} onClick={() => void submit('SEND_NOW')}><Rocket className="size-4" />Send Now</Button><Button variant="secondary" disabled={submitting || !scheduledLocal} onClick={() => void submit('SCHEDULE')}><Rocket className="size-4" />Schedule for later</Button></div>}
      </div>
    </Card>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 py-3.5 sm:grid-cols-[140px_1fr]"><dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt><dd className="text-sm font-medium text-text-primary">{value}</dd></div>;
}

function attributeLabel(key: string) {
  const labels: Record<string, string> = { name: 'Full name', firstName: 'First name', phoneE164: 'Phone', email: 'Email', tags: 'Tags' };
  return labels[key] ?? key.replace(/^attributes\./, '').split('.').join(' / ');
}

function ParameterRow({ label, value, attributeKeys, onChange }: { label: string; value: BroadcastVariableMapping; attributeKeys: string[]; onChange: (value: BroadcastVariableMapping) => void }) {
  const error = value.source === 'STATIC' ? !value.value.trim() ? 'Enter a static value.' : '' : !value.key ? 'Select a contact attribute.' : '';
  return <div className="rounded-xl border border-border bg-background p-4"><p className="mb-3 text-sm font-semibold">{label}</p><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-1 block text-xs text-text-secondary">Source</label><Select aria-label={`${label} source`} value={value.source} onChange={(event) => onChange(event.target.value === 'STATIC' ? { source: 'STATIC', value: '' } : { source: 'CONTACT_ATTRIBUTE', key: '' })}><option value="STATIC">Static value</option><option value="CONTACT_ATTRIBUTE">Contact attribute</option></Select></div>{value.source === 'STATIC' ? <div><label className="mb-1 block text-xs text-text-secondary">Value</label><Input aria-label={`${label} static value`} value={value.value} maxLength={1_024} onChange={(event) => onChange({ source: 'STATIC', value: event.target.value })} placeholder="Value sent to each recipient" /></div> : <><div><label className="mb-1 block text-xs text-text-secondary">Attribute</label><Select aria-label={`${label} attribute`} value={value.key} onChange={(event) => onChange({ ...value, key: event.target.value })}><option value="">Select contact field</option><optgroup label="Contact fields">{['name', 'firstName', 'phoneE164', 'email', 'tags'].map((key) => <option key={key} value={key}>{attributeLabel(key)}</option>)}</optgroup>{attributeKeys.length ? <optgroup label="Custom attributes">{attributeKeys.map((key) => <option key={key} value={key}>{attributeLabel(key)}</option>)}</optgroup> : null}</Select></div><div className="sm:col-span-2"><label className="mb-1 block text-xs text-text-secondary">Fallback if missing (optional)</label><Input aria-label={`${label} fallback`} value={value.fallback ?? ''} maxLength={1_024} onChange={(event) => onChange({ ...value, fallback: event.target.value })} placeholder="Recipient is skipped if no value or fallback exists" /></div></>}</div>{error ? <p role="alert" className="mt-2 text-xs text-danger">{error}</p> : null}</div>;
}

function ConfigurationState({ reason }: { reason?: string }) {
  const messages: Record<string, string> = {
    NO_WHATSAPP_ACCOUNT: 'No connected WhatsApp account is available for this workspace.',
    MULTIPLE_WHATSAPP_ACCOUNTS: 'A single sending account must be selected before creating broadcasts.',
    NO_SENDING_PHONE: 'The connected WhatsApp account has no sending phone.',
    MULTIPLE_SENDING_PHONES: 'A single sending phone must be selected before creating broadcasts.',
    NO_AUDIENCE: 'No active audience segments are available.',
    NO_TEMPLATE: 'No approved WhatsApp templates are available.',
  };
  return <Card><ErrorState message={messages[reason ?? ''] ?? 'Broadcast configuration is incomplete.'} /></Card>;
}
