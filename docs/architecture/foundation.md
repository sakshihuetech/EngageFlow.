# EngageFlow foundation architecture

## Frontend

The frontend is a React and TypeScript Vite application. `App` owns the router boundary, `AppLayout` composes the persistent sidebar and topbar, and nested pages render through React Router's `Outlet`. Navigation is declared in one typed configuration so groups can be extended without restructuring the shell.

Reusable visual primitives live under `src/components/ui`; app-level patterns such as page headers, states, and table framing live under `src/components/common`. Domain behavior belongs under `src/features`, not in layouts or pages.

The responsive layout uses a fixed desktop sidebar and an accessible mobile drawer. Tables scroll inside their own surface at narrow widths instead of forcing the whole page to overflow.

## Backend

The backend is an Express and TypeScript service. Routes delegate to controllers, controllers use services, and middleware owns cross-cutting HTTP concerns. Environment values are parsed and validated once during startup.

The HTTP foundation includes:

- controlled CORS from `FRONTEND_ORIGIN`;
- a 256 KB JSON body limit;
- request IDs accepted only in a constrained format or generated with `randomUUID`;
- safe security headers and disabled Express identification;
- a centralized error response shape;
- structured logging with sensitive metadata-key redaction;
- graceful `SIGINT` and `SIGTERM` shutdown.

No database or provider connection is created in this phase.

## Routing

| Route | Page |
| --- | --- |
| `/` | Dashboard |
| `/whatsapp/api-campaigns` | API Campaigns shell |
| `/developer/api-credentials` | API Credentials shell |
| `/developer/executions` | Execution Logs shell |
| `/system/health` | System Health |
| `/settings` | Settings shell |

Unknown frontend routes render a branded not-found page. Unknown API routes return the standard JSON error envelope.

## API client

All browser HTTP calls go through `src/services/api/client.ts`. The client reads `VITE_API_URL`, normalizes errors, applies an eight-second timeout, and returns typed response data. Pages never call `fetch` directly. The initial client exposes only liveness and readiness calls.

## Health checks

`GET /api/health/live` confirms that the Node process can serve requests. `GET /api/health/ready` exposes explicit MongoDB and Redis dependency slots. Both are `NOT_CONFIGURED` until their migrations are deliberately implemented. Unconfigured optional dependencies do not make the foundation process unavailable.

Responses use a standard envelope:

```json
{
  "success": true,
  "data": {},
  "meta": { "requestId": "..." }
}
```

## Auth-ready workspace boundary

`WorkspaceContext` and `WorkspaceResolver` define the future boundary without inventing a user or trusting a development-only header. The current resolver intentionally resolves no workspace. A later authentication migration should implement the chain:

`JWT → User → Membership → Workspace → feature service`

Routes requiring tenancy should receive a resolved context through middleware only after authentication and membership rules exist.
