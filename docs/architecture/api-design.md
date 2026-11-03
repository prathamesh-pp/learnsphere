# LearnSphere API design

**Status:** implemented APIs include registration/login/session management and MFA, organization access and membership, organization-scoped courses and curriculum, validated lesson content, server-limited video progress, and the Cloudinary private-media lifecycle. Cloudinary upload operations fail closed when unconfigured; student media delivery is disabled until the real account's private video and raw-file delivery smoke tests are confirmed.

## REST conventions

- Base path: `/api/v1`. Keep `/api/health` as an unversioned infrastructure probe or move it to `/health` only as an explicit deployment decision.
- Use nouns and resource nesting where ownership is clear: `/courses/{courseId}/enrollments`, `/organizations/{organizationId}/members`. Avoid verbs in paths except explicit commands where a state transition cannot be represented cleanly.
- Use plural kebab-case resource names, opaque IDs, ISO-8601 UTC timestamps, and JSON `application/json`. Multipart uploads go directly to object storage using presigned grants.
- Use `POST` to create, `GET` to read, `PATCH` for partial updates, and `DELETE` for a documented deletion/withdrawal action. Archival and other state transitions use explicit commands such as `POST /.../{id}/archive` or `POST /.../{id}/publish` with a request schema and permission.
- `DELETE` means a user-requested deletion/withdrawal transition or, where allowed, removal; document the resulting deletion/purge workflow and retention exceptions. Archival is a separate explicit command such as `POST /courses/{id}/archive` and may be reversible. Do not overload `DELETE` to mean archive.
- Idempotent creation/payment/submission requests accept an `Idempotency-Key`; server scopes it to principal + operation, stores outcome, and rejects conflicting reuse.
- API versioning is explicit. Additive fields are backward compatible; breaking changes require a new major path or negotiated version and a deprecation window.

## Request and response envelopes

Successful single-resource response:

```json
{
  "data": { "id": "opaque-id", "createdAt": "2026-01-01T00:00:00.000Z" },
  "meta": { "requestId": "request-id" }
}
```

Collection response:

```json
{
  "data": [],
  "page": { "nextCursor": null, "hasMore": false },
  "meta": { "requestId": "request-id" }
}
```

