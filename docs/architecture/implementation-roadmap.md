# LearnSphere implementation roadmap

**Status:** staged sequence. Identity/session, organization access, and the Phase 4 course workflow are implemented. Remaining capabilities are proposals gated by product decisions, security review, working integrations, and measurable acceptance criteria.

**Phase 4 implementation note (2026-11-02):** The repository now supports organization-owned course drafting, text lessons, publishing, tenant-scoped discovery, enrollment, lesson access, completion, and progress summaries through the React client and API. Real replica-set integration coverage is included. Platform-wide courses, video hosting, assessments, certificates, and payments remain deferred. The Release 1 section below records the original identity-only milestone scope; it predates and is superseded in feature coverage by the implemented Phase 4 course workflow.

## Release 1 — identity and tenant-security vertical slice

**Goal:** prove that identity, organization membership, permission checks, tenant-scoped data access, and audit work end to end before any learning or marketplace feature is started. This is a bounded engineering milestone, not a broad LMS release.

**Repository implementation note (2026-11-02):** Phase 2 identity/session security and the organization/access API foundation are present. The foundation includes canonical organization creation, scoped memberships and fixed role bundles, hashed single-use invitations, membership administration, tenant membership checks, transactional audit writes, recent MFA for privileged operations, and last-owner protection for removal/demotion. The security verification run passed 38 unit tests and 17 real replica-set integration tests, including Phase 2 regressions and concurrent invitation acceptance/owner removal. Email delivery, explicit ownership transfer, audit retrieval, custom roles, and product resources are deferred.

### Assumptions and gates

- Initial product assumptions: India-first and globally reachable (not a global data-residency promise); English-first; INR-only; responsive web; MongoDB Atlas; secure session cookies; Socket.IO/WebRTC, Redis/BullMQ, S3/CloudFront remain target stack choices for later workflows.
- Select an initial hosting/data region, legal/compliance scope, approved email/recovery provider, session cookie domain/origin, secret management, and test environment before production credentials or personal data are introduced. Razorpay may be evaluated only in a sandbox; checkout and paid entitlements are out of this release.
- AI remains deferred. Preserve the provider adapter boundary in architecture only; no model integration or user-data transfer is part of this release.
- Do not implement courses, cohorts, jobs, messaging, live classes, payments, file uploads, or AI in Release 1.

### Milestones

1. **Configuration and application foundation.** Validate all required environment configuration at startup; separate local/test/staging settings; keep secrets out of source/logs; add request IDs, safe errors, security middleware, structured audit/logging, MongoDB Atlas-compatible connection/readiness handling, and a documented local/test setup. Establish automated checks and a CI test environment without provisioning production infrastructure prematurely.
2. **Registration, login, and recovery/session lifecycle.** Implement the chosen local or approved identity flow, secure HttpOnly/Secure/SameSite cookie sessions, CSRF and Origin protection, session rotation/revocation, login throttles, admin MFA, and non-enumerating single-use account recovery through a selected real email provider. If a provider is not selected, keep recovery delivery as a gate rather than faking delivery.
3. **Organizations and membership.** Implement canonical organization creation for permitted initial organization types, invitation/acceptance, membership lifecycle, multiple role bundles per organization, separately scoped platform grants, and organization/company admin MFA policy. No duplicate company records.
4. **Permission and tenant boundary.** Implement a small, explicit permission registry and policy layer; resolve tenant context from active membership; derive child tenant IDs from authorized parents; reject cross-tenant references. Add an audited support/admin access path only if required for the test journey.
5. **Audit events.** Record actor, scope, action, target, timestamp, request ID, and minimal safe metadata for registration/session, organization, membership, role, and denied sensitive actions. Restrict audit reads and define retention configuration without logging credentials or request bodies.
6. **Two-organization authorization proof.** Build only a small protected test resource/fixture needed to exercise tenant scoping; prove allowed and denied read/write/list/export access for two organizations, multiple memberships/roles, revoked membership, and platform-grant separation. The fixture is not a course or production feature.

### Release 1 acceptance evidence

