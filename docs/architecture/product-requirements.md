# LearnSphere product requirements

**Status:** product specification. Phase 2 identity/session security, organization/access, and the Phase 4 organization-scoped course workflow are implemented. Other product modules described here remain planned.

## Product vision

LearnSphere is a multi-tenant education and career platform. It connects learners and educators with employers, mentors, institutions, and professional communities through learning, live instruction, work opportunities, and collaboration. A person can build a durable learning and career profile, participate in more than one organization, and carry appropriate learning records between contexts while each institution retains control of its own tenant data.

The product should earn trust through clear ownership, privacy controls, accessible experiences, reliable learning records, and transparent use of integrations. It should not imply a credential, job, payment, live session, or AI result exists until the underlying service confirms it.

## Initial product assumptions

- Initial launch is India-first and globally reachable. This does not promise global data residency, equal latency, or availability in every jurisdiction. Select the initial hosting/data region and supported jurisdictions before production.
- English is the initial interface language. Store locale and timezone per user and format dates, numbers, and currency through locale-aware presentation so later localization does not require data rewrites.
- INR is the initial product currency. Persist ISO currency and integer minor units. Supporting another currency, country, or tax treatment requires an explicit product and finance decision.
- The first client is a responsive web application.
- Razorpay is considered only in sandbox environments for integration evaluation. No live payments, production credentials, paid entitlements, or real payout workflow are part of Release 1. Provider, seller-of-record, tax, refunds, and compliance review remain launch gates.
- AI is deferred. A provider-independent adapter boundary is planned, but no model provider or production data-sharing permission is assumed.

## Target users

- **Students and learners:** discover courses, learn independently or in cohorts, attend classes, submit work, build portfolios, and find jobs, mentors, peers, and projects.
- **Instructors:** publish and teach courses, manage cohorts, host classes, assess work, give feedback, and understand learner progress.
- **Recruiters:** represent an employer, publish opportunities, search consented candidate profiles, and manage application pipelines.
- **Company administrators:** manage company identity, recruiter access, job approvals, and employer analytics.
- **Mentors:** publish expertise and availability, accept requests, hold sessions, and record agreed follow-up actions.
- **Organization administrators:** configure an institution tenant, members, courses, policies, branding, integrations, reporting, and access controls.
- **Platform administrators:** operate the service, review abuse and support escalations, manage platform-wide policies, and investigate service health under audited access.
- **Companies and institutions as customers:** subscribe to the tools and controls they need, with explicit boundaries between their data and individual users' portable profile data.

The seven application role bundles are **STUDENT**, **INSTRUCTOR**, **RECRUITER**, **COMPANY_ADMIN**, **MENTOR**, **ORGANIZATION_ADMIN**, and **PLATFORM_ADMIN**. These are permission bundles, not mutually exclusive account types. One global user may hold different roles in multiple organizations and, where appropriate, multiple roles in one organization. `PLATFORM_ADMIN` is a separately granted platform scope, never inherited from an organization membership. Authorization always combines permission, active tenant membership, resource ownership/relationship, consent, and resource state.

| Role bundle | Scope and typical permissions (all subject to resource and state policy) |
|---|---|
| STUDENT | Personal learning and profile actions; enroll, submit own work, join authorized classes, manage consent, and apply to jobs. |
| INSTRUCTOR | Assigned courses/cohorts; author and publish when granted, manage enrolled learners, schedule classes, grade submissions, and view permitted course reports. |
| RECRUITER | A company organization; manage assigned job listings and review applications submitted to those jobs, with consent-limited candidate data. |
| COMPANY_ADMIN | A company organization; manage company verification workflow, recruiter memberships, company settings, and job approval policy. Does not gain platform administration. |
| MENTOR | Personal mentor listing and accepted mentorship relationships; manage availability and sessions and see only agreed information. |
| ORGANIZATION_ADMIN | One institution/program organization; manage its members, roles, catalog, cohorts, settings, exports, and permitted reports. Does not gain access to other organizations or platform administration. |
| PLATFORM_ADMIN | Platform scope only through explicit, audited, time-bound grant; perform narrowly defined platform operations and support actions. Sensitive content access requires a separate need and audit. |

Permission examples include `course.read`, `course.publish`, `cohort.manage`, `member.invite`, `job.application.read`, `recording.download`, and `platform.case.manage`. Organization administrators may delegate allowed permissions within their organization, but cannot grant platform permissions or exceed their own grant. The server evaluates these permissions with resource relationships, tenant boundary, consent, and current state.

