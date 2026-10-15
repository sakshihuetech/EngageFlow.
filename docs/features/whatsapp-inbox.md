# WhatsApp Inbox and Reply Tracking

## Batch 3 close/reopen

The selected thread shows its current OPEN/CLOSED badge and the appropriate Close conversation/Reopen conversation button. The action reuses `PATCH /api/inbox/conversations/:id` with `{ status: OPEN | CLOSED }`, disables itself while updating, displays errors, and refreshes the thread/list after success. V2 did not require a confirmation for this reversible local state action. Backend predicates require both conversation ID and resolved workspace, returning not-found for cross-workspace access. No schema, send logic, service-window rule or webhook behavior changes are needed. Closing a conversation is a local organizational action, not a Meta send or consent mutation.

## Purpose and reused data

`/whatsapp/inbox` provides a workspace-scoped view of WhatsApp conversations, bounded message history, local unread state, guarded text replies, and delivery tracking. It reuses the V2 `conversations`, `whatsappmessages`, and `contacts` collections. The Conversation and WhatsAppMessage schemas retain their V2 fields, ObjectId relationships, enums, timestamps, unique identities, and indexes; runtime index synchronization remains disabled.

## Inbound webhook flow

The existing signed `/api/webhooks/whatsapp` route remains the only webhook. After HMAC verification, status events continue through the existing monotonic delivery tracker. Message events resolve the Meta phone to exactly one workspace/account, normalize the sender, and then:

1. find or create a workspace contact with source `WHATSAPP_INBOUND`;
2. leave a new contact’s consent as `UNKNOWN`;
3. find or upsert the conversation using workspace, account, phone, and customer identity;
4. insert one `WhatsAppMessage` using the globally unique Meta message ID;
5. update last inbound/activity/preview fields and increment unread only after a new message insert.

A duplicate webhook `wamid` does not duplicate the message or increment unread again. Deleted contacts are not silently restored by inbound traffic.

## Outbound reply flow and 24-hour rule

`POST /api/inbox/conversations/:id/messages` supports text only. The server resolves the conversation, contact, connected account, phone, and encrypted credential using workspace ownership. It rejects blocked/deleted contacts and refuses a free-form reply when the latest inbound message is absent or older than 24 hours with `TEMPLATE_REQUIRED`.

Live replies require both `CAMPAIGN_LIVE_SEND_ENABLED=true` and `CAMPAIGN_TRANSPORT=meta`. The shared Graph request service sends the text payload. A valid returned `wamid` is persisted as an OUTBOUND, INBOX, ACCEPTED message and the conversation preview/activity is updated. Disabled transport never produces a fake success.

Outside the service window, an approved template must be sent through the existing template-capable flow. Inbox does not automatically submit one.

## Delivery and read behavior

The signed webhook advances outbound messages monotonically through ACCEPTED, SENT, DELIVERED, READ, or FAILED. Older and duplicate webhook events cannot downgrade a newer state. Safe failure fields are displayed without exposing provider authorization data.

`POST /api/inbox/conversations/:id/read` resets the local conversation unread counter. Provider-side WhatsApp read acknowledgement is not sent because V2 did not expose a separate reviewed acknowledgement path; local operator read state and customer delivery-read state remain distinct.

## APIs

- `GET /api/inbox/conversations` — search, OPEN/CLOSED/unread filters, stable activity cursor, maximum 100 rows.
- `GET /api/inbox/conversations/:id/messages` — newest-page query returned chronologically, ObjectId cursor, maximum 100 messages.
- `POST /api/inbox/conversations/:id/messages` — guarded live text reply.
- `POST /api/inbox/conversations/:id/read` — local unread reset.
- `PATCH /api/inbox/conversations/:id` — OPEN/CLOSED status.

Every query and mutation includes `workspaceId`; account, phone, contact, and conversation relationships are resolved server-side.

## UI and polling

Desktop uses a conversation list, thread, and concise contact-context panel. Tablet/mobile progressively hide the context/list and provide back/details navigation. The composer shows a clear closed-window warning. Message and conversation pages use load-more pagination.

The page polls every 10 seconds while visible and skips polling when `document.hidden` is true. WebSockets/SSE are deferred.

## Scale notes

- Around 100 conversations: a few bounded pages cover typical use.
- Around 1,000: stable activity/message cursors avoid full collection loads.
- 10,000+: existing compound indexes support workspace/activity and workspace/conversation history, but search and polling frequency should be measured against production traffic.

No load-tested capacity is claimed. Large media payloads are not duplicated; Inbox displays stored metadata only.

## Completed and deferred

Completed: read-only conversation/thread APIs, inbound webhook persistence, contact/conversation upsert, idempotency, unread/read state, guarded text reply, status tracking, responsive Inbox UI, and visibility-aware polling.

Batch 3 additionally connects local close/reopen controls. Separate future work: media replies/download proxying, provider read acknowledgements, assignments, notes, bulk Inbox actions, real-time push, template sending inside Inbox, production auth/RBAC, SMS, and email. API Campaigns are already migrated separately.