- Configuration validation fails safely at startup when required settings are missing or malformed; secrets are not exposed.
- Registration/login yields a server-controlled session cookie with CSRF protection; rotation, logout, recovery, revocation, rate limits, and administrator MFA policies are tested.
- A user can create/join an organization and hold multiple scoped role bundles. Company organizations use the same canonical organization model.
- Authorization checks permission + tenant + resource relationship/state; client-supplied tenant IDs cannot widen access.
- Automated tests using two organizations demonstrate allowed and denied cross-tenant access, including nested-resource, list, and export paths.
- Audit events are recorded for security-relevant actions and contain no credentials or unnecessary personal content.
- No course implementation or other product module is included. No live payment, production media, AI, or production-scale deployment is claimed.

### Release 1 operational scope

Use isolated local/test/staging resources. Set environment-specific quotas and queue limits before enabling any queue (queues are not required for this milestone). Establish backup/restore and incident requirements for the chosen test environment, but defer production infrastructure spend approval until release scope and budget are known.

## Release 2 — live learning and career/community workflows

**Goal:** extend learning into scheduled collaboration and validated career workflows.

### Milestones

1. Integrate a selected SFU/live classroom provider; server-authorized room tokens; scheduling, participant admission, attendance; test mobile/browser/network fallback and capacity.
2. Add notification inbox and Socket.IO delivery with Redis adapter, durable REST recovery, room authorization, revocation, and rate limits.
3. Add company verification, recruiter memberships, job listing review/publish, candidate consented applications, and status pipeline.
4. Add moderated cohort spaces, posts/comments/reports/block controls and abuse operations; defer broad public feed until staffing and moderation capacity exist.
5. Add scoped project workspaces, memberships, tasks, and portfolio opt-in.
6. Add mentor profiles/request/session flow with real calendar/media integration or clearly bounded in-product scheduling; implement safety/reporting process.
7. Add payment checkout/refunds only after provider, tax/seller-of-record, reconciliation, support, and finance processes are approved. Razorpay sandbox can support isolated integration tests; live credentials and transactions require separate approval and are not implied by sandbox success.
8. Add aggregate organization and course analytics with privacy thresholds and documented metric definitions.

### Release 2 acceptance evidence

- Live class room admission is authorized, media behavior is capacity tested, recording is opt-in with retention controls, and provider failures are visible.
- Message and notification delivery survives reconnects via REST recovery; unauthorized room access is blocked in API and socket tests.
- Recruiter access is restricted to assigned company/job workflows and candidates control what they submit.
- Moderation reports have staffing, response targets, and audited outcomes.
- Payments reconcile provider events with orders and entitlements; refund and chargeback handling is documented.

## Release 3 — enterprise scale and advanced platform capabilities

**Goal:** build differentiated advanced capabilities only after adoption, governance, and operating capacity are demonstrated.

### Candidate milestones (prioritize based on evidence)

1. Institutional SSO and provisioning (e.g. standards-based identity/roster integrations) with tenant-specific mapping, sandbox testing, and least-privilege scopes.
2. Enterprise API clients, signed webhooks, delivery retry console, quotas, API versioning/deprecation, and customer audit export.
3. Startup/innovation programs and public showcase with separate private application state.
4. Referral/reward ledger and campaigns with fraud review, payout/provider compliance, and transparent eligibility.
5. AI learning/career assistant (deferred until separately approved) with an approved provider behind the provider-independent adapter, grounding, source display, content permissions, prompt/data retention controls, safety evaluation, quotas, and no consequential automated decisions. Adapter boundaries do not make provider behavior or data terms interchangeable.
6. Advanced assessments/credential verification, if needed; proctoring requires separate legal/privacy/accessibility approval.
7. Dedicated analytics warehouse/search, data retention jobs, archival, tenant-level controls, and data residency only when volume/customer demand warrants.
8. Scale/readiness work: regional media capacity, chaos/failover tests, disaster recovery, SLO-based on-call, capacity planning, and service extraction review based on measured bottlenecks.

## Dependencies and sequencing

```text
Product/privacy decisions
        ↓
Environment, identity, tenancy, permissions, audit, observability
        ↓
Course/catalog/enrollment ──→ assignments/submissions ──→ learning analytics
        │                 └──→ private assets/FFmpeg/S3/CloudFront
        ├──→ payments/entitlements (only if paid launch)
        └──→ live class/SFU ──→ notifications/realtime

Identity + privacy + moderation operations
        ├──→ recruiter/company/jobs/applications
        ├──→ community and project collaboration
        └──→ mentorship and startup programs

Data governance + provider contracts + operational capacity
        └──→ SSO/API integrations, AI, advanced analytics, rewards
```