## Product modules and capabilities

**Essential** identifies a core capability in the eventual product; it does not mean every essential module belongs in the first release. The roadmap stages these capabilities according to dependencies and operating readiness. **Advanced** means defer until the foundational workflow and operational need are proven.

1. **LMS and course marketplace — Essential.** Public or tenant-scoped discovery; course pages, outcomes, prerequisites, instructor information, sections and lessons; free or paid enrollment; learning progress; ratings after verified participation; instructor authoring and publishing; organization catalog and cohort assignment. Paid content requires an actual payment provider and entitlement check.
2. **Live virtual classrooms — Essential, staged.** Scheduled session pages, instructor controls, participant admission, audio/video/screen sharing, attendance, moderation, and post-class links. Use a managed or operated SFU for group sessions; browser WebRTC alone is not a scalable classroom service. Recording is explicit opt-in with notice, access control, retention, and processing status. No classroom is advertised as live until the media service confirms it.
3. **Student and instructor profiles — Essential.** User-controlled identity, biography, skills, education, learning history, authored courses, portfolio links, and visibility controls. Credentials show issuer and verification state; profile fields are not automatically public.
4. **Job and internship marketplace — Essential.** Employer listings with location, type, compensation disclosure where applicable, eligibility, closing date, and status; saved jobs; application submission and status; consented profile sharing; candidate filters limited to legitimate job criteria and data users have chosen to expose.
5. **Company and recruiter portal — Essential.** A company is an `organizations` record with `kind=company`; it is not a second company identity or membership record. Company details and verification extend that canonical organization. Scoped recruiter permissions govern job draft/review/publish, applicant pipeline, restricted notes, and aggregate reporting. Employer verification and hiring compliance process need an operating owner.
6. **Community and social networking — Essential, scoped.** Topic or cohort spaces, posts, comments, reactions, follows, reporting, moderation queues, block/mute controls, and notification preferences. Ship a focused cohort discussion workflow before public social graph or algorithmic feeds.
7. **Project and team collaboration — Essential, scoped.** Project spaces, invitations, roles, milestones, tasks, project-scoped comments, attachments, and portfolio opt-in. The API rechecks workspace membership before issuing a short-lived download grant; already-issued grants remain usable only until their documented expiry.
8. **Startup and innovation hub — Advanced.** Founder/team profiles, challenge programs, idea or venture submissions, mentor matching, milestones, and opt-in showcase pages. Private applications and public showcases must be separate visibility states.
9. **Mentorship and career guidance — Essential.** Mentor expertise and availability; requests with goals; acceptance/decline; session scheduling; notes visible only to permitted parties; feedback and boundaries. Calendar/video integrations are real dependencies, not fabricated availability.
10. **Referral and rewards — Advanced.** Campaigns, attribution, eligibility, earned rewards, expiration, and fraud review. Never represent an unverified referral as earned or a reward as paid. Avoid incentives that compromise learning integrity.
11. **Payments and digital marketplace — Essential only for paid offerings.** An `offer` is the sole authoritative price and purchasable entitlement definition; courses do not maintain a competing price. The server calculates checkout from the active offer and policy, then snapshots item, INR amount, currency, and applicable reviewed charges into an order. Payment attempts, provider-confirmed events, refunds, receipts, and entitlement lifecycle are separately auditable. Card data stays with the provider. Razorpay sandbox may be used only in isolated test environments; live payments require a separate approval and tax, seller-of-record, refund, currency, and payout decisions.
12. **Assignments and examinations — Essential.** Instructor-authored assignments, deadlines, rubric, accepted file types/limits, submissions, late policy, feedback, grades, and audit trail; quizzes with attempts and configured question types. High-stakes proctoring is out of initial scope and requires a privacy/legal review.
13. **Real-time messaging and notifications — Essential, staged.** One-to-one or contextual conversations, membership checks, read state, abuse reporting, online delivery, and durable notification inbox. Email/push are separate opt-in channels; Socket.IO delivery is not the durable source of truth.
14. **AI learning and career assistant — Advanced.** User-initiated study explanations, learning plans, or career drafting grounded in permitted content; source/context display where applicable; user controls for retention and deletion. Never make hiring, grading, credential, or other consequential decisions autonomously. Requires a real model provider, privacy review, usage limits, and transparent AI disclosure.
15. **Analytics and reporting — Essential basics; Advanced predictive.** Learner progress and course activity for authorized instructors; organization-level aggregated adoption/completion; platform operational metrics. Define event semantics and minimum cohort sizes to reduce re-identification. Do not expose individual student activity to employers without specific consent.
16. **Admin and platform operations — Essential.** Organization settings and members; role/permission changes; content and abuse moderation; access reviews; support audit; feature switches; data export/deletion workflows; service and integration health. Platform administrator access is time-bound, least-privilege, and audited.
17. **Multi-tenant institutional LMS — Essential foundation.** Organization tenants, domain/invitation onboarding, membership, tenant branding, scoped course catalog, cohorts and cohort memberships, configurable policies, tenant reports, and strict tenant access checks. SSO and institutional provisioning are gated integrations.
18. **Enterprise integrations and API platform — Advanced.** Versioned API, scoped client credentials, webhooks with signatures/retries, integration registry, and documented data contracts. Add standards-based LMS/identity integrations only after customer requirements are confirmed; each integration needs a sandbox and operational owner.

