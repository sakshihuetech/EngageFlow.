# Registered HTTP API

This inventory is from `backend/src/app.ts` and `backend/src/routes/*.ts`: **75 method/path registrations**, counting the two external-trigger aliases separately. All paths below include the actual mount prefix. `W` means `requireWorkspace` + `requireDatabase`: the default workspace resolver is a fixed non-production `DEV_WORKSPACE_ID`, **not user authentication**. `K` means Bearer API-key auth, Redis rate limit and DB requirement. `M` means Meta webhook challenge/signature validation. `H` means health route. These are not a published, version-stable OpenAPI contract; consult the named controller and its Zod/service validation before integrating. Lists are bounded/paginated where supported. Errors use the shared error handler and may include sanitized provider fields.

| Method | Route | Purpose, main input and result | Guard / handler |
| --- | --- | --- | --- |
| GET | `/api/health/live` | Process liveness JSON. | H; `health.routes.ts` |
| GET | `/api/health/ready` | DB/Redis/queue readiness JSON; degraded dependencies can fail readiness. | H; `health.routes.ts` |
| GET | `/api/webhooks/whatsapp` | Meta `hub.*` verification query → challenge or rejection. | M; `whatsapp-webhook.routes.ts` |
| POST | `/api/webhooks/whatsapp` | Raw signed Meta events → acknowledgement and status/inbound processing. | M; webhook controller/service |

## WhatsApp Setup, templates and test messaging

Controller: `backend/src/controllers/whatsapp.controller.ts` and `whatsapp-setup.controller.ts`; routes: `whatsapp.routes.ts`. All rows use `W`.

| Method | Route | Main input → response / limitation |
| --- | --- | --- |
| GET | `/api/whatsapp/setup` | Current scoped connection/account/phone/status view. |
| GET | `/api/whatsapp/accounts/views` | Connected/historical account views for selection. |
| POST | `/api/whatsapp/setup/onboarding/complete` | Embedded Signup result → verified asset persistence; does not blindly mark phone ready. |
| POST | `/api/whatsapp/setup/refresh` | Selected Meta assets → reconciled stored status; requires provider read. |
| POST | `/api/whatsapp/setup/register` | Explicit Standard phone registration request; provider mutation. |
| POST | `/api/whatsapp/setup/disconnect` | Connection disconnect state; historical records retained. |
| GET | `/api/whatsapp/setup/profile` | Meta business profile read. |
| PATCH | `/api/whatsapp/setup/profile` | Profile fields → Meta update. |
| POST | `/api/whatsapp/setup/profile/picture` | Multipart `file` (5 MiB limit) → Meta profile picture update. |
| GET | `/api/whatsapp/templates` | Account-scoped templates, search/filter/pagination → list. |
| POST | `/api/whatsapp/templates/sync` | Fetch account templates from Meta → persisted statuses. |
| GET | `/api/whatsapp/templates/library` | Meta library filters/cursor → bounded page. |
| POST | `/api/whatsapp/templates/library/use` | Selected library template → Meta create and then local persist on success. |
| POST | `/api/whatsapp/templates/media` | Multipart `file` (100 MiB limit) → provider media handle. |
| POST | `/api/whatsapp/templates` | Authored template definition → Meta create/local record. |
| PATCH | `/api/whatsapp/templates/:id` | Template ID/body → provider edit if allowed. |
| DELETE | `/api/whatsapp/templates/:id` | Template ID → provider delete/local deactivation. |
| GET | `/api/whatsapp/messages/latest/status` | Latest test-message tracking state. |
| GET | `/api/whatsapp/messages/:recordId/status` | One stored test-message status. |
| POST | `/api/whatsapp/messages` | Test recipient/template parameters → actual provider send when configured; **not a dry run**. |

## Audience

Routes: `audience.routes.ts`; controller: `audience.controller.ts`. All `W`. Contact edits validate sender-scoped consent evidence; import/bulk calls can mutate many records.

| Method | Route | Main input → response |
| --- | --- | --- |
| GET | `/api/audience/contacts` | Search/filter/page → contacts. |
| POST | `/api/audience/contacts` | Contact/consent fields → created contact. |
| POST | `/api/audience/contacts/import` | CSV import data → validation/import result. |
| POST | `/api/audience/contacts/bulk` | Bulk action/IDs → mutation summary. |
| GET | `/api/audience/contacts/:id` | Contact ID → detail. |
| PATCH | `/api/audience/contacts/:id` | Contact ID/changes → updated detail. |
| DELETE | `/api/audience/contacts/:id` | Contact ID → soft-deleted state. |
| POST | `/api/audience/contacts/:id/restore` | Contact ID → restored state. |
| GET | `/api/audience/segments` | Search/page → segment list. |
| POST | `/api/audience/segments` | Segment definition → created segment. |
| PATCH | `/api/audience/segments/:id` | Segment ID/changes → updated segment. |
| DELETE | `/api/audience/segments/:id` | Segment ID → archive. |

