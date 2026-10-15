# WhatsApp Setup and Test Messaging

## Purpose

`/whatsapp/setup` is the operational view of the WhatsApp configuration stored for the resolved EngageFlow workspace, including explicit provider-backed onboarding and asset/profile controls. Viewing the page does not modify Meta assets. The current development workspace comes from the existing `requireWorkspace` boundary and `DEV_WORKSPACE_ID`; production must replace that temporary resolver with User -> Membership -> Workspace authorization.

## Batch 3 Setup controls

- Connect/reconnect uses Meta Embedded Signup: trusted Facebook origins only, STANDARD and COEXISTENCE completion events, authorization code plus session details, and a bounded completion timeout. Only the short-lived code reaches the backend; access tokens stay server-side.
- `POST /api/whatsapp/setup/onboarding/complete` exchanges the code, validates WABA/phone ownership through Meta, refuses another workspace's assets, subscribes the WABA, then commits connection/account/phone/encrypted credential updates transactionally. Existing connection state is not changed on provider validation failure. MongoDB transactions require a replica set or sharded deployment, as in V2.
- `POST /api/whatsapp/setup/refresh` reconciles provider metadata and phones, retains missing local metadata rather than replacing it with undefined values, preserves IDs/history, and confirms the WABA subscription. This is an explicit Meta write action, not an automatic page-load operation.
- `POST /api/whatsapp/setup/register` takes only a six-digit PIN. Workspace/account/phone/token are server-resolved. One phone and STANDARD onboarding are required; Meta ownership/state is checked first. Already registered numbers do not send another registration call. The PIN is neither persisted nor returned. Provider state is reread after registration; an ambiguous result instructs a refresh, not automatic retry.
- `POST /api/whatsapp/setup/disconnect` requires `confirm: true` plus UI confirmation. A transaction deactivates only local connection/account state. Historical campaigns, templates, messages, contacts and encrypted credential records remain. This matches V2's local disconnect; it does not revoke Meta permissions.
- `GET/PATCH /api/whatsapp/setup/profile` read/update the exact V2 editable fields: about (139), address/description (256), email (128), at most two HTTP(S) websites, and Meta-supported vertical. Verified display name is read-only. No unsupported display-name setter is invented.
- `POST /api/whatsapp/setup/profile/picture` accepts a server-created multipart temporary file only. JPEG/PNG extension, MIME, signature and 5 MB limit are checked; the existing resumable Graph upload is reused. Temporary files are removed after the operation. Clients cannot supply filesystem paths or provider picture handles.
- Setup errors reuse the existing 131042 mapping and conditional billing notice; healthy/configuration-only states have no billing CTA.

Configuration: backend `META_APP_ID`, `META_APP_SECRET`, `ENCRYPTION_KEY`, existing `WHATSAPP_API_VERSION`; frontend public `VITE_META_APP_ID` and `VITE_WHATSAPP_CONFIG_ID`. The Meta dashboard must allow the actual frontend domain for Embedded Signup. No real `.env` was edited. Provider write operations are user initiated; verification uses mocks, not real Meta writes/sends.

Remaining production hardening: Auth/workspace membership, distributed phone-registration locking, and serialization/global conflict protection for simultaneous onboarding of one provider asset in different workspaces. V2 also lacked those protections. Multi-phone registration/profile editing deliberately refuses ambiguity, matching V2 rather than selecting a number silently.

## Connection resolution

The backend resolves `Workspace -> MetaConnection -> MetaCredential -> WhatsAppAccount -> WhatsAppPhoneNumber`. Every database predicate carries workspace ownership. The API returns only safe connection, account, phone, webhook, credential-presence/expiry, and template-count metadata. It never returns an access token, encrypted token fields, app secret, webhook verification token, or encryption key.

Existing V2 `MetaCredential` values remain readable with the V2 AES-256-GCM format: the server derives a 256-bit key by SHA-256 hashing `ENCRYPTION_KEY`, then decrypts the stored base64 IV, authentication tag, and ciphertext. Decryption happens only immediately before a provider call, and credentials are never placed in browser state or queue payloads.

## Page behavior

The page separates Connection, Business Account, Phone Number, Webhook, Templates, and Test Messaging into EngageFlow-native cards. Missing configuration is reported as unavailable or not configured; no placeholder provider data is invented. Multiple stored phones can be selected for a test. Registration, verification, quality, credential expiry, webhook subscription, sync totals, and live-send availability are shown when the database contains them.

## Test Messaging flow

The operator selects an active phone and approved database template, enters an E.164 destination, supplies the exact required header/body/button parameters and any required HTTPS or Meta-ID media reference, reviews the preview, and submits. The backend resolves all workspace-owned assets again and calls the same `sendApprovedTemplateMessage` boundary used by Broadcast.

Live submission is fail-closed: both `CAMPAIGN_LIVE_SEND_ENABLED=true` and `CAMPAIGN_TRANSPORT=meta` are required. A successful Meta response must contain a valid `wamid`; the backend then inserts a `WhatsAppMessage` with `sendSource: TEST`. The existing signed webhook advances it monotonically through Accepted, Sent, Delivered, Read, or Failed. The UI polls the workspace-scoped message-status endpoint and displays sanitized failure details. Meta error `131042` is presented as a payment-setup action rather than exposing the raw provider response.

Automated tests use injected mock transports only. They do not call Meta or write existing MongoDB business data.

## API and webhook

- `GET /api/whatsapp/setup` returns safe setup metadata.
- `POST /api/whatsapp/messages` validates and submits a live test only when explicitly enabled.
- `GET /api/whatsapp/messages/:recordId/status` returns one workspace-owned TEST message status.
- `GET /api/whatsapp/messages/latest/status` returns the latest workspace-owned TEST status.
- The existing `/api/webhooks/whatsapp` route remains the single signed Meta webhook for both Broadcast and TEST messages.

## Required environment

Server-side values are `ENCRYPTION_KEY`, `WHATSAPP_API_VERSION`, `META_APP_SECRET`, `WEBHOOK_VERIFY_TOKEN`, `CAMPAIGN_LIVE_SEND_ENABLED`, and `CAMPAIGN_TRANSPORT`. `META_APP_ID` is required for onboarding/media uploads but not for reading an existing connection. `MONGODB_URI` and temporary `DEV_WORKSPACE_ID` select the existing data context. Frontend uses `VITE_API_URL`; Embedded Signup additionally needs the public `VITE_META_APP_ID` and `VITE_WHATSAPP_CONFIG_ID`. No Meta secret belongs in Vite.

Onboarding/token exchange, registration, local disconnect, profile/picture and explicit asset/subscription refresh are connected by Batch 3. Independent token rotation and production authentication/RBAC remain separate work; the development workspace boundary is not production authorization.
