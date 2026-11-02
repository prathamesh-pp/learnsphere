# LearnSphere system architecture

**Status:** modular monolith target architecture; identity, organization access, and the Phase 4 course workflow are implemented in a Vite frontend, Express API, and shared TypeScript package. Redis/workers, media, payments, and other integrations remain planned.

## Architecture principles

1. Start as a **modular monolith** with one deployable API and explicit domain boundaries. Do not split services before measured load, team ownership, or isolation needs justify the operational cost.
2. Keep business rules in domain/application services, not route handlers, UI components, or Mongoose hooks alone.
3. Treat tenant scope and authorization as mandatory inputs at resource access boundaries.
4. Persist authoritative state in MongoDB; use Redis/BullMQ for transient coordination and asynchronous work, not as the only record of business outcomes.
5. Use provider adapters around external services and expose truthful pending/succeeded/failed states.
6. Make asynchronous events, retries, idempotency, audit, and observability explicit.

## Logical architecture

```text
Browser (React/Vite)
  ├─ React Router, RTK Query, feature UI, permission-aware navigation
  ├─ HTTPS REST API ───────────────────────────────────┐
  ├─ Socket.IO (authenticated, authorized channels) ───┤
  └─ WebRTC client ──────────────── Media SFU/provider  │
                                                       ▼
             Express modular monolith (TypeScript)
  ├─ HTTP transport: routing, validation, auth, rate limits
  ├─ application use cases and policy/authorization layer
  ├─ domain modules and module-owned Mongoose models
  ├─ integration adapters: identity, payment, email, media, AI
  ├─ Socket.IO gateway and room authorization
  └─ job producers/outbox and webhook handlers
          │                         │
          ▼                         ▼
   MongoDB replica set        Redis + BullMQ workers
          │                         ├─ FFmpeg media jobs
          │                         ├─ email/notification jobs
          │                         ├─ reports/exports/scanning
          │                         └─ retries and dead-letter queues
          │
   S3 private object storage ─ CloudFront signed delivery
```

The API and worker can initially share a TypeScript codebase and domain modules while running as separate process types from the same release artifact. This isolates CPU-heavy jobs without creating independently owned microservices. The API remains stateless except for short-lived connections and uses shared external state for horizontal scaling. The initial database target is MongoDB Atlas, in a region selected before production; Atlas is a deployment choice, not a second data model.

## Monorepo target layout

```text
apps/
  web/src/
    app/                 # router, providers, store, route guards
    components/          # shared accessible primitives
    features/<module>/   # pages, UI, RTK Query endpoints, local state
    layouts/             # public, learner, instructor, organization
    services/            # transport setup, telemetry
  api/src/
    app/                 # process composition, config
    modules/<module>/    # routes, schemas, controller, use case, model, policy
    shared/              # auth, errors, db, logger, tenant context
    realtime/            # Socket.IO gateway and event handlers
    jobs/                # queues, workers, processors
    integrations/        # provider adapters
packages/
  shared/                # stable transport-safe types/constants only
```

Do not turn `packages/shared` into a dumping ground for server domain models or private fields. Keep API request/response contracts versioned and transport-safe. Validate runtime input independently on the server.

## Module boundaries

| Module | Owns | Main dependencies/events |
|---|---|---|
| Identity and access | global users, credentials/sessions/identities, platform grants, organization memberships and permission bundles | used by every protected module; emits membership/security changes |
| Organizations | canonical organizations of kind institution, company, or program; invitations, company details/verification, branding, tenant policies | identity; tenant lifecycle and audit; no duplicate company or membership identity |
| Learning | global or tenant-owned course definitions, catalog entries, cohorts/cohort memberships, enrollments, progress, reviews, certificates | assets, payment entitlement, assessment; emits enrollment/completion |
| Assessment | assignments, submissions, quizzes, attempts, grades | learning enrollment and assets; emits grade/feedback events |
| Live learning | class schedule, participant admission, attendance, recording references | learning, identity, media adapter, jobs; never owns media bytes |
| Career | profiles, jobs, applications | identity and consent; company is an organization and company membership is an organization membership |
| Community | spaces, posts, post comments, reactions, user follows, moderation reports | identity, notifications, asset references |
| Collaboration | projects, memberships, milestones, project comments, tasks | identity, assets, notifications |
| Mentorship and innovation | mentor listings/availability, booking requests and sessions, program submissions | identity, scheduling/media adapters, notifications |
| Commerce | offers (authoritative prices), orders, payment attempts/events, refunds, entitlements | payment adapter and learning; webhook reconciliation |
| Messaging and notifications | conversations/messages, inbox notifications, preferences | identity and module events; realtime delivery |
| Analytics and operations | audit trail, aggregate/report jobs, service integrations, admin cases | read-only module events plus tightly controlled admin actions |
| AI assistance | user requests, consent/configuration, minimal interaction metadata | approved model adapter and authorized source retrieval |

