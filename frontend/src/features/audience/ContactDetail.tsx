import { useEffect, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ModalShell } from '../../components/ui/ModalShell';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { audienceApi } from './api';
import type { Contact } from './types';

export function ContactDetail({ id, onClose, onEdit, onChanged }: { id: string; onClose: () => void; onEdit: (contact: Contact) => void; onChanged: () => void }) {
  const [contact, setContact] = useState<Contact>(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { let active = true; void audienceApi.contact(id).then(value => { if (active) setContact(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Contact could not be loaded.'); }); return () => { active = false; }; }, [id]);
  async function change() {
    if (!contact || !window.confirm(contact.status === 'DELETED' ? 'Restore this contact without changing consent?' : 'Soft delete this contact? History and consent will be preserved.')) return;
    setBusy(true);
    try { if (contact.status === 'DELETED') await audienceApi.restoreContact(id); else await audienceApi.deleteContact(id); onChanged(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Contact could not be updated.'); }
    finally { setBusy(false); }
  }
  return <ModalShell open title="Contact detail" scrollable onClose={onClose}>{error ? <p role="alert" className="text-danger">{error}</p> : null}{!contact ? <p>Loading contact…</p> : <div className="space-y-4"><h3 className="font-semibold">{contact.name}</h3><div className="flex gap-2"><StatusBadge status={contact.status} /><StatusBadge status={contact.whatsappConsent.status} /></div><dl className="space-y-3 text-sm">{Object.entries({ Phone: contact.phoneE164, Email: contact.email || 'Not provided', Source: contact.source, Tags: contact.tags.join(', ') || 'None', 'Consent source': contact.whatsappConsent.source || 'Unknown', 'Consent evidence': contact.whatsappConsent.evidence || 'Not provided', Created: new Date(contact.createdAt).toLocaleString(), Updated: new Date(contact.updatedAt).toLocaleString() }).map(([label, value]) => <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="break-words">{value}</dd></div>)}</dl><div><h4 className="text-sm font-semibold">Attributes</h4><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(contact.attributes, null, 2)}</pre></div><div className="flex justify-end gap-2">{contact.status !== 'DELETED' ? <Button variant="secondary" onClick={() => { onEdit(contact); onClose(); }}>Edit</Button> : null}<Button variant="secondary" disabled={busy} onClick={() => void change()}>{contact.status === 'DELETED' ? 'Restore' : 'Delete'}</Button></div></div>}</ModalShell>;
}
