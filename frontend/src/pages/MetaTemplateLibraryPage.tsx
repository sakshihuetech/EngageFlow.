import { ArrowLeft, Eye, Library, RotateCcw, Search, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../components/common/EmptyState';
import { ErrorState } from '../components/common/ErrorState';
import { LoadingState } from '../components/common/LoadingState';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { ModalShell } from '../components/ui/ModalShell';
import { Select } from '../components/ui/Select';
import { whatsAppApi } from '../features/whatsapp/api';
import { libraryCreateErrorMessage } from '../features/whatsapp/library-error';
import type { MetaLibraryItem } from '../features/whatsapp/types';

interface Filters {
  search: string;
  category: string;
  language: string;
  topic: string;
  usecase: string;
}

const initialFilters: Filters = { search: '', category: 'UTILITY', language: 'en_US', topic: '', usecase: '' };
const languages = ['en_US', 'en_IN', 'hi', 'bn', 'ta', 'es_ES', 'fr_FR'];

function variableCount(item: MetaLibraryItem) {
  const text = [item.header, item.body, item.footer].filter(Boolean).join(' ');
  return new Set([...text.matchAll(/\{\{([^}]+)\}\}/g)].map((match) => match[1])).size;
}

function buttonLabel(button: Record<string, unknown>) {
  return String(button.text ?? button.type ?? 'Button');
}