Modules call their own application services and exchange narrow internal contracts or domain events. Avoid cross-module direct writes to another module's collections. MongoDB transactions are reserved for state changes that truly require atomicity within an Atlas replica set; cross-module workflows use idempotent events/sagas and reconciliation. A MongoDB outbox row and state transition are written in the same transaction where required; the dispatcher may publish more than once, so consumers deduplicate by event ID.

## Identity, role bundles, and tenant invariants

The role bundles are **STUDENT**, **INSTRUCTOR**, **RECRUITER**, **COMPANY_ADMIN**, **MENTOR**, **ORGANIZATION_ADMIN**, and **PLATFORM_ADMIN**. A global user can have multiple bundles in different organizations and, if needed, multiple bundles in one organization. Organization memberships carry organization-scoped role bindings. Platform grants are separate, explicit, time-bound, and audited; they are never inherited from an organization role. The product-requirements role matrix defines typical capabilities. These bundles expand to permission keys; every action also evaluates actor, tenant, resource relationship/ownership, consent, and resource state.

Tenant-owned records carry a tenant ID, but clients cannot set it authoritatively. Resolve the active organization from the authenticated principal and membership; for child resources, load the authorized parent and derive the tenant ID from that parent. Verify any child reference belongs to the same tenant and parent before read, write, job enqueue, socket subscription, export, or asset grant. Reject missing or mismatched scope. Platform support access uses a distinct audited policy.

Global course definitions are owned by the platform or an instructor under the approved publication policy. Organization catalog entries control tenant discovery and may reference a global course or an organization-owned course; catalog visibility does not confer access to another tenant's enrollment or learner records. Global enrollments and organization-originated enrollments have explicit separate scope and uniqueness rules in the database design. Cross-organization progress, grades, or reports are not linked or disclosed by default; learner consent and an explicit product policy are required. Learner exports include their own permitted records; organization exports include only records owned by that organization.

## Frontend architecture

- React + TypeScript + Vite; React Router owns URL navigation and route-level lazy loading.
- Redux Toolkit configures the store. RTK Query is the default server-state cache and mutation layer; avoid copying fetched records into unrelated slices. Use local component state for ephemeral UI state.
- Feature folders own page composition, API endpoints, feature-specific validation/types, and state. Shared components remain domain-neutral.
- API authorization is authoritative. Route guards and hidden controls improve UX but are not access control.
- Normalize server error envelopes, request IDs, loading/empty/error states, retries for safe operations, and offline/connection states.
- Use signed, short-lived direct object upload/download URLs; large files do not proxy through React or the application API.
- Client UI is English-first and responsive. Locale/timezone formatting is data-driven; INR is the initial display/checkout currency. Responsive layouts do not imply that every browser/device supports live media.

## Backend architecture

- Express 5 application initializes configuration, database, security middleware, API routes, realtime gateway, error handling, and shutdown hooks in a composition root.
- Route handlers authenticate/parse transport inputs and call application use cases. Zod schemas validate query, path, body, environment, and provider webhook payloads.
- Authentication resolves a principal; authorization policy checks action + resource + membership/tenant context. Database access helpers require tenant context for tenant-owned records.
- Web authentication uses server-side sessions in secure `HttpOnly`, `Secure`, `SameSite` cookies. Unsafe requests use CSRF tokens and Origin checks; session IDs rotate after login, privilege changes, and recovery, and are revocable server-side. Organization/company/platform administrators require MFA. Account recovery uses single-use, expiring, hashed recovery tokens delivered through an approved real email provider, avoids account enumeration, is rate-limited, and revokes existing sessions after successful recovery.
- Mongoose models define schema-level constraints and indexes. Domain services enforce workflows and cross-document rules. Avoid hidden side effects in middleware/hooks.
- Use explicit error classes mapped to stable HTTP codes and a sanitized response. Helmet, strict CORS, rate limits, request size limits, secure cookies/tokens, CSRF protections where cookie auth applies, and safe logging are baseline controls.
- Add OpenAPI documentation generated from or checked against validation contracts; never treat the specification as authorization.

## Real-time architecture

