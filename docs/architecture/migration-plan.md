# EngageFlow migration plan

The old V2 application is a source for behavior discovery and architecture review, not a code template. It must remain untouched. Features will be migrated individually into this clean codebase after their data, security, tenancy, and operational behavior are understood.

## Principles

- Never copy the whole V2 project.
- Keep production data disconnected during foundation review.
- Add a feature to navigation only when it is implemented.
- Keep WhatsApp provider concepts separate from channel-neutral lifecycle concepts.
- Add dependencies when a migrated capability requires them, not in anticipation.
- Do not expose server secrets through Vite variables or browser code.

## Sequence

1. Review and approve the foundation, environment contract, and workspace boundary.
2. Migrate API Credentials as the next bounded feature, including encrypted-at-rest key material, one-time secret presentation, hashed key verification, revocation, workspace scoping, audit events, and tests.
3. Migrate WhatsApp API Campaign definitions without execution or provider calls.
4. Migrate execution persistence and status lifecycle.
5. Introduce the Meta provider integration only after credential and execution controls are approved.
6. Add queue infrastructure only when asynchronous execution is implemented.
7. Add additional WhatsApp features one at a time.
8. Consider SMS, then Email, only after WhatsApp architecture has proven stable.

SMS and Email are deliberately absent from the current navigation and implementation. Large universal channel models should wait until a second real channel exposes the shared behavior.
