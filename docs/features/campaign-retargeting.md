# Broadcast Campaign Retargeting (authorization-gated)

The Broadcast list and detail pages offer **Retarget** for completed campaigns. The modal offers `READ`, `DELIVERED_NOT_READ`, and definitive provider `FAILED` audiences, masked cursor-paginated preview, exclusion counts, compatible approved templates on the original WABA, and follow-up draft creation. `REPLIED` remains disabled: campaign-specific reply attribution is not yet reliable enough for this filter. Creating a draft neither sends a message nor adds a BullMQ job.

## Security state

The current dashboard has no trusted login, workspace membership, or RBAC. `backend/src/middleware/require-retargeting-access.ts` therefore rejects **all** new retargeting routes with `503 RETARGETING_AUTH_REQUIRED`, including local development and public Dev Tunnels. Loopback binding, CORS, `NODE_ENV`, `DEV_WORKSPACE_ID`, Origin/Host headers, and frontend-supplied IDs are not authentication. This feature is **not usable in the running app yet**. Replace this single guard with authenticated identity → workspace membership → retarget permission checks that set `request.workspaceContext` from that identity before enabling any endpoint; keep the service's workspace and WABA predicates. Do not insert the development workspace resolver after the future guard. Existing unauthenticated Broadcast routes are outside this feature and remain a separate production blocker.

## Flow and API (currently guard-blocked)

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/campaigns/:id/retargeting/preview?filter=READ&limit=25&cursor=…` | Bounded source-recipient scan, current consent/opt-out eligibility, aggregate exclusions, masked recipient page. |
| GET | `/api/campaigns/:id/retargeting/templates` | Up to 100 approved templates on the source WABA whose parameter/media requirements match the source mapping. |
| POST | `/api/campaigns/:id/retargeting/draft` | Requires `Idempotency-Key` and `{filter,templateId,name}`; server derives recipients and sender. Creates a DRAFT and immutable recipient snapshots in a MongoDB transaction. |

The service verifies the source campaign belongs to the trusted workspace, is complete, and retains its original account. Selection is server-side: `READ` wins over delivered/failed; delivered without read is next; `FAILED` requires a definitive Meta API or webhook failure (not uncertain submission). Missing/inactive contacts, changed or invalid phones, opted-out or missing sender-scoped consent, and duplicate phones are excluded. The source scan is capped at 50,000 records and queries in 250-record batches. This cap is a safety bound, **not** a verified 50k performance claim.

`Campaign` reuses the existing `campaigns` collection and unique `(workspaceId,idempotencyKey)` index. New optional fields: `sourceCampaignId`, `retargetingFilter`, `retargetingSourceAccountId`, `retargetingSourceWabaId`, `snapshotAt`; `audienceDefinition.source` is `RETARGET`. `CampaignRecipient` reuses `campaignrecipients` with optional `sourceRecipientId` and `sourceStatus`, plus existing consent/parameter/contact snapshots. No new collection, index, migration, original-campaign update, or historical deletion is performed. Existing indexes are not modified automatically (`autoIndex: false`); verify the existing idempotency index before any future enablement.

The existing Broadcast launch path recognizes only the new `RETARGET` audience branch and uses persisted draft recipients instead of rebuilding them from live contacts. Existing sender, approved-template, queue, live-send, and worker checks remain. The worker additionally uses strict sender-scoped consent and `optedOutAt` rechecks for retargets even if a development bypass is enabled, and skips a recipient if the source outcome no longer matches. There is still a small read-to-provider race for a late webhook; this requires controlled staging tests before production enablement. A disconnected original WABA/phone cannot be silently replaced and fails existing sender readiness.

## Files and verification boundary

- Backend: new access guard, retargeting routes/controller/service; optional lineage fields in Campaign and CampaignRecipient; narrowly scoped `RETARGET` launch/worker branch; Broadcast serializer additions.
- Frontend: shared Retarget modal/API types and actions in Broadcast list/detail. Follow-up drafts show source linkage and status; their immutable snapshots are not editable or duplicable through the existing wizard.
- Tests: `backend/tests/retargeting.test.ts` uses mocks/in-memory Express requests; no MongoDB, Redis, Meta, live worker, or WhatsApp send. Full staging verification of MongoDB transactions, large snapshots, delayed webhooks, UI interaction, and sender readiness remains pending.