export function MetaTemplateLibraryPage() {
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Filters>(initialFilters);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [items, setItems] = useState<MetaLibraryItem[]>([]);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [nextCursor, setNextCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<MetaLibraryItem>();
  const [using, setUsing] = useState<MetaLibraryItem>();
  const [createdName, setCreatedName] = useState('');

  const load = useCallback(async (cursor?: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await whatsAppApi.library({ ...filters, ...(cursor ? { after: cursor } : {}) });
      setItems(result.items);
      setNextCursor(result.paging.hasNext ? result.paging.after : undefined);
    } catch (reason) {
      setItems([]);
      setNextCursor(undefined);
      setError(reason instanceof Error ? reason.message : 'Meta Template Library could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    let active = true;
    const cursor = pageCursors[pageIndex];
    void whatsAppApi.library({ ...filters, ...(cursor ? { after: cursor } : {}) }).then((result) => {
      if (!active) return;
      setItems(result.items); setNextCursor(result.paging.hasNext ? result.paging.after : undefined); setError('');
    }).catch((reason: unknown) => {
      if (!active) return;
      setItems([]); setNextCursor(undefined); setError(reason instanceof Error ? reason.message : 'Meta Template Library could not be loaded.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [filters, pageCursors, pageIndex]);

  const applyFilters = () => {
    setLoading(true);
    setPageCursors([undefined]);
    setPageIndex(0);
    setFilters({ ...draft, search: draft.search.trim(), topic: draft.topic.trim(), usecase: draft.usecase.trim() });
  };
  const clearFilters = () => {
    setLoading(true);
    setDraft(initialFilters);
    setPageCursors([undefined]);
    setPageIndex(0);
    setFilters(initialFilters);
  };
  const nextPage = () => {
    if (!nextCursor) return;
    setLoading(true);
    const nextIndex = pageIndex + 1;
    setPageCursors((current) => [...current.slice(0, nextIndex), nextCursor]);
    setPageIndex(nextIndex);
  };

  return <div className="space-y-6">
    <header>
      <Button className="-ml-3 mb-3" size="sm" variant="ghost" onClick={() => navigate('/whatsapp/templates')}><ArrowLeft className="size-4" />Back to Templates</Button>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl border border-primary-border bg-primary-soft text-primary"><Library className="size-5" /></div>
        <div><h1 className="text-[26px] font-bold leading-tight tracking-[-0.025em] text-text-primary sm:text-[28px]">Meta Template Library</h1><p className="mt-1.5 max-w-2xl text-sm leading-6 text-text-secondary">Browse real provider templates and add a configured copy to your connected WhatsApp account.</p></div>
      </div>
    </header>

    {createdName ? <div className="flex flex-col gap-3 rounded-xl border border-primary-border bg-primary-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-success-strong">Template submitted to Meta</p><p className="mt-0.5 text-xs text-text-secondary">{createdName} now appears in My Templates with its current provider status.</p></div><Button size="sm" onClick={() => navigate('/whatsapp/templates')}>View My Templates</Button></div> : null}

    <Card className="p-4 sm:p-5">
      <form className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(16rem,2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_minmax(10rem,1fr)_minmax(10rem,1fr)_auto]" onSubmit={(event) => { event.preventDefault(); applyFilters(); }}>
        <label className="text-xs font-medium text-text-secondary"><span className="mb-1.5 block">Search</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" /><Input className="pl-9" value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} placeholder="Search library templates" /></div></label>
        <label className="text-xs font-medium text-text-secondary"><span className="mb-1.5 block">Category</span><Select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>{['UTILITY', 'MARKETING', 'AUTHENTICATION'].map((value) => <option key={value}>{value}</option>)}</Select></label>
        <label className="text-xs font-medium text-text-secondary"><span className="mb-1.5 block">Language</span><Select value={draft.language} onChange={(event) => setDraft({ ...draft, language: event.target.value })}>{languages.map((value) => <option key={value}>{value}</option>)}</Select></label>
        <label className="text-xs font-medium text-text-secondary"><span className="mb-1.5 block">Topic</span><Input value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value.toUpperCase() })} placeholder="Optional" /></label>
        <label className="text-xs font-medium text-text-secondary"><span className="mb-1.5 block">Use case</span><Input value={draft.usecase} onChange={(event) => setDraft({ ...draft, usecase: event.target.value.toUpperCase() })} placeholder="Optional" /></label>
        <div className="flex items-end gap-2"><Button type="submit" disabled={loading}>Apply</Button><Button aria-label="Clear filters" title="Clear filters" variant="ghost" onClick={clearFilters}><RotateCcw className="size-4" /></Button></div>
      </form>
    </Card>

    {error ? <Card><ErrorState message={error} onRetry={() => void load(pageCursors[pageIndex])} /></Card> : loading ? <Card><LoadingState label="Loading Meta library templates" /></Card> : items.length === 0 ? <Card><EmptyState title="No library templates found" description="Try changing the category, language, or search filters." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} /></Card> : <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => <LibraryCard key={`${item.name}:${item.language}`} item={item} onPreview={() => setPreview(item)} onUse={() => setUsing(item)} />)}
      </div>
      <div className="flex items-center justify-between border-t border-border pt-4"><p className="text-xs text-text-muted">Page {pageIndex + 1} · Provider-bounded results</p><div className="flex gap-2"><Button variant="secondary" disabled={pageIndex === 0 || loading} onClick={() => { setLoading(true); setPageIndex((current) => current - 1); }}>Previous</Button><Button variant="secondary" disabled={!nextCursor || loading} onClick={nextPage}>Next</Button></div></div>
    </>}

    <PreviewDialog item={preview} onClose={() => setPreview(undefined)} onUse={(item) => { setPreview(undefined); setUsing(item); }} />
    {using ? <UseTemplateDialog key={`${using.name}:${using.language}`} item={using} onClose={() => setUsing(undefined)} onCreated={(name) => { setUsing(undefined); setCreatedName(name); }} /> : null}
  </div>;
}

function LibraryCard({ item, onPreview, onUse }: { item: MetaLibraryItem; onPreview: () => void; onUse: () => void }) {
  const count = variableCount(item);
  return <Card className="flex min-w-0 flex-col overflow-hidden p-5"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words text-[15px] font-semibold text-text-primary">{item.name}</h2><p className="mt-1 text-xs text-text-muted">{item.language}{item.topic ? ` · ${item.topic}` : ''}</p></div><span className="shrink-0 rounded-full border border-border bg-background px-2.5 py-1 text-[10px] font-semibold tracking-wide text-text-secondary">{item.category}</span></div>
    <div className="mt-4 flex-1 space-y-3"><p className="line-clamp-5 whitespace-pre-wrap text-[13px] leading-5 text-text-secondary">{item.body || 'No body preview returned by Meta.'}</p>{item.header || item.footer ? <p className="text-xs text-text-muted">{item.header ? 'Header' : ''}{item.header && item.footer ? ' · ' : ''}{item.footer ? 'Footer' : ''}</p> : null}{item.buttons?.length || count ? <p className="text-xs text-text-muted">{item.buttons?.length ? `${item.buttons.length} button${item.buttons.length === 1 ? '' : 's'}` : ''}{item.buttons?.length && count ? ' · ' : ''}{count ? `${count} variable${count === 1 ? '' : 's'}` : ''}</p> : null}</div>
    <div className="mt-5 flex gap-2 border-t border-border pt-4"><Button className="flex-1" size="sm" variant="secondary" onClick={onPreview}><Eye className="size-4" />Preview</Button><Button className="flex-1" size="sm" onClick={onUse}><Sparkles className="size-4" />Use Template</Button></div></Card>;
}

function TemplateSummary({ item }: { item: MetaLibraryItem }) {
  return <div className="space-y-4 rounded-xl border border-border bg-background p-4 text-sm"><div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-primary-soft px-2.5 py-1 font-semibold text-primary">{item.category}</span><span className="rounded-full bg-background-subtle px-2.5 py-1 text-text-secondary">{item.language}</span>{item.topic ? <span className="rounded-full bg-background-subtle px-2.5 py-1 text-text-secondary">{item.topic}</span> : null}</div>{item.header ? <section><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Header</p><p className="mt-1 whitespace-pre-wrap font-medium text-text-primary">{item.header}</p></section> : null}<section><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Body</p><p className="mt-1 whitespace-pre-wrap leading-6 text-text-primary">{item.body || 'No body preview returned by Meta.'}</p></section>{item.bodyParams?.length ? <p className="text-xs text-text-muted">Example parameters: {item.bodyParams.join(' · ')}</p> : null}{item.footer ? <section><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Footer</p><p className="mt-1 text-text-secondary">{item.footer}</p></section> : null}{item.buttons?.length ? <section><p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Buttons</p><div className="mt-2 flex flex-wrap gap-2">{item.buttons.map((button, index) => <span key={`${buttonLabel(button)}:${index}`} className="rounded-control border border-border bg-surface px-3 py-2 text-xs font-medium text-primary">{buttonLabel(button)}</span>)}</div></section> : null}</div>;
}

function PreviewDialog({ item, onClose, onUse }: { item?: MetaLibraryItem; onClose: () => void; onUse: (item: MetaLibraryItem) => void }) {
  return <ModalShell open={Boolean(item)} title="Template preview" onClose={onClose}>{item ? <div className="space-y-4 "><div><h3 className="break-words font-semibold text-text-primary">{item.name}</h3><p className="mt-1 text-xs text-text-muted">Live Meta library preview</p></div><TemplateSummary item={item} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={() => onUse(item)}>Use Template</Button></div></div> : null}</ModalShell>;
}

function UseTemplateDialog({ item, onClose, onCreated }: { item: MetaLibraryItem; onClose: () => void; onCreated: (name: string) => void }) {
  const [name, setName] = useState(`${item.name}_copy`);
  const configurableButtons = useMemo(() => (item.buttons ?? []).filter((button) => button.type === 'URL' || button.type === 'PHONE_NUMBER'), [item.buttons]);
  const [values, setValues] = useState<string[]>(() => configurableButtons.map(() => ''));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try {
      const buttonInputs = configurableButtons.map((button, index) => button.type === 'URL' ? { type: 'URL', url: { base_url: values[index]?.trim() ?? '' } } : { type: 'PHONE_NUMBER', phone_number: values[index]?.trim() ?? '' });
      await whatsAppApi.useLibraryTemplate({ libraryTemplateName: item.name, language: item.language, name: name.trim(), ...(buttonInputs.length ? { buttonInputs } : {}) });
      onCreated(name.trim());
    } catch (reason) { setError(libraryCreateErrorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <ModalShell open title="Use library template" onClose={onClose}><div className="space-y-4 text-sm"><TemplateSummary item={item} /><label className="block font-medium text-text-primary"><span className="mb-1.5 block">New template name</span><Input value={name} onChange={(event) => setName(event.target.value.toLowerCase().replace(/\s+/g, '_'))} /></label>{configurableButtons.map((button, index) => <label className="block font-medium text-text-primary" key={`${button.type}:${index}`}><span className="mb-1.5 block">{button.type === 'URL' ? `URL for ${buttonLabel(button)}` : `Phone number for ${buttonLabel(button)}`}</span><Input value={values[index] ?? ''} onChange={(event) => setValues((current) => current.map((value, currentIndex) => currentIndex === index ? event.target.value : value))} placeholder={button.type === 'URL' ? 'https://example.com/path' : '+15551234567'} /></label>)}{error ? <div className="rounded-xl border border-danger-border bg-danger-soft p-3 text-sm text-danger" role="alert">{error}</div> : null}<div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? 'Creating in Meta…' : 'Create in Meta'}</Button></div></div></ModalShell>;
}
