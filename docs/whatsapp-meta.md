# WhatsApp and Meta lifecycle

## Onboarding and assets

The Setup UI is in `frontend/src/features/whatsapp/` and the Setup page. `embedded-signup.ts` starts Meta-hosted Embedded Signup only after a user action; `SetupControls.tsx` handles Standard/Coexistence choices. `backend/src/controllers/whatsapp-setup.controller.ts` delegates to Setup services, which validate returned WABA/phone assets against Meta and persist a workspace-bound `MetaConnection`, encrypted `MetaCredential`, `WhatsAppAccount` and `WhatsAppPhoneNumber`. The credential is decrypted only server-side for Graph calls. The browser must never receive a token.

Standard Cloud API onboarding and phone registration are separate: an onboarding result or visible display name does not prove sending readiness. `POST /api/whatsapp/setup/register` is an explicit provider-writing operation. Coexistence is a guarded path for an existing WhatsApp Business App number; it must not silently migrate/deregister that number. Whether the Meta app has the required permission, App Review approval, and **real** Coexistence eligibility/configuration cannot be determined from this repository alone.

`POST /api/whatsapp/setup/refresh` reads the full paginated Meta WABA phone list, reconciles returned phone IDs, and marks missing stored phones unavailable **only after a complete successful response**. A valid empty list means no connected Cloud API phone; a failed/incomplete provider read must not be interpreted as deletion. Historical phone/WABA records remain for old reports. Refresh is separate from webhook `subscribed_apps` mutation and separate from template sync. For implementation details, see [phone reconciliation](features/whatsapp-phone-reconciliation.md).

## Templates, consent and sender readiness

Templates are WABA/account-scoped (`WhatsAppTemplate`). `POST /api/whatsapp/templates/sync` reads Meta template approval/status and updates local records; Setup asset refresh does not approve or sync templates by implication. Authoring/library-use endpoints call Meta and persist after provider success. A locally present template on an old WABA is not approved on a newly selected WABA. The library is provider-backed, not a hardcoded local catalog.

Audience contacts hold embedded tags/attributes and sender-account-scoped WhatsApp consent (`status`, source/evidence, account). The trigger and worker paths should validate contact status, phone and consent against the original account, including opt-out. Non-production bypass flags exist for testing, but are not a production consent strategy; API trigger and worker may enforce at different points. Sending uses `backend/src/services/whatsapp/send-approved-template.service.ts`, which checks original account, available/registered phone, approved template and credential before calling the shared Meta Graph service. Broadcast and API Campaign must not silently switch sender after WABA change.

## Outbound and webhook status

```mermaid
sequenceDiagram
  participant Worker as Worker / test send / Inbox reply
  participant DB as MongoDB
  participant Meta as Meta Graph
  participant Hook as /api/webhooks/whatsapp
  Worker->>DB: Resolve original workspace, WABA, phone, template, consent
  Worker->>Meta: POST message using server-side credential
  Meta-->>Worker: wamid (accepted) or sanitized error
  Worker->>DB: Store WhatsAppMessage and attempt correlation
  Meta->>Hook: Signed status or inbound message event
  Hook->>Hook: Verify signature on raw body; resolve WABA/phone
  Hook->>DB: Correlate wamid, update message/recipient/execution/conversation
  DB-->>Worker: Later status is separate from HTTP acceptance
```

`GET /api/webhooks/whatsapp` verifies the challenge using `WEBHOOK_VERIFY_TOKEN`; POST verifies the request signature using `META_APP_SECRET`. Mounting the webhook before `express.json()` in `backend/src/app.ts` preserves raw bytes. The webhook services resolve WABA/phone/workspace, parse inbound/status events, deduplicate/correlate `wamid`, and update messages, Broadcast recipients, API executions and Inbox conversations. A delayed `failed` webhook can follow initial Meta acceptance; a campaign being completed does not prove delivery. Failure code 131042 means payment eligibility; 131037 concerns display-name eligibility. UI guidance does not supersede actual Meta asset state.

## Configuration and verification limits

The Graph version is `WHATSAPP_API_VERSION`; app ID, app secret, verify token and encryption key are server configuration. `VITE_META_APP_ID` and `VITE_WHATSAPP_CONFIG_ID` are public Embedded Signup identifiers; the frontend example currently omits them. Verify actual callback URL reachability, app's `messages` subscription, WABA/phone ownership, registration/name state, permissions, template approval and signed status events in a controlled Meta environment. Source inspection or mocked tests cannot establish these external facts. Never test by sending to a customer without authorization.