- REST handles durable commands and reads. Socket.IO provides low-latency delivery of authorized events and presence hints; persist messages/notifications before acknowledging durable writes.
- Authenticate socket handshake using the same identity system; authorize each room subscription and event by resource membership and tenant. Do not allow clients to select arbitrary room names.
- Use Socket.IO Redis adapter when multiple API instances need shared room fanout. Redis outage should fail or degrade realtime delivery clearly while REST and durable writes continue where safe.
- Event names use one convention everywhere: lowercase dot-delimited `<resource>.<action>.v1`, with multiword resource names kebab-cased: `conversation.message.created.v1`, `notification.created.v1`, `live-class.participant.changed.v1`, `job-application.status.changed.v1`, and `operation.status.changed.v1`. Payloads include event ID, timestamp, resource ID, and minimal data, never secrets. Client handles duplicate/out-of-order notifications.
- WebRTC transports media; signaling can use the selected SFU SDK/provider. For group teaching, use an SFU (LiveKit or equivalent) rather than mesh peer-to-peer. Validate room tokens and publish/subscribe permissions server-side. TURN/SFU bandwidth, regional placement, recording, and egress are major cost and reliability choices.
- Attendance is derived from authenticated server/SFU participant join/leave events or reconciled provider records. Client claims may request correction but cannot establish authoritative attendance. Persist provider event IDs and deduplicate/reconcile delayed or reordered records.

## Background processing

- Redis + BullMQ queues separate transactional API latency from retries and CPU work. Initial queues: notifications, media processing, file safety, exports/reports, and reconciliation.
- Use a MongoDB outbox record in the same transaction as important state transitions when reliable event publication matters. An outbox dispatcher enqueues BullMQ jobs; consumers are idempotent using event/job keys.
- Define attempts, exponential backoff with jitter, timeout, concurrency, per-tenant fairness limits, dead-letter handling, retention, and alert thresholds per queue.
- Never acknowledge a provider webhook before its event is durably recorded/processed enough to be replayed safely. Keep webhook event IDs and processing state.
- FFmpeg runs in bounded worker containers with CPU/memory/time limits, safe argument construction, untrusted input isolation, and no public network access unless required. Store original and derived media separately with checksums and processing status.
- Queue concurrency and per-tenant job quotas are bounded; alert on queue age, retry rate, dead letters, and runaway work. Redis/BullMQ is coordination, not the sole durable record; MongoDB operation/outbox state allows recovery and reconciliation.

## Media storage and delivery

- S3 buckets are private and encrypted; separate original uploads, processed media, and temporary/quarantine objects by lifecycle and access policy.
- Browser requests short-lived presigned multipart upload grants after API authorization, per-file/per-tenant quotas, allowed extension and detected content-type checks, size/duration limits, checksum binding, and server-generated object keys. Expire grants; abort incomplete multipart uploads and clean abandoned quarantine objects.
- All uploads remain private and quarantined until mandatory malware/content scanning and required media validation complete. If scanning is unavailable or fails, fail closed: the asset remains unavailable. Never trust the client MIME type. Handle archive expansion limits and parser resource exhaustion.
- CloudFront serves private playback/download only with short-lived signed URL/cookie authorization issued after current membership, consent, entitlement, and resource-state checks. Bound cache and grant lifetime; revoke future grants immediately and ensure already issued grants expire within the documented maximum window. Deletion also removes S3 originals/renditions and invalidates or expires cached copies; cache invalidation is not the sole authorization control.
- Store object key, owner/tenant, checksum, media metadata, processing state, retention, and access class in MongoDB; do not persist a public URL as the access authority.
- FFmpeg creates approved transcodes/thumbnails/captions where configured. Recording requires informed consent, visibility rules, retention/deletion, and provider egress/transcoding cost controls.
- FFmpeg workers use least-privilege identities, isolated temporary storage, patched pinned images, strict CPU/memory/time/output limits, argument arrays (never shell-concatenated user input), and no network access by default. Scanning/transcoding errors never publish a partial asset.

## External callback and webhook safety

Any platform webhook delivery to customer-configured URLs is an outbound request and an SSRF boundary. Require HTTPS; reject IP literals and non-public/reserved IPv4/IPv6 results; resolve DNS and validate every returned address at connection time; disable redirects or repeat the full validation on every redirect; block link-local, loopback, private, multicast, and cloud metadata destinations; cap redirects, response size, and time; and use an egress proxy/firewall where practical. Revalidate DNS to mitigate rebinding. Prefer customer domain verification/allowlisting. Secrets are per endpoint, rotatable, stored in a secret manager, and signatures are timestamped. These controls apply to both API testing and delivery workers.

