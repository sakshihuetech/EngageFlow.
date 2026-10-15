# Developer handover

Start with [README](../README.md), [architecture](architecture.md), [API inventory](api-reference.md), [data model](database.md), [queues](queues-workers.md) and [Meta lifecycle](whatsapp-meta.md). Then read the relevant `docs/features/` note and the code; older feature notes may describe migration intent rather than the exact current behavior. Do not infer a feature is operational merely because its page exists.

## First-day code tour

1. `package.json`, `frontend/package.json`, `backend/package.json`: supported scripts and dependency ranges. `frontend/src/routes/router.tsx` shows navigation and aliases; `frontend/src/services/api/client.ts` composes the API URL and maps timeouts/errors.
2. `backend/src/server.ts` and `backend/src/app.ts`: startup, middleware order and route prefixes. A wrong `/api` base is a common 404 cause.
3. `backend/src/routes/` → matching controller → service → Mongoose model. `backend/src/types/workspace.ts` is critical: normal dashboard workspace resolution is development-only, not login.
4. `backend/src/workers/`, `config/*queue*.ts`, Broadcast/API Campaign worker services and the shared WhatsApp sender. Read webhook handling before changing status/retry semantics.
5. `backend/src/models/` and [database notes](database.md): compare schema-declared indexes to the real deployment before any migration proposal.

## Safe development recipes

**New API:** add a route under the appropriate existing mount, validate inputs in controller/service, use the server-derived workspace plus account/phone where needed, return sanitized errors, add tests for wrong-workspace access and failure. Do not expose a feature route before proper authentication is designed. Update the [API reference](api-reference.md).

**New frontend feature:** reuse the existing React Router/Outlet hierarchy and shared API client; feature-specific components/services belong under `frontend/src/features/` or matching page modules. Show loading, empty, error and disabled states. Do not place Meta credentials in browser state, URLs or `VITE_` variables. Update route/feature tests.

**Model or index change:** inspect old documents and actual live indexes read-only first; design backward-compatible defaults and an explicit rollout. `autoIndex:false` means changing a schema does not update a deployed index. Never make startup drop/rebuild indexes. Check workspace + WABA isolation, webhook correlation and retry history. Obtain separate approval for live migration.

**New queue job:** choose a deterministic job ID, persist durable business state before enqueue, implement an atomic worker claim and revalidation, classify definitive vs ambiguous provider outcomes, and test duplicate/restart/delayed-webhook cases with mocks. Do not rely on BullMQ `attempts` for unsafe provider resend. Add queue health and shutdown handling, and document the worker command.

## Commands and safe testing

| Command (repository root) | Purpose |
| --- | --- |
| `npm run dev:backend`, `npm run dev:frontend` | Local API and Vite, separately. |
| `npm run campaign:worker --workspace backend`, `npm run api-campaign:worker --workspace backend` | Separate workers; **only with an isolated safe queue**. |
| `npm run test`, `npm run lint`, `npm run build`, `npm run check` | Root workspace checks; `check` combines lint, test and build. |
| `npm run typecheck --workspace backend`, `npm run typecheck --workspace frontend` | TypeScript checks. |
| `npm run test --workspace backend`, `npm run test --workspace frontend` | Focused workspace test suites. |

Do not point tests/workers at real Meta, MongoDB or Redis. Inspect test setup before running any integration test; use mocks and isolated data. The commands above are verified script names, **not claims that they passed** for this documentation-only change.

## Troubleshooting map

| Symptom | Inspect first | Important distinction |
| --- | --- | --- |
| UI 404 or timeout | Browser request URL, `VITE_API_URL`, `client.ts`, `app.ts` mount, backend port/CORS | The client normalizes an `/api` suffix; Setup refresh can take longer than ordinary requests. |
| Setup says connected but phone cannot send | Setup refresh result, phone registration/name status, WABA/phone binding and credential state | Historical records are not active sender readiness. Provider outage is not phone deletion. |
| Template stale/pending | Template sync endpoint/service and Meta response | Asset refresh does not sync template approval. |
| Campaign queued/stuck | DB state, queue counts, separate worker logs/heartbeat, Redis and sender readiness | API health does not mean worker is running. Do not replay an ambiguous send. |
| ACCEPTED but no delivery | Stored `wamid`, signed webhook arrival, status correlation, Meta app `messages` subscription | Acceptance is not delivery; later failure can explain missing delivery. |
| API `INVALID_API_KEY` / rate limit error | Bearer format, active credential/workspace, Redis readiness and limiter | Do not log or echo a key/hash. Rate limiter intentionally fails closed. |
| `CONSENT_NOT_OPTED_IN` | Contact status, account-scoped consent source/evidence, trigger vs worker checks | Development bypass may be narrower than expected; do not disable production enforcement. |
| 131037 / 131042 | Sanitized provider response and current phone/payment state | Do not change sender selection based on error text alone. |

## Feature status and production gaps

Here **Implemented** means code paths exist; it does not imply a successful live test. **Requires live verification** means an external fact cannot be proven from source.

| Feature | Status | Evidence / remaining limit |
| --- | --- | --- |
| Setup, Standard registration, refresh | Implemented; requires live verification | Setup controllers/services and phone reconciliation; Meta asset/registration state must be checked live. |
| Coexistence | Partial; requires live verification | Guarded onboarding path exists; app configuration/eligibility is external. |
| Templates and Meta library | Implemented; requires live verification | Routes/services for sync/create/edit/delete/library; provider approvals and category eligibility are external. |
| Contacts, tags, segments, consent | Implemented | Audience routes/models; no separate Tag collection; historical consent quality not verified. |
| Broadcast and retry | Implemented; scale not verified | Routes, queue, worker, webhook. Controlled staging and crash/rate-limit behavior remain necessary. |
| API Campaign and retry | Implemented; rollout not verified | External key/trigger/worker/execution paths; deployed indexes and multi-attempt correlation need review. |
| Inbox and reply | Implemented; requires live verification | Signed inbound webhook/conversation/reply path; no multi-agent permission system. |
| Real login and RBAC for dashboard | Not implemented | Fixed non-production workspace resolver, no trusted user identity model. P0 before real multi-tenant deployment. |
| SMS/email, chatbot/workflow automation, provider-wide pacing/cost controls | Not implemented | No corresponding production pipelines in current source. |
| End-to-end production throughput / live Meta readiness | Requires live verification | Mocked tests cannot prove 100/1k/10k/50k sending or provider account state. |

Priority next steps: (1) trusted authentication/RBAC and audited workspace resolution; (2) review/install compatible indexes and validate retry-attempt/webhook correlation in isolated staging; (3) controlled Meta onboarding, phone, template and webhook verification; (4) load/throughput and provider-wide pacing tests, queue/DB monitoring, retention and cost controls. Do not claim production readiness until these are independently verified.
