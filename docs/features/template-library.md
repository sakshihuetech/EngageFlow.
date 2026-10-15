# Meta Template Library creation

The library page reads bounded Meta library results through the EngageFlow API. “Create in Meta” sends the selected library name, language, new name and supported optional inputs to `POST /api/whatsapp/templates/library/use`. The backend re-fetches that library entry, resolves the workspace's connected WABA and server-side credential, then posts to Meta's `/{waba-id}/message_templates`. Only after Meta returns a template ID and status does EngageFlow upsert the local `WhatsAppTemplate` record.

For a Meta rejection, this route now returns an allowlisted diagnostic: HTTP status, numeric Meta code/subcode, sanitized title/message and safe trace ID when present. The dialog shows the explanation and code. Tokens, authorization headers, raw provider payloads and customer data are not returned. No template payload, WABA resolution or persistence behavior changed.

Changed files: `backend/src/services/whatsapp/meta-graph.service.ts`, `backend/src/controllers/whatsapp.controller.ts`, backend API error utilities/types, `frontend/src/services/api/client.ts`, `frontend/src/services/api/types.ts`, `frontend/src/pages/MetaTemplateLibraryPage.tsx`, `frontend/src/features/whatsapp/library-error.ts`, and focused tests.

Remaining: Meta may reject an authentication library entry due to its item-specific requirements, WABA eligibility or permissions. Diagnose using the new sanitized provider code/message/trace; do not assume a cause or retry live creation blindly. Provider-only detail fields not on the allowlist remain intentionally unavailable to the browser.
