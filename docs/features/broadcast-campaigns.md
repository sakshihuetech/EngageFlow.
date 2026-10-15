# WhatsApp Broadcast Campaigns

## Purpose and scope

Broadcast creates a workspace-scoped WhatsApp template campaign, snapshots its audience, dispatches recipient work through BullMQ, records accepted messages, and applies Meta webhook delivery states to recipients and campaign counters.

WhatsApp Setup, templates, Audience, Inbox, and API Campaigns now use the shared foundation described in their feature documents. The EngageFlow router, Outlet shell, API envelope, error middleware, request IDs, logger, and visual system are retained.

## Runtime flow

1. The React pages call the existing API client.
2. `requireWorkspace` resolves an explicit development workspace only outside production; it is an auth-ready boundary, not production authentication.
3. Campaign routes require a configured Mongo connection and apply the workspace predicate to every query.
4. Draft creation resolves the single connected account/phone, an approved active template, and a workspace-owned audience. Sender identifiers remain server-controlled.
5. Launch validates readiness, claims a draft idempotently, and snapshots eligible recipients into `campaignrecipients` in batches.
6. The API enqueues an identifier-only job on `whatsapp-campaign-send`. No token or credential enters Redis.
7. The separate campaign worker claims recipients with a lease, rechecks campaign state and consent, resolves account/phone/template/credential server-side, and calls the shared WhatsApp send service.
8. The default transport is disabled. The mock transport is allowed only outside production. The Meta transport uses the shared Graph service and must return Meta's message ID (`wamid`).
9. Accepted sends create a `whatsappmessages` record correlated to the recipient. Signed Meta status webhooks update that message, advance the recipient monotonically, and update/reconcile campaign counters.
10. List, detail, analytics, and cursor-paginated recipient endpoints return current database state to the UI.

In compact form:

`React -> Express -> Mongo -> Redis/BullMQ -> worker -> transport -> Meta -> signed webhook -> WhatsAppMessage/CampaignRecipient/Campaign -> React`

## Data contracts

The schemas use the V2 collection names and status meanings required by Broadcast:

| Model | Collection | Important compatibility contract |
| --- | --- | --- |
| Workspace | `workspaces` | Workspace ownership boundary |
| Campaign | `campaigns` | V2 lifecycle enums; unique `(workspaceId, idempotencyKey)`; launch key and dispatch sequence |
| CampaignRecipient | `campaignrecipients` | Recipient snapshots; unique `(workspaceId, campaignId, recipientKey)`; lease, attempts, failure and delivery timestamps |
| WhatsAppMessage | `whatsappmessages` | Unique `metaMessageId`; campaign and recipient correlation; V2 shared conversation/API fields and indexes retained |
| Contact | `contacts` | Workspace ownership, E.164 phone, ACTIVE/deleted checks, WhatsApp consent fields |
| Segment | `segments` | STATIC/DYNAMIC definition and workspace ownership |
| WhatsAppTemplate | `whatsapptemplates` | Account ownership, APPROVED/active state, language/category/components |
| WhatsAppAccount | `whatsappaccounts` | Workspace and Meta connection ownership |
| WhatsAppPhoneNumber | `whatsappphonenumbers` | Account ownership and registration/verification readiness |
| MetaConnection | `metaconnections` | Connected provider relationship |
| MetaCredential | `metacredentials` | Server-only credential reference; never returned or queued |

ObjectId references, field names, enums, and Broadcast-relevant indexes match V2. `PROCESSING` is the persisted V2 running status; the UI presents it as Running. The application does not connect to the old database automatically, and no Mongo data is modified by setup or tests.

## API routes

