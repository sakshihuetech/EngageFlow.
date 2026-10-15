import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { ModalShell } from '../../components/ui/ModalShell';
import { Select } from '../../components/ui/Select';
import { audienceApi } from './api';
import { CSV_MAX_BYTES, csvBatches, mapCsv, parseCsv, uniqueCsvContacts, type CsvMapping } from './csv';
import type { ContactInput } from './types';

const emptyMapping: CsvMapping = { name: '', phone: '', email: '', tags: '', lifecycleStage: '', attributes: '' };
export function CsvImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false); const [headers, setHeaders] = useState<string[]>([]); const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState(emptyMapping); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [summary, setSummary] = useState(''); const [validated, setValidated] = useState<ContactInput[]>();
  async function fileChanged(file?: File) {
    setValidated(undefined); setSummary(''); setError(''); setRows([]); setHeaders([]);
    if (!file) return;
    try {
      if (file.size > CSV_MAX_BYTES) throw new Error('CSV files must be at most 2 MB.');
      const data = parseCsv(await file.text()); setHeaders(data.headers); setRows(data.rows); setMapping(emptyMapping);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'CSV could not be read.'); }
  }
  async function process(preview: boolean) {
    setBusy(true); setError('');
    try {
      const prepared = uniqueCsvContacts(preview ? mapCsv(rows, mapping) : validated!);
      const items = prepared.items;
      let created = 0; let valid = 0; let duplicates = prepared.duplicates; let invalid = 0; let checked = 0;
      for (const batch of csvBatches(items)) {
        const result = await audienceApi.import(batch, preview); checked += batch.length;
        created += result.created; valid += result.valid; duplicates += result.duplicates; invalid += result.invalid;
        setSummary(`${checked} / ${items.length} checked · ${preview ? `${valid} valid` : `${created} imported`} · ${duplicates} duplicates · ${invalid} invalid`);
      }
      if (preview) setValidated(invalid ? undefined : items);
      else { setValidated(undefined); onDone(); }
    } catch (reason) { setValidated(undefined); setError(reason instanceof Error ? reason.message : 'Import stopped. Earlier successful batches are preserved; repeating the file skips existing contacts.'); }
    finally { setBusy(false); }
  }
  return <><Button variant="secondary" onClick={() => { setOpen(true); setValidated(undefined); setSummary(''); }}>Import CSV</Button><ModalShell open={open} title="Import contacts from CSV" scrollable onClose={() => { if (!busy) setOpen(false); }}><div className="space-y-4"><p className="text-sm text-text-secondary">Up to 2 MB / 5,000 rows; processed in batches of 100. Existing contacts are skipped. Imported consent remains Unknown.</p><input aria-label="CSV file" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => void fileChanged(event.target.files?.[0])} />{headers.length ? <><div className="grid gap-3 sm:grid-cols-2">{(Object.keys(mapping) as (keyof CsvMapping)[]).map(key => <label key={key} className="text-sm">{key === 'attributes' ? 'Custom attributes (JSON)' : key}<Select disabled={busy} value={mapping[key]} onChange={event => { setMapping(current => ({ ...current, [key]: event.target.value })); setValidated(undefined); setSummary(''); }}><option value="">Not mapped</option>{headers.map((header, index) => <option key={index} value={index}>{header || `Column ${index + 1}`}</option>)}</Select></label>)}</div><p className="text-xs text-text-muted">Tags use semicolons. Preview of first five rows:</p><div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr>{headers.map((header, index) => <th key={index} className="p-2 text-left">{header}</th>)}</tr></thead><tbody>{rows.slice(0, 5).map((row, index) => <tr key={index}>{row.map((value, column) => <td key={column} className="max-w-48 truncate p-2">{value}</td>)}</tr>)}</tbody></table></div></> : null}{summary ? <p role="status" className="text-sm">{summary}</p> : null}{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}<div className="flex flex-wrap justify-end gap-2"><Button variant="secondary" disabled={busy || !rows.length} onClick={() => void process(true)}>Validate import</Button><Button disabled={busy || !validated?.length} onClick={() => { if (window.confirm(`Import ${validated?.length} rows? Existing contacts will be skipped; consent will not be changed.`)) void process(false); }}>{busy ? 'Processing…' : 'Confirm import'}</Button></div></div></ModalShell></>;
}