Shared prerequisite work includes permissions, tenant filtering, audit, error handling, API contracts, notifications, asset lifecycle, and provider adapter patterns. Release 1 completes only the identity/permission/tenant/audit core. Build other foundations at the time of the first workflow that needs them rather than speculative frameworks.

## Testing strategy

- **Unit:** domain state transitions, permission policies, validation, money arithmetic, scheduling, retention, and pure UI behavior.
- **Integration:** Mongoose repositories/index constraints with a disposable replica set where transactions matter; Redis/BullMQ retry/idempotency; object-storage adapter against an isolated test bucket/emulator only when it accurately models signing behavior; provider webhooks with verified fixtures.
- **API contract:** request/response/OpenAPI alignment, error envelopes, pagination, idempotency, version compatibility.
- **Security:** tenant isolation matrix across every resource, IDOR, role escalation, session revocation, CSRF/CORS, upload abuse, SSRF for webhooks, rate limiting, secret/log leakage, and dependency scanning.
- **Realtime:** authorized room subscription, revocation, reconnect/replay, duplicate event, Redis adapter, and message persistence-before-ack.
- **Media:** codec/size edge cases, untrusted input sandbox, worker timeout/retry, private object authorization, deletion and retention.
- **UI/accessibility:** component and route tests, keyboard/screen reader review, contrast, reduced motion, responsive layouts, upload/payment error states.
- **End-to-end:** Playwright first proves Release 1 registration/session, organization membership, permission checks, audit, and allowed/denied two-organization access in isolated infrastructure. Later releases add learner/instructor journeys. Never hit live payment or send real email from routine CI.
- **Performance/reliability:** load tests for catalog, progress writes, message fanout, queue lag, and concurrent live-class joins; backup restore and provider outage/failover exercises.

Tests must assert both allowed and denied paths. Do not use a successful frontend response as evidence of backend authorization.

## Deployment strategy

- Build an immutable versioned web bundle, API image, and worker image from one commit; attach SBOM and scan dependencies/images.
- Promote local/dev → CI/test → staging → production with isolated resources and secrets. Use reviewable infrastructure changes and least-privilege deployment identities.
- Use backward-compatible expand/migrate/contract database changes; build indexes safely, observe migration progress, and preserve rollback compatibility.
- Gate production on security/privacy review, integration health, dashboards/alerts, backup restore evidence, runbooks, and owner/on-call assignment.
- Release with health checks, canary or gradual traffic where platform supports it, feature flags for operationally reversible changes, and explicit rollback criteria.
- Keep feature flags permission-aware and time-bound; do not use flags as authorization or let hidden features leak API access.

## Infrastructure cost controls

Do not assign or imply a production budget in this roadmap. Before each environment is provisioned, set a budget owner and alert thresholds in the chosen billing account. Bound storage/upload/recording retention, per-tenant API and provider usage, queue concurrency/retries, email volume, media participant-minutes, and AI usage before enabling those capabilities. Alert on spend, egress, storage growth, queue age/dead letters, and provider anomalies. Keep all Razorpay tests isolated to sandbox; do not store live keys in dev/staging. Live media and AI have no Release 1 capacity commitment.

## Internship deliverables

- Architecture decisions and threat model for identity, tenant boundaries, media, payments, and AI.
- Reviewed diagrams, domain ownership map, API contracts, data dictionary/index rationale, and operational cost/dependency register.
- Incremental PRs with tests, migrations, accessible UI, setup docs, environment validation, and no committed secrets.
- Historical Release 1 acceptance was an identity and tenant-security workflow; the later Phase 4 course workflow is implemented as described in the implementation note above.
- Tenant isolation/security test evidence, accessibility findings, performance baselines, deployment/rollback notes, and concise retrospective.
- A list of deferred modules with explicit reason and owner; broad product scope is not evidence that every module should ship during the internship.

## Release planning decisions still needed

The initial customer and buyer, team size/capacity, schedule, budget, geography, deployment account, provider procurement, compliance scope, and internship evaluation rubric determine release scope. The roadmap intentionally does not assign dates until these are known.