All campaign routes live below `/api/campaigns` and require workspace and database middleware.

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/` | Search/status list with bounded cursor pagination |
| POST | `/` | Create an idempotent draft |
| GET | `/options` | Resolve configured account/phone, approved templates, and active segments |
| GET | `/:id` | Workspace-scoped campaign detail |
| PATCH | `/:id` | Update a DRAFT using server-controlled sender ownership |
| POST | `/:id/duplicate` | Revalidate the audience and create a new independent DRAFT from safe configuration only |
| GET | `/:id/readiness` | Validate assets, queue, transport, and live-send flags |
| GET | `/:id/analytics` | Counter/rate view |
| GET | `/:id/recipients` | Status-filtered cursor page |
| POST | `/:id/launch` | Snapshot and enqueue now or at a timezone-local schedule |
| POST | `/:id/pause` | Pause a valid active state |
| POST | `/:id/resume` | Atomically advance dispatch sequence and enqueue |
| POST | `/:id/cancel` | Cancel only work not submitted to the provider |

`GET /api/webhooks/whatsapp` verifies the subscription token. `POST /api/webhooks/whatsapp` uses a raw, size-limited body and verifies `X-Hub-Signature-256` with `META_APP_SECRET` before applying status-only tracking.

## Audience snapshot and consent

CONTACTS validates every selected ID belongs to the workspace and is ACTIVE. SEGMENT resolves a workspace-owned ACTIVE static/dynamic definition through an allowlisted filter builder. PASTED normalizes and deduplicates phones. Snapshot writes are batched and use deterministic recipient keys plus upsert, so a repeated snapshot does not duplicate recipients.

Consent fails closed when the contact is missing consent, revoked, deleted, inactive, or otherwise ineligible. `CAMPAIGN_TEST_BYPASS_CONSENT=true` works only outside production; production ignores it. The worker rechecks consent immediately before send.

## Queue, worker, retries, and idempotency

- Queue name: `whatsapp-campaign-send`.
- Jobs contain only `workspaceId`, `campaignId`, and `sequence`, with deterministic job IDs.
- Redis comes from `REDIS_URL`; worker concurrency comes from `CAMPAIGN_WORKER_CONCURRENCY`.
- BullMQ job attempts are one because recipient-level retry state is authoritative. Completed/failed retention is bounded.
- A recipient is claimed atomically with a lease. An existing correlated `WhatsAppMessage` prevents another send.
- Only errors explicitly classified as transient and safe to retry are retried, at most three recipient attempts, with bounded exponential delay and jitter.
- An ambiguous provider submission is not retried automatically, preventing duplicate sends at the cost of requiring operator reconciliation.
- Permanent failures are terminal and their stored/client-visible details are sanitized.
- Draft creation uses a workspace-scoped idempotency key plus stable request fingerprint. Launch uses a launch key. Resume increments the dispatch sequence.
- Shutdown closes the worker, queue events, queue, Redis connections, HTTP server, and Mongo connection.

Run the worker separately with `npm run campaign:worker` from `backend`.

## Tracking rules

Webhook delivery transitions are monotonic: ACCEPTED -> SENT -> DELIVERED -> READ. FAILED may advance a submitted message but cannot regress READ or an already terminal failure. Compare-and-set recipient updates make duplicate/concurrent webhooks harmless. Recipient timestamps and sanitized provider failure details are preserved. Campaign counters update incrementally and can be rebuilt by aggregation for reconciliation. Campaigns finish as `COMPLETED` or `COMPLETED_WITH_ERRORS` when no actionable recipients remain.

## UI

- `/whatsapp/broadcasts`: real-data list, search, status filter, cursor paging, counts, and configuration/error/empty states.
- `/whatsapp/broadcasts/new`: four-step details, audience, template, and review/launch wizard.
- `/whatsapp/broadcasts/:id/edit`: the same wizard prefilled from an existing DRAFT. Saving uses PATCH and preserves the campaign ID.
- `/whatsapp/broadcasts/:id`: summary, readiness, safe lifecycle actions, analytics, and cursor-paginated recipient tracking.

Batch 2 adds Edit Draft, Duplicate, and Schedule for later. Duplicate copies the template, audience definition, parameter/media mapping, and timezone into a new DRAFT; it does not copy recipients, counters, launch keys, provider IDs, or delivery status. The audience is revalidated for the workspace. Scheduling converts the selected browser-local time using the displayed IANA timezone, requires a future time, snapshots recipients, persists `SCHEDULED`, and places one delayed job on the existing BullMQ queue. The list and detail pages show the scheduled time. Pause, resume, and cancel remain guarded by the existing state transitions. V2 did not provide an independent reschedule endpoint after launch; this batch preserves that boundary.

The sidebar keeps Broadcast Campaigns under WhatsApp. Missing account, phone, template, audience, backend, Redis, queue, and live transport are shown honestly; the UI never invents records or delivery results. System Health includes Mongo, Redis, queue, and worker visibility. Until a persistent heartbeat exists, worker health remains `NOT_VERIFIED`.

## Configuration

See `backend/.env.example`. Important controls are `MONGODB_URI`, `REDIS_URL`, `DEV_WORKSPACE_ID`, `CAMPAIGN_LIVE_SEND_ENABLED`, `CAMPAIGN_TRANSPORT`, `CAMPAIGN_TEST_BYPASS_CONSENT`, `CAMPAIGN_WORKER_CONCURRENCY`, `CAMPAIGN_BATCH_SIZE`, `META_APP_SECRET`, and `WEBHOOK_VERIFY_TOKEN`.

Safe defaults do not send. Do not enable live sending until production authentication/authorization, secret storage, a reviewed Meta transport, account/template provisioning, webhook registration, Redis/Mongo operational controls, monitoring, and a controlled test workspace are in place.

## Scale and cost notes

- Around 100 recipients: the same batched snapshot and cursor UI are used; one worker can be adequate for controlled testing.
- Around 1,000: tune batch size and concurrency against provider rate limits and observe Redis/Mongo latency.
- Around 10,000: run dedicated workers, monitor leases/retries/counters, and validate index/query plans and webhook throughput.
- 100,000+: load-test snapshot, queue, worker, Mongo write, webhook, and reconciliation paths; plan partitioning/archival and provider throughput explicitly.

No throughput capacity is claimed without load testing. The frontend never loads the full recipient set, snapshots are batched, recipient queries are indexed/cursor-based, concurrency is controlled, and queue history is bounded.

## Files introduced or changed

Backend additions cover Mongo configuration, workspace/database middleware, V2-compatible models, campaign controller/routes, queue and worker entry, broadcast audience/execution/worker/tracking/consent/pagination utilities, shared WhatsApp transport/send service, signed webhook controller/routes, tests, environment examples, and package scripts/dependencies. Existing app/server/health/env/API types were integrated rather than replaced.

Frontend additions cover the Broadcast feature API/types/wizard, list/new/detail pages, and integrations in the existing router, navigation, top bar, health page, API client, and status badge. `docs/features/broadcast-campaigns.md` is the feature reference.

## Deliberately deferred

- Production authentication, membership, roles, and authorization (the development resolver is not a substitute).
- Production Auth/RBAC, Audience bulk import, Inbox close/reopen, SMS, Email, AI, Finance, Flows, and unrelated V2 features.
- Fake webhook controls or synthetic delivery data.
- Persistent worker heartbeat and production observability/alerting.

The next foundational step is production Workspace Membership/Auth. After that, WhatsApp account/template/audience management is the most useful feature slice because it lets operators satisfy Broadcast's real configuration contracts without direct database provisioning.
# Manual retry of failed recipients

On a current-WABA campaign in `COMPLETED_WITH_ERRORS`, the detail page offers **Retry Failed**. `GET /api/campaigns/:id/retry/preview` groups failed recipients into eligible, temporary restriction, permanent/unclassified, and uncertain categories without changing records. `POST /api/campaigns/:id/retry` requires `confirm: true` and an `Idempotency-Key`; it atomically claims the campaign, records a retry batch, and enqueues the existing BullMQ campaign job. A repeated key is idempotent. The worker rechecks the bound workspace, WABA, sender, approved template, credential, contact and account-specific consent before each send. Historical failures are not silently migrated to another sender or template.

`CampaignRecipient` keeps sanitized failure source/code/subcode/title/message, retry safety, provider retry time and bounded attempt history; `Campaign` keeps the batch claim. Retry `WhatsAppMessage` records use `retryRecipientId`, preserving the existing unique original-recipient index. Webhook correlation is by the current Meta message ID; stale attempt statuses cannot overwrite newer results. Counters are recomputed from recipient statuses, not incremented per attempt. A provider submission with an ambiguous timeout or worker exit is marked uncertain and never automatically resent. Only a definitive provider throttle with an explicit `Retry-After` can be automatically retried; unknown and legacy failures fail closed. Queue failure after the durable campaign claim is reconciled by the existing worker startup scan.

The UI displays a charge warning and requires explicit confirmation. Retry is not a guarantee of delivery or free messaging. Production deployment still requires trusted authentication/RBAC, real-provider staging verification, and operational monitoring; this feature has only mocked verification here.