Error response:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request could not be accepted.",
    "details": [{ "field": "title", "code": "too_small" }]
  },
  "meta": { "requestId": "request-id" }
}
```

Do not expose stack traces, database messages, secrets, or authorization internals. Validation details may identify an input field but not disclose hidden resource existence. Common statuses: `200` read/update, `201` created, `202` accepted for async work, `204` successful no-content delete, `400` malformed/invalid request, `401` unauthenticated, `403` unauthorized, `404` absent or intentionally concealed, `409` stale version, duplicate/idempotency conflict, or invalid resource state transition, `422` syntactically valid input that violates a domain rule without a state conflict, `429` rate limit, `500` safe generic error, `503` dependency unavailable. Use one stable error mapping across modules.

Infrastructure health is separate from versioned product resources: retain the current unversioned `GET /api/health` compatibility route as a liveness check, and add deployment-facing `/health/live` and `/health/ready` endpoints by explicit implementation. Liveness indicates the process can run; readiness checks required dependencies (MongoDB and, where that process requires it, Redis) and returns unavailable when traffic cannot be served safely. Do not make readiness execute destructive checks or expose credentials/provider detail.

## API module map

Every route below is illustrative and must be protected by module-specific permission and tenant policy.

| Module | Example endpoints |
|---|---|
| Identity/session (implemented) | `POST /auth/register`, `POST /auth/login`, `POST /auth/recovery`, `GET /auth/csrf`, `GET /auth/me`, `POST /auth/logout`, `POST /auth/session/rotate`, `GET /auth/mfa/totp`, `POST /auth/mfa/totp/setup`, `POST /auth/mfa/totp/confirm` |
| Organizations/access | `POST /organizations`, `GET/PATCH /organizations/{id}`, `POST /organizations/{id}/invitations`, `POST /organization-invitations/accept`, `GET /organizations/{id}/members`, `PATCH/DELETE /organizations/{id}/members/{userId}`. Organization roles are fixed bundles; custom roles and company details are not implemented. |
| Profiles (planned) | `GET /profiles/{userId}`, `PATCH /users/me/profile`, `PATCH /users/me/profile-visibility` |
| Courses/catalog/media (Phase 4/5.1/5.2.1 implemented) | `POST /instructor/courses/{courseId}/lessons/{lessonId}/media-upload-grants`; `PUT /instructor/courses/{courseId}/lessons/{lessonId}/media-upload-intents/{intentId}/content` (authenticated streaming upload; returns only after provider and database verification); `GET /courses/{courseId}/lessons/{lessonId}/media-assets/{assetId}/access?disposition=inline|attachment`; `DELETE /instructor/courses/{courseId}/lessons/{lessonId}/media-assets/{assetId}`; lesson and progress routes as above |
| Cohorts | `POST /organizations/{id}/cohorts`, `POST /cohorts/{id}/members`, `POST /cohorts/{id}/courses`, `GET /cohorts/{id}` |
| Assessments | `POST /courses/{id}/assignments`, `POST /assignments/{id}/submissions`, `GET /assignments/{id}/submissions`, `POST /submissions/{id}/grade`, `POST /quizzes/{id}/attempts` |
| Live classes | `POST /courses/{id}/live-classes`, `POST /live-classes/{id}/join-token`, `POST /live-classes/{id}/attendance`, `GET /live-classes/{id}/recording` |
| Jobs/employers | `POST /organizations/{id}/jobs` (organization must be `kind=company`), `GET /jobs`, `POST /jobs/{id}/applications`, `GET /organizations/{id}/applications`, `PATCH /applications/{id}/status` |
| Community | `GET/POST /spaces`, `GET/POST /spaces/{id}/posts`, `POST /posts/{id}/comments`, `PUT/DELETE /users/me/follows/{userId}`, `POST /reports` |
| Projects | `POST /projects`, `POST /projects/{id}/members`, `POST /projects/{id}/milestones`, `POST /projects/{id}/comments`, `GET/POST /projects/{id}/tasks`, `PATCH /projects/{id}/tasks/{taskId}` |
| Mentorship | `GET /mentors`, `PUT /users/me/mentor-availability`, `POST /mentorship-requests`, `POST /mentorship-requests/{id}/accept`, `POST /mentorship-requests/{id}/bookings`, `GET /mentorship-bookings/{id}` |
| Commerce | `POST /checkout-sessions` (server loads active `offer` and computes amount), `GET /orders/{id}`, `POST /orders/{id}/refunds` (permission and provider reconciliation required), `POST /webhooks/payments/{provider}` (provider-authenticated, not user cookie auth; sandbox only in test environments initially) |
| Messaging/notifications | `GET /conversations`, `POST /conversations/{id}/messages`, `GET /notifications`, `PATCH /notifications/{id}` |
| Assets | `POST /assets/upload-grants`, `POST /assets/{id}/complete`, `GET /assets/{id}/download-grant`, `DELETE /assets/{id}` |
| Admin/analytics | `GET /organizations/{id}/reports/...`, `GET /admin/cases`, `POST /admin/cases/{id}/actions`, all permission-gated and audited |
| Integrations | `POST /organizations/{id}/webhook-endpoints`, `GET /integrations`, `POST /integrations/{id}/test` where provider supports a real test, and future `POST/GET /organizations/{id}/api-clients` (Release 3 only) |

Do not build every route in this map before the roadmap calls for it. Keep public discovery endpoints separate from authenticated tenant data. Administrative support routes use separate permissions and stronger audit requirements.

The organization/access routes listed above are implemented in the API. With no email provider configured, invitation creation reports `delivery: not_configured` and returns a share token once for manual delivery. Organization reads are concealed as 404 without active membership; organization mutations require an active organization-scoped administrator permission. PLATFORM_ADMIN grants do not satisfy organization permissions.

Course routes are implemented for organization-owned courses. Creation requires `course.create` membership in the selected organization; instructor management is limited to courses they own, while organization/company admins can manage courses within their tenant subject to MFA. Curriculum routes validate all section/lesson IDs against that course and tenant and mutate transactionally. Lesson access requires current organization membership, active enrollment, and published course/lesson state. Media grants additionally require a draft managed course, an existing lesson of the matching content type, and a current authorized instructor. The API streams file bytes to Cloudinary using a server-signed SDK request; the browser receives no provider key or secret. Provider upload responses and Admin API metadata are verified before an asset is attached in a MongoDB transaction. Student access grants re-run lesson authorization and verify exact tenant/course/lesson ownership. See [Cloudinary media lifecycle](../media/cloudinary.md) for formats, limits, and account verification.

The lesson content contract uses a `contentData` discriminated union (`text`, `video`, `document`, `resource`, or `external_link`). Legacy `text`, `external_video`, and `resources` records continue to be served. Media maximums are 100,000,000 bytes for MP4 and 10,000,000 bytes for raw documents/resources. Incomplete draft media lessons cannot be published. A Cloudinary private-download grant lasts five minutes; API responses are non-cacheable. `CLOUDINARY_PRIVATE_DELIVERY_VERIFIED` must remain false until a real account's private video and raw PDF delivery checks pass. Unverified or unconfigured operations return sanitized errors rather than public URLs.

## Authentication and authorization

- Initial web authentication uses opaque server-side sessions in `Secure`, `HttpOnly`, `SameSite` cookies over TLS. Unsafe cookie-authenticated requests require CSRF protection and Origin validation. Rotate session IDs after login, privilege changes, and account recovery; revoke on logout, credential/identity change, suspension, and risk events. Session bearer values are never stored in browser local/session storage.
- Require MFA for COMPANY_ADMIN, ORGANIZATION_ADMIN, and PLATFORM_ADMIN. Account recovery uses single-use expiring hashed tokens through a real selected email provider, rate-limits requests, avoids account enumeration, and revokes existing sessions on success. Email provider selection and delivery operations remain an implementation prerequisite.
- Authenticate before loading protected objects; authorize every action against policy inputs: actor, permission, resource, relationship, tenant membership, resource state, and consent.
- The seven bundles are STUDENT, INSTRUCTOR, RECRUITER, COMPANY_ADMIN, MENTOR, ORGANIZATION_ADMIN, and PLATFORM_ADMIN, as detailed in the product-requirements matrix. Users may have multiple bundles per organization. Example permissions: `course.read`, `course.publish`, `member.invite`, `job.application.read`, `recording.download`. Resource ownership, membership, consent, and state still constrain a granted action. Tenant roles cannot grant platform permissions.
- Organization context is resolved server-side and verified for each call. An organization selector is a hint, not proof. Platform support access uses a distinct audited policy.
- Return `403` or concealed `404` consistently; do not leak whether private users, job applications, or tenant resources exist.
- Use rate limits per IP, principal, tenant, and sensitive operation. Add stricter controls for login, invitation, search, uploads, messaging, AI, payment initiation, and webhooks.
- Webhook auth verifies provider signatures against raw request bytes, timestamp/replay window, event ID, and expected account/tenant. Never accept normal user authorization as webhook proof.
- Organization-configured webhook delivery URLs are outbound SSRF targets: require HTTPS, reject IP literals and private/reserved IPv4/IPv6, validate all DNS answers at connection time, block loopback/link-local/cloud metadata, disable redirects or revalidate each redirect, mitigate DNS rebinding, cap response/redirect/time, and apply egress controls where practical. Revalidate on endpoint edit and before every delivery. Secrets are rotated and kept in a secret manager.

## Pagination, filtering, and sorting

- Use opaque cursor pagination with stable ordering (`createdAt` + `_id`) and a reasonable default/max page size (proposed 25/100). Return `nextCursor` and `hasMore`; cursors are validated and may be signed.
- Allowlist filter and sort fields per endpoint. Never translate arbitrary client field names or Mongo operators into queries.
- Use normalized query parameters (e.g. `status`, `courseId`, `q`, `sort=createdAt`, `order=desc`). Bound search length, filter counts, date ranges, and result size.
- Apply tenant/visibility filters before pagination and counts. Avoid returning total counts when expensive or unnecessary.
- Use a dedicated search index/provider if marketplace text/faceted needs exceed indexed MongoDB query capabilities. Search results must enforce current visibility and access at read time.

## Async operations and state transitions

- Long-running upload processing, exports, recordings, and bulk reports return `202 Accepted` with an authorized operation/resource ID and current state endpoint; no fake completion response.
- Payment checkout returns a provider redirect/session reference only after the provider creates it. Entitlement depends on verified provider event/reconciliation, not browser redirect.
- State-changing requests use explicit allowed-transition rules and return `409` on stale/invalid current state. Use `ETag`/`If-Match` for concurrent edits where useful.
- Durable commands write state/outbox transactionally where supported; workers and webhook handlers are idempotent and emit observable job status.

## WebSocket and real-time event conventions

- Socket.IO namespace: `/realtime`; authenticate handshake, then authorize resource subscriptions on the server. Room IDs are server-derived; never trust client-selected tenant or room IDs.
- All server events use lowercase dot-delimited `<resource>.<action>.v1`, with multiword resource names kebab-cased, matching system architecture; examples: `conversation.message.created.v1`, `notification.created.v1`, `live-class.participant.changed.v1`, `job-application.status.changed.v1`, and `operation.status.changed.v1`. Keep names stable and version payload schemas. REST is the durable write path in the initial contract; Socket.IO fanout is server-originated, with acknowledgements indicating command acceptance only where a future command is explicitly defined.
- Example server event payload:

```json
{
  "eventId": "opaque-id",
  "type": "conversation.message.created.v1",
  "occurredAt": "2026-01-01T00:00:00.000Z",
  "resource": { "type": "conversation", "id": "opaque-id" },
  "data": { "messageId": "opaque-id", "senderId": "opaque-id" }
}
```

- Initial event families: `conversation.message.created.v1`, `conversation.read.updated.v1`, `notification.created.v1`, `live-class.participant.changed.v1`, `job-application.status.changed.v1`, and `operation.status.changed.v1`. Payloads contain minimal data; clients refetch authoritative REST records.
- Durable messages/notifications are persisted through REST/use cases before fanout. Socket acknowledgement confirms command processing, not every recipient's receipt. Clients deduplicate on `eventId` and recover missed state from REST.
- Reauthorize long-lived connections and room access after membership revocation; disconnect stale/revoked sessions. Apply payload size/rate limits and audit moderation-sensitive commands.
- WebRTC signaling/media uses the chosen SFU's supported signaling contract; do not invent a parallel signaling protocol without a concrete media-provider requirement.
- Attendance is created from authenticated server/SFU events or reconciled provider records. A client may request review/correction but cannot set authoritative attendance by POSTing a claimed join/leave time. Provider event IDs and corrections are idempotent and audited.

## Documentation, compatibility, and API operations

- Publish OpenAPI for REST with schemas, auth scopes, errors, pagination, and examples. Validate generated docs against Zod or maintain contract tests to prevent drift.
- Provide request ID in response headers and error envelope; accept a client correlation ID only after sanitization and size limits.
- Log method, route template, status, duration, principal/tenant pseudonymous IDs, and request ID. Do not log bodies, tokens, message text, or sensitive query values by default.
- Add contract tests for authentication, tenant isolation, role/permission checks, idempotency, provider webhook verification, and schema compatibility. Add consumer compatibility tests before external API commitments.
- Define API rate/availability limits and deprecation windows before third-party access is offered.

## Unresolved API decisions

Still choose user identity/account merge semantics, exact email/recovery provider, public ID format, API compatibility/deprecation window, organization context selection, enterprise API client auth/scopes/quotas (before Release 3), provider webhook retry contract, and numeric rate limits. Initial assumptions are India-first/global reach, English-first UI, INR-only, responsive web, session-cookie auth, and Razorpay sandbox-only; these do not authorize live payment processing or global data residency claims.