## Core user journeys

### Learner to course completion

1. Learner signs up or accepts an institution invitation, verifies their contact method, and chooses profile visibility.
2. Learner searches public or authorized tenant catalog, checks course requirements and price, then enrolls or completes provider checkout.
3. The server grants an enrollment/entitlement only after the enrollment policy or verified payment result succeeds.
4. Learner consumes lessons, tracks progress, joins scheduled classes, and submits assignments.
5. Instructor reviews submissions and records feedback; learner sees course status and can export or display a verified completion record subject to policy.

### Instructor publishes and teaches

1. Instructor creates a draft course and organizes sections, lessons, assessments, and access policy.
2. An authorized publisher reviews and publishes it to a marketplace or tenant catalog.
3. Instructor manages a cohort and schedules a class; participants receive only permitted notifications.
4. Instructor conducts the class through an authenticated media room, records attendance, and publishes permitted materials or a recording.
5. Instructor reviews progress and learner work; reports are scoped to assigned courses and organization policy.

### Recruiter manages an opportunity

1. Company completes required verification; a company administrator invites a recruiter with limited permissions.
2. Recruiter drafts a listing and submits it through any company/platform approval step.
3. Candidates discover it and apply with fields and profile artifacts they explicitly choose to share.
4. Recruiter reviews the application in the company boundary, records restricted notes, and updates status.
5. Candidate receives status notifications and can withdraw or request applicable data actions.

### Organization administrator configures a tenant

1. An organization is provisioned and its administrator is verified.
2. Administrator invites users or connects an approved identity provider; membership and roles are scoped to that organization.
3. Administrator configures catalog, cohorts, brand, policies, and allowed integrations.
4. Staff see only data allowed by their organization permissions; audit records capture sensitive administrative actions.
5. Organization exports or deletes tenant data through approved lifecycle workflows, subject to legal retention obligations.

### Mentor and learner arrange guidance

1. Learner browses mentor profiles and submits a goal and preferred availability.
2. Mentor accepts or declines; accepted sessions use confirmed calendar/media integration state.
3. The parties meet and keep only explicitly shared follow-up notes.
4. Either party can report, block, or end the relationship; support actions are audited.

## Functional requirements

- All API requests identify an authenticated principal when needed; server-side authorization checks the action, resource, organization boundary, and relevant relationship.
- Users can belong to multiple organizations with independent membership status and permissions. Global identity does not grant tenant access.
- Public/private visibility is explicit for profiles, jobs, communities, projects, recordings, and portfolio artifacts.
- Content follows draft, review, published, archived/deleted states as appropriate; state transitions have validation and audit records.
- Course enrollment, payment confirmation, assessment result, attendance, and reward state are server-authoritative and idempotent.
- Users can see and manage notifications and preferences; real-time delivery supplements persisted state.
- Uploads use authorized short-lived upload/download grants, size/type limits, malware scanning where available, and processing state.
- Support user export, correction, deletion/anonymization, retention holds, and auditability subject to applicable legal requirements.
- Administrative and integration actions are logged with actor, tenant, target, action, timestamp, and correlation identifier; avoid putting secrets or unnecessary personal content in logs.
- Provider webhooks are authenticated, replay-safe, idempotent, and observable.
- Course completion credentials identify learner, issuing instructor/organization, course, completion evidence, issue/revocation state, and a privacy-preserving verification reference.
- Learners can follow discoverable users only where both parties' visibility settings allow it; unfollow/block/report controls are available and do not grant access to private records.

