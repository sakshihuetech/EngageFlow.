# API Campaigns

API Campaigns expose approved WhatsApp templates to external systems without duplicating the WhatsApp sending stack. The production flow is `Bearer API key → workspace → stable campaign slug → Idempotency-Key → validation/consent → whatsapp-api-campaign-send → shared approved-template sender → webhook tracking → execution logs`.

## Endpoints

- Management: `/api/api-campaigns`, `/api/api-credentials`, `/api/api-campaign-executions` (resolved through the normal EngageFlow workspace context).
- V2-compatible external trigger: `POST /api/v1/whatsapp/api-campaigns/trigger`. This returns V2's top-level `{ accepted, idempotent, execution }` response and `Idempotent-Replay: true` on replay.
- Existing EngageFlow alias: `POST /api/v1/campaigns/trigger`. It uses the same trigger service and retains the EngageFlow `{ success, data, meta }` envelope, including `executionId`, `status`, and `replay` for existing clients.
- Required trigger headers: `Authorization: Bearer …`, `Idempotency-Key: …`, and `Content-Type: application/json`.
- Trigger body: `campaign`, E.164 `destination`, and `templateParams`; optional `userName`/`contactName`, `tags`, `attributes`, `source`, and supported HTTPS header `media`. Server-owned workspace, account, phone, and template identifiers are never accepted from the external caller. Request JSON is limited to 256 KB, attributes to 20 KB, and template parameters to the selected template's exact body variable count.

The same idempotency key and identical request return the existing execution. Reusing it for different input returns a conflict. The database unique index is the final concurrent-request guard.

Campaigns start as DRAFT and can become LIVE after the connected account, approved template, and send-ready phone pass server-side ownership checks. LIVE can be paused, PAUSED can resume to LIVE, and active campaigns can be archived. An archived campaign restores to DRAFT. Slug changes require explicit confirmation because existing external integrations will break. Template or phone rebinding is checked against the same workspace and account; a newly selected template gets a matching parameter schema.

Management routes also expose `/:id/analytics`, cursor-paginated `/:id/executions`, `/:id/executions/:executionId`, and `POST /:id/executions/:executionId/retry`. Execution Logs support campaign and status filters, detail refresh, timestamps, attempts, and sanitized failure details. Manual retry is limited to definitively safe FAILED executions. A provider message ID normally blocks retry; the narrow exception is a signed webhook-confirmed FAILED 429 with `failureSource: META_WEBHOOK`, accepted submission state and the original provider ID. Legacy records without that definitive marker fail closed.

## Credential security

Keys use the V2-compatible `oc_<prefix>_<secret>` format. Only a SHA-256 hash and non-secret prefix are stored. Full keys are returned once on creation or rotation. Authentication uses a timing-safe hash comparison. Lists and logs never contain hashes or full keys. Revocation is immediate; rotation creates a replacement and revokes the selected key.

## Delivery safety

Marketing templates require an active contact with `OPTED_IN` WhatsApp consent. The optional development bypass is ignored in production and does not mutate consent. Trigger enrichment can create or update a workspace contact but never changes consent. Queue payloads contain only an execution ID. A matching replay of a RECEIVED execution claims and re-enqueues the same execution; enqueue failure restores RECEIVED for another safe replay. BullMQ attempts are fixed at one so ambiguous provider submissions are never automatically resent. Explicit Meta 4xx rejection is classified separately from ambiguous timeout/submission. Stale `SENDING` executions are reconciled from an existing correlated WhatsApp message or marked uncertain.

The worker reuses `sendApprovedTemplateMessage`, existing encrypted Meta credentials, WhatsApp account/phone/template ownership checks, the `WhatsAppMessage` collection with `sendSource: API_CAMPAIGN`, and the existing webhook ingestion path.

## Operations

Run the worker separately:

```sh
npm run api-campaign:worker --workspace=@engageflow/backend
```

Configuration: `REDIS_URL`, `API_CAMPAIGN_WORKER_CONCURRENCY`, `API_CAMPAIGN_RATE_LIMIT_WINDOW_MS`, and `API_CAMPAIGN_RATE_LIMIT_MAX`. `API_CAMPAIGN_TEST_BYPASS_CONSENT` is development-only. Normal MongoDB, encryption, WhatsApp transport, and Meta settings remain shared.

The Developer UI contains only API Campaigns, Credentials, and Execution Logs. Campaign details organize Overview, Integration, and Executions internally. Generated examples use `VITE_API_URL` through the shared API client, match the campaign's parameter order/count, include media only for media headers, and always show `YOUR_API_KEY`, never a saved secret.

Production limits beyond V2 remain: the Developer management routes still use the development workspace resolver until Auth/RBAC is built, the campaign picker in Execution Logs is bounded to the first list page, and worker throughput has not been load-tested. No real Meta send was performed for Batch 2 verification.
# API Campaign retry (controlled staging)

External triggers retain their endpoint, bearer-key authentication and idempotency contract. New executions snapshot the original WhatsApp account, phone-number ID and approved template ID. Each execution remains the logical unit for analytics. A retry increments its durable `retrySequence` and `attempts`, retains sanitized failure history in `attemptHistory`, and uses a sequence-specific BullMQ job ID. The first accepted WhatsApp message keeps `apiCampaignExecutionId`; later accepted attempts use both `apiCampaignRetryExecutionId` and `apiCampaignRetrySequence`, so the existing unique first-attempt index remains valid. Recovery accepts only one message matching the exact execution and sequence. Legacy retry messages without a sequence, or duplicate matches, leave the outcome uncertain. Webhooks correlate the provider message ID with the current execution attempt; stale prior-attempt statuses are ignored. A failed webhook saves its provider ID in attempt history before a confirmed safe manual retry clears the current-attempt pointer.

Automatic retry is limited to an explicit Meta HTTP 429 with numeric provider code and a provider `Retry-After`. The delay is the larger of that restriction and bounded exponential backoff with jitter. Unknown provider outcomes, worker exits during submission, and permanent 4xx rejections never automatically resend. Manual retry requires `GET /api/api-campaigns/:id/executions/:executionId/retry/preview` eligibility and confirmation via the existing POST retry route. A retry is bound to its original sender, template, destination, parameters and contact; sender readiness and consent are checked before claiming and before sending. Legacy executions without saved sender binding fail closed.

Schema additions are optional fields in existing `apicampaignexecutions` and `whatsappmessages` collections; no migration or index command is run by this feature. Before any production rollout, an operator must inspect actual indexes with read-only `listIndexes` on both collections and compare them with the model definitions. Keep the existing unique `(workspaceId, apiCampaignExecutionId)` index. If production measurements justify additional indexes, separately approve and schedule a non-destructive background index on `(status, retrySequence, nextEligibleRetryAt)` for executions and `(workspaceId, apiCampaignRetryExecutionId, createdAt)` for messages. Do not drop/rebuild existing indexes or run `syncIndexes` automatically. Test on staging data first, including delayed webhooks and worker restart.

The isolated tests mock models, queue, sender, webhooks and outbound network. They do not verify real MongoDB index behavior, BullMQ recovery or provider timing; production readiness is not claimed.
