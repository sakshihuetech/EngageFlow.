import { useState } from 'react';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { inboxApi } from './api';
import type { InboxConversation } from './types';

export function ConversationStatusAction({ conversation, onUpdated }: { conversation: InboxConversation; onUpdated: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function update() {
    setBusy(true); setError('');
    try { await inboxApi.update(conversation.id, conversation.status === 'OPEN' ? 'CLOSED' : 'OPEN'); onUpdated(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Conversation status could not be changed.'); }
    finally { setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-3" aria-live="polite"><StatusBadge status={conversation.status} /><Button size="sm" variant="secondary" disabled={busy} onClick={() => void update()}>{busy ? 'Updating…' : conversation.status === 'OPEN' ? 'Close conversation' : 'Reopen conversation'}</Button>{error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}</div>;
}