## Retention and deletion operations

Retention durations are policy/configuration values to be approved for India-first launch jurisdictions, customer contracts, and applicable legal holds; do not hardcode an invented universal duration. Every data class has an owner, purpose, approved expiry, deletion workflow, and alert on failure. Recording is off by default, expires with its renditions/transcripts, and loses access before physical deletion. Message and application content follow disclosed purpose-specific expiry and deletion/withdrawal behavior. Audit events retain only necessary security metadata for the approved period, then are controlled-expired or anonymized. Encrypted backups have a documented bounded expiry; deletions are replayed against restores and are complete after backup expiry. Deletion jobs cover MongoDB, S3/CloudFront, search, caches, AI/provider processors, and exports where applicable.

## Deployment architecture

Initial production shape: CDN-hosted static web assets; HTTPS load balancer/API containers; separate worker containers from the same image; MongoDB Atlas replica set; managed Redis; private S3 and CloudFront; secret manager; centralized logs/metrics/traces; Sentry or equivalent error reporting. Socket.IO requires sticky sessions or a compatible multi-node setup plus Redis adapter. Live media uses a managed SFU or separately operated SFU cluster, chosen through a cost/security/operations review. Choose an India-first hosting/data region and document cross-border processing before production; global reach is not a claim of global data residency.

Environments: local, test/CI, staging, production, with separate accounts/projects, keys, buckets, databases, and providers. CI builds immutable artifacts, runs checks, scans dependencies, and deploys staging; production release is gated with migrations/rollback and health checks. Infrastructure as code, backup policy, restore drills, TLS/DNS, incident alerting, and access reviews are release requirements.

## Scaling strategy and decision gates

1. Begin with one API deployment and separately scaled workers; use bounded MongoDB query patterns and indexes, connection pooling, CDN, and queue backpressure.
2. Scale stateless API replicas and worker concurrency based on latency, CPU, queue age, and tenant fairness. Add Redis adapter for socket fanout when needed.
3. Introduce read replicas, data archival, dedicated analytics storage, or partitioning only after measured query/volume constraints and consistency needs are understood.
4. Extract a module into a service only when ownership, independent scaling/failure isolation, or compliance boundary outweighs network, deployment, and data consistency costs. Define contracts and ownership first.
5. Treat global multi-region writes, a custom SFU fleet, and a general-purpose event platform as later-stage investments with explicit demand and operating budget.

## Cost drivers and external dependencies

- **MongoDB and Redis:** managed compute, storage, backup, cross-zone traffic, connection limits, and high availability.
- **AWS S3/CloudFront:** retained originals/recordings, requests, egress, transcoded rendition count, invalidations, and regional transfer.
- **Live media/SFU:** participant-minutes, media egress, recording/egress, TURN relay, regional capacity, and support tier; usually one of the least predictable costs.
- **FFmpeg workers:** CPU/GPU time, temporary storage, and retry amplification.
- **Email/SMS/push:** per-message cost, delivery reputation, templates, and phone verification.
- **Payments:** transaction and payout fees, chargebacks, tax tooling, refunds, and compliance obligations.
- **Identity/SSO:** per-user or enterprise connector fees and support overhead.
- **AI:** token/audio/image use, retrieval/index cost, abuse controls, model availability, and data processing terms.
- **Observability and support:** event volume, retention, tracing, incident/on-call coverage, and ticketing.

Provider names, contracts, data regions, and budgets remain unresolved. Select providers through security, data-processing, availability, pricing, and exit-strategy review before adding credentials or customer data.

## Cost controls

Before provisioning production, approve per-environment budgets and alert thresholds; this document intentionally sets no currency amount. Apply user/tenant quotas for storage, upload size/duration, message/search/AI usage, active sessions, and exports; retention ceilings for recordings and renditions; bounded queue concurrency and retry limits; per-provider request/participant-minute limits; and alerts for spend, egress, storage growth, queue age, and provider anomalies. Keep Razorpay credentials in sandbox only until a separate live-payment approval. Do not enable AI or production SFU/recording capacity before a cost owner and usage limits exist.

AI remains deferred. When approved, a narrow provider adapter will isolate request/response contracts and capability configuration, but does not guarantee provider interchangeability. Keep provider credentials in the secret manager, send only permitted user-authorized context, record minimal usage metadata, and apply per-user/tenant quotas and retention controls.