## Broadcast

Routes: `broadcast.routes.ts`; controller: `broadcast.controller.ts`. All `W`. `:id` is a campaign ID; readiness, sender/account, consent and state are rechecked by services/workers. Launch/retry can enqueue real sends.

| Method | Route | Main input → response |
| --- | --- | --- |
| GET | `/api/campaigns` | Filters/limit/cursor → campaigns. |
| POST | `/api/campaigns` | Draft settings, audience, template/mappings → campaign. |
| GET | `/api/campaigns/options` | Sender/template/audience options. |
| GET | `/api/campaigns/:id/readiness` | Validation/eligible audience preview. |
| GET | `/api/campaigns/:id/analytics` | Counters and delivery analytics. |
| GET | `/api/campaigns/:id/recipients` | Cursor/filter → bounded recipient details. |
| GET | `/api/campaigns/:id/retry/preview` | Failed recipient eligibility/exclusions. |
| POST | `/api/campaigns/:id/retry` | Confirm safe failed-recipient retry → queued result. |
| POST | `/api/campaigns/:id/launch` | Draft/schedule confirmation → snapshot and queue. |
| POST | `/api/campaigns/:id/pause` | Campaign state transition. |
| POST | `/api/campaigns/:id/resume` | Campaign state transition/requeue. |
| POST | `/api/campaigns/:id/cancel` | Stop future processing; accepted messages cannot be recalled. |
| POST | `/api/campaigns/:id/duplicate` | Existing ID → new draft, subject to current sender/template validation. |
| GET | `/api/campaigns/:id` | Campaign detail. |
| PATCH | `/api/campaigns/:id` | Editable draft/schedule fields → updated campaign. |

## Inbox

Routes: `inbox.routes.ts`; controller: `inbox.controller.ts`. All `W`; conversation IDs remain account/phone scoped.

| Method | Route | Main input → response |
| --- | --- | --- |
| GET | `/api/inbox/conversations` | Filters/page → conversations. |
| GET | `/api/inbox/conversations/:id/messages` | Cursor/page → message history. |
| POST | `/api/inbox/conversations/:id/messages` | Reply text/media fields → outbound message; can send live. |
| POST | `/api/inbox/conversations/:id/read` | Mark conversation read. |
| PATCH | `/api/inbox/conversations/:id` | Conversation status/assignment update. |

## API Campaign management, credentials and trigger

Management routes use `W`. Controllers: `api-campaign.controller.ts` and `api-credential.controller.ts`. Credentials return plaintext only once on creation/rotation; list responses omit hashes. Do not paste keys into logs or sample requests.

| Method | Route | Main input → response / guard |
| --- | --- | --- |
| GET | `/api/api-campaigns` | Filters/page → campaigns. W |
| POST | `/api/api-campaigns` | Slug, sender/template/schema → campaign. W |
| GET | `/api/api-campaigns/options` | Valid account/template options. W |
| GET | `/api/api-campaigns/:id/analytics` | Execution counters/analytics. W |
| GET | `/api/api-campaigns/:id/executions` | Filters/page → campaign executions. W |
| GET | `/api/api-campaigns/:id/executions/:executionId` | Execution and attempt detail. W |
| GET | `/api/api-campaigns/:id/executions/:executionId/retry/preview` | Safe eligibility/restriction preview. W |
| POST | `/api/api-campaigns/:id/executions/:executionId/retry` | Confirm manual retry → state/job. W |
| GET | `/api/api-campaigns/:id` | Campaign detail. W |
| PATCH | `/api/api-campaigns/:id` | Editable lifecycle/config changes. W |
| POST | `/api/api-campaigns/:id/restore` | Restore archived campaign. W |
| DELETE | `/api/api-campaigns/:id` | Archive campaign; not physical history deletion. W |
| GET | `/api/api-credentials` | Scoped credential metadata, no key hash. W |
| POST | `/api/api-credentials` | Credential creation → plaintext key once. W |
| POST | `/api/api-credentials/:id/rotate` | Replace secret → new plaintext key once. W |
| POST | `/api/api-credentials/:id/revoke` | Disable credential. W |
| GET | `/api/api-campaign-executions` | Cross-campaign paginated/filterable execution logs. W |
| POST | `/api/v1/campaigns/trigger` | `Authorization: Bearer <key>`, `Idempotency-Key`, campaign slug/recipient/variables → accepted/existing execution. K |
| POST | `/api/v1/whatsapp/api-campaigns/trigger` | Same trigger handler and contract, compatibility alias. K |

The `K` paths are implemented by `api-campaign-trigger.routes.ts`, `api-key-auth.ts`, `api-campaign-rate-limit.ts` and `api-campaign.controller.ts`/services. Failed authentication does not reveal whether a prefix or workspace exists. Repeated idempotency keys return/reject according to the existing execution contract, not a second send. The endpoint names alone do not guarantee delivery; check execution state and signed webhook history.
