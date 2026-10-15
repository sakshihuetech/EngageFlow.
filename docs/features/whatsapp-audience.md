# WhatsApp Audience

## Batch 3 import, bulk and detail

The existing Contacts tab includes Import CSV, row selection (maximum 100), bulk add/remove tag, ACTIVE/BLOCKED status changes, soft delete and restore, and a contact detail modal. No new sidebar entry or route is needed. Detail refetches the owned contact and uses existing edit/delete/restore APIs; it shows timestamps, consent/evidence, tags and bounded safe attributes. Secret-like historical attribute keys are suppressed from detail responses.

CSV accepts up to 2 MB, 5,000 rows and 50 columns, including quoted commas/newlines/escaped quotes. Users preview the first five rows and map Name, Phone, Email, semicolon-separated Tags, Lifecycle Stage, and optional custom-attributes JSON. Name/Phone are required. Validation runs read-only before explicit import confirmation. Request batches are capped at 100 rows and below the existing JSON payload limit; imports proceed sequentially, with progress/duplicate/invalid summaries. There is no new import worker or unbounded ingestion.

`POST /api/audience/contacts/import` accepts `items` and optional `preview: true`. The server normalizes phones, validates existing contact contracts, fixes source to CSV_IMPORT and consent to UNKNOWN, skips duplicate phones (including deleted contacts), and never overwrites existing consent or unrelated contacts. Unique-index races are counted as duplicates. A later failed batch does not roll back earlier successful batches; retrying safely skips records already imported. This safer duplicate policy intentionally does not silently restore deleted records during CSV import; use Restore explicitly.

`POST /api/audience/contacts/bulk` accepts 1–100 validated IDs, action ADD_TAG/REMOVE_TAG/STATUS/DELETE/RESTORE and tag/status values. Every update is scoped to the resolved workspace and applicable deletion state. Consent/history are not updated. Delete/restore require UI confirmation. `GET /api/audience/contacts/:id` returns a workspace-owned contact, including deleted records for explicit restoration.

V2 bulk actions were client-side calls to existing per-contact endpoints; its backend bulk create allowed 500 rows and stopped on duplicate errors after earlier rows could persist. V2's CSV parser did not handle quoted CSV correctly. The new bounded parser/validation/batching are safety improvements, not invented data. V2's contact detail adapter returned empty timeline/notes/campaignHistory arrays; no fake activity, notes persistence or engagement metrics are added. V2's UI offered Pending, but its contact PATCH accepted only ACTIVE/BLOCKED; Pending remains unsupported rather than introducing a new enum.

## Purpose and compatibility

`/whatsapp/audience` manages the V2-compatible `contacts` and `segments` collections used by WhatsApp Broadcast. EngageFlow reuses the existing documents; it does not seed, duplicate, or rewrite them. Collection names, ObjectId ownership, enums, indexes, consent fields, tags, attributes, timestamps, and deletion meanings remain unchanged. Runtime index creation remains disabled.

All endpoints are below `/api/audience` and receive the workspace from the existing resolver. `DEV_WORKSPACE_ID` is only the temporary development boundary; production must replace it with User -> Membership -> Workspace authorization.

## Contacts

Contacts support bounded cursor listing, escaped name/email/phone search, status filters, creation, update, soft deletion, and restoration. Phone input is normalized to E.164. The existing unique `(workspaceId, phoneE164)` contract prevents tenant-local duplicates while allowing the same phone in another workspace. Creating a phone whose prior record is soft-deleted restores the same document rather than inserting another.

Deletion sets `status: DELETED`; it does not physically remove the contact. Explicit restore changes only the status to ACTIVE. Re-creation of a deleted contact preserves existing consent unless an explicit OPTED_IN or OPTED_OUT value is supplied, matching V2 behavior.

Tags are trimmed, bounded, and deduplicated case-insensitively while preserving the first display spelling. Attributes remain a mixed JSON object for V2 compatibility, but request validation bounds size/depth and rejects prototype-pollution and secret-like keys. Updating attributes replaces that field only when explicitly supplied and does not silently remove it from unrelated updates.

## WhatsApp consent

Consent states remain `OPTED_IN`, `OPTED_OUT`, and `UNKNOWN`, with optional timestamp, source, and evidence. OPTED_OUT records receive `optedOutAt`; an explicit OPTED_IN clears it. UNKNOWN is never promoted to consent. Broadcast snapshotting and the worker continue to require an ACTIVE contact with OPTED_IN consent.

`CAMPAIGN_TEST_BYPASS_CONSENT` remains development/test-only. Production ignores it even if configured, and using it does not mutate a contact’s consent record.

## Segments

Segments support bounded listing, create, edit, and guarded deletion. Both STATIC and DYNAMIC V2 enum values are retained. Because the V2 schema stores definitions rather than a contact-membership array, both types use the persisted allowlisted condition definition; STATIC is a classification, not a new membership schema.

Definitions support ALL/ANY with at most 50 conditions over V2 fields: tags, status, source, WhatsApp consent, lifecycle/lead-score, ecommerce totals, and SaaS plan/MRR attributes. Operators are EQ, NE, CONTAINS, NOT_CONTAINS, GT, and LT. Member estimates are calculated server-side from ACTIVE contacts when a segment is created or edited and stored in `estimatedCount`.

A segment referenced by a DRAFT or other non-terminal campaign cannot be deleted. Safe deletion is workspace-scoped and does not cascade into campaigns or recipients.

## Broadcast dependency

The existing campaign and snapshot services remain authoritative. New Broadcast now accepts:

- an active segment;
- up to 1,000 selected workspace contacts;
- up to 1,000 pasted phone numbers.

Contact search in the wizard is server-side and bounded to 100 results per request. Segment definitions are evaluated on the server during launch. Pasted numbers remain fail-closed because they have no persisted opt-in evidence unless the existing development-only bypass is active. Launch continues to snapshot contacts in configured batches and recheck consent without moving filtering logic into the frontend.

## Scale notes

- Around 100 contacts: one cursor page can be sufficient, but the same bounded API is used.
- Around 1,000: search and cursor pagination prevent full browser loads; direct campaign contact selection is capped at 1,000.
- 10,000+: operators should use indexed segments rather than selecting individual contacts. Snapshotting remains batched by `CAMPAIGN_BATCH_SIZE`; Mongo query plans and attribute indexes should be measured for the actual segment mix.

No throughput capacity is claimed without load testing. Regex search is bounded but may require a dedicated search strategy at substantially larger scale.

## Migrated and deferred

Migrated: Contact and Segment CRUD, soft-delete/restore, consent, tags, attributes, cursor pagination, segment safety, Audience UI, and Broadcast audience-source integration.

Batch 3 additionally connects CSV mapping/validation/import, bulk mutations and contact detail. Saved background import jobs and arbitrary custom-field segment builders beyond the V2 allowlist remain separate work, as do unrelated channels. Inbox and API Campaigns are already migrated in their own feature documents. Production authentication/RBAC remains the primary prerequisite for exposing mutations outside a controlled development workspace.