## Non-functional requirements and launch targets

Targets below are proposed service objectives for initial production planning, not measured properties of the current repository.

- **Security:** TLS in transit; managed encryption at rest; least privilege; secrets in a secret manager; secure session/token lifecycle; rate limits; input validation; dependency scanning; OWASP-aligned review; tested backups and restore.
- **Privacy:** purpose limitation, consent, data minimization, retention schedules, export/deletion workflows, visibility controls, and tenant isolation. Confirm applicable jurisdictions and contractual obligations before production.
- **Availability:** initial API and web availability objective of 99.5% monthly excluding announced maintenance, with documented incident response and recovery objectives. Live media availability is separately measured against the chosen provider.
- **Performance:** establish baselines; initial targets are p95 API read under 400 ms and write under 700 ms for normal non-media operations, with query budgets and load tests. Media latency depends on geography and SFU deployment.
- **Scale:** scale stateless API and web assets horizontally; queue expensive and retryable processing; paginate all growing collections; cap payloads; avoid unbounded embedded arrays and synchronous media processing.
- **Reliability:** idempotency for payments, enrollment, submissions, and webhooks; durable job state; bounded retries and dead-letter handling; health/readiness probes; backup restore exercises.
- **Accessibility:** target WCAG 2.2 AA, including keyboard operation, visible focus, semantic forms, captions/transcripts for media where available, and reduced-motion support.
- **Compatibility:** support current evergreen desktop/mobile browsers; document media capability fallbacks and minimum bandwidth/device limitations.
- **Observability:** structured logs, request/correlation IDs, metrics, traces, error reporting, queue and provider health, and privacy-aware alert payloads.
- **Data integrity:** schema validation, explicit state transitions, unique/idempotency constraints, and reconciliation for payment/entitlement and media processing state.

### Data retention and deletion rules

Retention periods are configurable policy values and must be approved for the launch jurisdiction and customer contracts before production; this document does not invent statutory periods. Apply these lifecycle rules:

- **Backups:** encrypted, access-restricted, time-bounded, and restore-tested. A user/tenant deletion is recorded for replay against restored backups; deleted data may remain only until the approved backup expiry window, then must be absent from retained recovery copies. Document legal holds and their authorized scope.
- **Recordings and derived media:** off by default unless a class explicitly enables informed recording. Set an expiry at creation, store it with all renditions/transcripts, prevent new access after expiry, and delete S3 originals/derivatives through verified lifecycle jobs. Retain longer only under a documented tenant/legal policy.
- **Messages:** define user deletion as a visible tombstone or deletion according to conversation policy; remove content and attachments at the approved retention deadline, except specific legal holds. Notification previews and logs must not preserve deleted message bodies.
- **Job applications:** retain only for the disclosed hiring purpose and approved period; candidate export/withdrawal and company deletion follow the approved jurisdictional policy. Restrict company exports to its tenant and applications.
- **Audit records:** append-only during the approved security/compliance retention period, then expire or anonymize using controlled policy. Do not treat audit retention as permission to retain message, application, or recording content.

Each policy needs an owner, purpose, legal basis/contract review, deletion job, failure alert, and evidence of completion. Data deletion includes MongoDB records, object storage, renditions, search indexes, caches, and downstream processors; backup expiry is handled by the replay/expiry policy above.

## Scope and unresolved product decisions

- Choose initial customer segment and first paid workflow: direct-to-learner, institution, or employer.
- Define launch geographies, age eligibility, privacy/retention obligations, accessibility obligations, and legal operator.
- Define pricing, currency/tax, seller-of-record, refunds, instructor revenue share, and marketplace moderation policy.
- Select identity/SSO approach, email delivery, payment provider, SFU/live media provider, AI provider, malware scanner, and support tooling. These must be real approved integrations; no fake success adapters in production.
- Decide profile portability and tenant ownership of learning records, domains, data residency, and tenant deletion/retention rules.
- Define employer verification, hiring data retention, candidate consent, mentor safety policy, and moderation staffing.
- Define recording default, consent UX, retention, transcript policy, and whether any geography prohibits recording.
- Define launch capacity, budget, recovery time/point objectives, support coverage, and operational owner for every external dependency.
