# WhatsApp Templates

EngageFlow uses the existing V2 `whatsapptemplates` collection and unique `(workspaceId, whatsappAccountId, metaTemplateId)` identity. All template mutations resolve the connected workspace, WhatsApp account, WABA, and decrypted Meta credential on the server. No token or encrypted credential is sent to the browser.

## Create, edit, and delete

`POST /api/whatsapp/templates` validates a V2-compatible authoring payload before submitting it to Meta. It requires a lowercase template name, supported language and category, a body of at most 1,024 characters, sequential body variables with one example each, and supported header, footer, and button shapes. Text headers are limited to 60 characters without variables, formatting, line breaks, or emoji. IMAGE/VIDEO/DOCUMENT headers require a Meta upload handle. At most three QUICK_REPLY, URL, or PHONE_NUMBER buttons are supported; dynamic URLs permit one trailing `{{1}}` with a full example URL. The saved record uses Meta's returned ID and actual status, never an invented approval state.

`PATCH /api/whatsapp/templates/:id` is limited to workspace-owned, active CUSTOM templates in APPROVED, REJECTED, or PAUSED state. It submits components to Meta first, refetches the current provider state, then updates the local record. Library templates and pending templates are not editable in this editor. `DELETE /api/whatsapp/templates/:id` deletes in Meta first, then marks the scoped local record inactive with `deletedAt` and `deleteSource: USER`, preserving history. A previously inactive record is idempotent. V2 had no active-campaign delete guard; an in-flight campaign snapshot may still reference a deleted provider template, so operators should check active campaigns before deleting.

## Media examples

`POST /api/whatsapp/templates/media` accepts one multipart file. Server validation checks header type, MIME, extension, byte size (JPEG/PNG 5 MB, MP4 16 MB, PDF 100 MB), and magic signature. Temporary uploads are removed after processing. The shared Graph service creates a resumable upload session through `META_APP_ID` and streams the file to Meta. The browser receives only the resulting example handle, not an access token. Sync preserves a media handle if Meta omits it from a later template-list response.

## Real Meta library

`GET /api/whatsapp/templates/library` reads Meta `message_template_library` with category, language, search, topic, usecase, industry, and bounded cursor pagination. The Templates page displays the live provider list, not curated local templates. `POST /api/whatsapp/templates/library/use` refetches the selected name/language server-side (up to ten bounded pages), validates supported body and button inputs, submits `library_template_name` for the connected WABA, and stores the provider ID/status with source `META_LIBRARY`. A missing provider status is treated as an unknown state requiring sync, not approval.

## Status, sync, and send integration

The existing signed WhatsApp webhook processes `message_template_status_update` on the same route as message delivery. It requires a unique WABA account mapping and a matching active template in that workspace/account. Unknown or ambiguous mappings are ignored; duplicate status/reason events do not write again; timestamped older events are ignored. Rejection reason is stored for REJECTED and cleared on a later non-rejected state. Sync remains a real Meta read with scoped upserts/deactivation and status reconciliation.

Broadcast and API Campaign template selectors continue to use active, approved workspace-owned templates. No send stack or campaign behavior was changed. A newly submitted PENDING or REJECTED template is not selectable; approval via webhook or sync makes it eligible without manual database edits.

## Operational boundary

Automated tests mock or avoid provider calls and do not send Meta messages. Live create/edit/delete/library/media require a valid connected WABA credential; media additionally requires `META_APP_ID`. The feature does not add Auth/RBAC or change the existing workspace resolver. Provider permissions, billing, webhook subscription, and live Meta acceptance must still be verified in the target deployment.
