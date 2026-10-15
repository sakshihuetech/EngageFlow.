import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConversationStatusAction } from './ConversationStatusAction';
import type { InboxConversation } from './types';

describe('Inbox status controls', () => {
  it.each([['OPEN','Close conversation','Reopen conversation'], ['CLOSED','Reopen conversation','Close conversation']] as const)('shows only the valid action for %s', (status, action, absent) => {
    const markup = renderToStaticMarkup(<ConversationStatusAction conversation={{ id: 'mock-conversation', status } as InboxConversation} onUpdated={() => undefined} />);
    expect(markup).toContain(action); expect(markup).not.toContain(absent);
  });
});
