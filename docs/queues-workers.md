# Redis, BullMQ and worker operations

Redis is used for BullMQ jobs, worker heartbeats/queue health, and the external API Campaign trigger's fail-closed rate limiter. MongoDB remains the source of business state and attempt history; a BullMQ job alone is not a delivery record. Queue definitions are in `backend/src/config/campaign-queue.ts` and `api-campaign-queue.ts`. Workers do **not** start with `backend/src/server.ts`.

| Pipeline | Queue / job | Producer → processor | Command |
| --- | --- | --- | --- |
| Broadcast | `whatsapp-campaign-send` / `dispatch`; `{workspaceId,campaignId,sequence}` | Broadcast launch/schedule/retry services → `backend/src/services/broadcast/worker.service.ts` | `npm run campaign:worker --workspace backend` |
| API Campaign | `whatsapp-api-campaign-send` / `send`; `{executionId,retrySequence?}` | Authenticated trigger/manual or automatic retry → `backend/src/services/api-campaign/worker.service.ts` | `npm run api-campaign:worker --workspace backend` |

Both run as separate Node processes via `backend/src/workers/campaign.worker.ts` and `api-campaign.worker.ts`, connect to MongoDB/Redis, install signal shutdown handlers, and emit worker heartbeat state. The Broadcast worker reconciles at startup and every 60 seconds; the API worker reconciles at startup. The queue's BullMQ `attempts` is **1**; eligible retry is decided by application services, not a blanket BullMQ retry. Completed/failed queue jobs have finite retention settings, while MongoDB attempt history is the durable audit source.

## Safety and flow

1. API/controller validates account, phone, approved template, recipient/consent and campaign state, then persists a campaign snapshot or API execution.
2. Producer enqueues a deterministic job ID (campaign ID+batch sequence, or execution ID+retry sequence). MongoDB state/atomic claims are also needed because queue job IDs alone cannot guarantee exactly-once provider delivery.
3. Worker revalidates original workspace/WABA/sender/template/consent before using `send-approved-template.service.ts`; it persists provider acceptance, a definitive sanitized failure, or an uncertain outcome. An uncertain/ambiguous provider submission must not be blindly replayed.
4. Signed Meta webhooks correlate a provider message ID (`wamid`) and advance statuses. `ACCEPTED` is not `SENT`/`DELIVERED`/`READ`.

`CAMPAIGN_WORKER_CONCURRENCY`, `CAMPAIGN_BATCH_SIZE`, and `API_CAMPAIGN_WORKER_CONCURRENCY` bound local work. API trigger rate limit uses `API_CAMPAIGN_RATE_LIMIT_WINDOW_MS` and `API_CAMPAIGN_RATE_LIMIT_MAX` via `api-campaign-rate-limit.ts`; Redis outage returns `RATE_LIMIT_UNAVAILABLE` rather than fail-open. These are **not** proof of provider-wide throughput pacing, Meta rate-limit compliance or 10k/50k-recipient capacity. Provider retry-after and safe transient classification exist in retry services; confirm actual behavior with isolated tests before changing policy. See feature notes for [Broadcast retries](features/broadcast-campaigns.md) and [API retries](features/api-campaigns.md).

## Troubleshooting without sending

- Check `/api/health/ready`, API logs, both **separate** worker logs, Redis connectivity and heartbeat; liveness alone is insufficient.
- Compare queue waiting/active/delayed/failed counts with MongoDB campaign/recipient/execution states. Do not manually replay a job before deciding whether Meta may have accepted the previous attempt.
- If an execution is stuck, inspect its latest attempt, deterministic job ID, worker claim, provider `wamid` and signed webhook evidence. A delayed webhook may resolve an uncertain-looking state. Never reset a status simply to force resend.
- For `TRANSPORT_NOT_CONFIGURED`, check `CAMPAIGN_TRANSPORT`, `CAMPAIGN_LIVE_SEND_ENABLED`, sender readiness and credential presence without printing values. `mock` and `disabled` are not live Meta delivery.
- For `RATE_LIMIT_UNAVAILABLE`, inspect Redis readiness and `api-campaign-rate-limit.ts`; do not bypass the limiter.
- For provider 4xx, inspect sanitized error code/title and distinguish permanent rejection from explicit 429/retry-after. Do not infer retry safety from HTTP class alone.

For development, use isolated test DB/Redis and mock Meta HTTP. Backend queue configs explicitly reject real Redis in `NODE_ENV=test`, but that guard is not a substitute for reviewing the command and environment before starting a worker. Do not use production `.env`, queues, credentials or existing campaigns for a local test.
