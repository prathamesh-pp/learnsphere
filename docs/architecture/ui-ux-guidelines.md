# LearnSphere UI/UX guidelines

**Status:** design direction. The app implements responsive sign-in, course discovery/detail, instructor course and lesson authoring, and learner progress screens. Advanced admin, assessment, live class, and marketplace flows remain design proposals.

## Initial locale and client assumptions

The first experience is an English-first responsive web app for an India-first launch with global reach. Use locale-aware date, time, number, and timezone formatting; default currency display and checkout is INR until additional supported currencies are approved. Do not imply global data residency, worldwide service availability, or unsupported payment coverage. Keep translation keys and content-language metadata ready for later localization without shipping translated UI in the first release.

## Product experience principles

- Make the next useful action clear for the user's current role and context.
- Show the source and scope of information: personal, organization, public, or shared with an employer.
- Use honest states for pending payment, processing media, queued jobs, unavailable live sessions, and AI-generated content.
- Prefer progressive disclosure for complex authoring/admin tasks; keep critical permissions, deadlines, prices, and privacy choices visible.
- Keep navigation, terminology, and core controls consistent across roles while adapting dashboards to actual permissions.
- Build for keyboard, touch, low bandwidth, captions, reduced motion, and interrupted sessions from the first workflow.

## Premium SaaS visual direction

Use a calm, editorial education workspace with warm neutral surfaces, deep ink typography, and a confident indigo/blue primary color. Teal or green can communicate verified success; amber indicates attention; red is reserved for destructive or blocking errors. Use restrained gradients only for brand moments, not dense learning/admin surfaces. Avoid decorative cards for every control; establish hierarchy with spacing, typography, and a small number of surface elevations.

This is a starting direction, not a locked brand. Validate contrast, dark mode need, brand distinction, and target user preference before creating a full design system.

## Design tokens

Tokens should be CSS custom properties and mapped to accessible component variables. Initial palette values are proposals and must be checked against text/background contrast pairs.

| Token | Proposed value | Use |
|---|---|---|
| `color-brand-700` | `#3730A3` | Primary buttons, active navigation, links on light surface |
| `color-brand-600` | `#4F46E5` | Interactive brand accents |
| `color-brand-50` | `#EEF2FF` | Subtle selected surfaces |
| `color-ink-900` | `#172033` | Main text |
| `color-ink-600` | `#475569` | Secondary text |
| `color-ink-400` | `#94A3B8` | Disabled/tertiary marks only, not small body text |
| `color-surface` | `#FFFFFF` | Cards and main content |
| `color-canvas` | `#F8FAFC` | App background |
| `color-border` | `#E2E8F0` | Dividers and input borders |
| `color-success` | `#15803D` | Confirmed outcomes |
| `color-warning` | `#B45309` | Attention and pending actions |
| `color-danger` | `#B91C1C` | Destructive/error states |
| `radius-sm/md/lg` | `6px / 10px / 16px` | Inputs, cards, dialogs |
| `space-*` | 4px base scale: 4, 8, 12, 16, 24, 32, 48, 64 | Layout rhythm |
| `shadow-sm/md` | low-opacity neutral shadows | Floating menus/dialogs only; prefer borders for cards |

Use semantic state tokens rather than hardcoding raw colors in features. Never use color alone to convey status. Offer a dark theme only when contrast and all component states are designed and tested, not by automatic inversion.

## Typography and content

- Use a highly legible UI sans-serif with system fallbacks; load a licensed webfont only after performance and licensing review. The current shell uses an Inter/system stack; it is not a commitment to a paid font.
- Suggested scale: 12 px metadata, 14 px dense controls, 16 px body, 20 px section heading, 24–32 px page heading, 40 px marketing hero. Use 1.45–1.6 body line height.
- Keep line length near 60–80 characters for instructional text. Use sentence case, direct action labels, and meaningful empty states.
- Dates show the user's locale/time zone and preserve an explicit timezone when scheduling. Initially display prices in INR with clear currency code/symbol and unambiguous compensation, deadlines, and live times. Do not show a payment as complete until the provider-confirmed state arrives.
- Explain permissions and profile sharing at the point of action; avoid legal language as the only explanation.

## Layout and navigation

- Responsive app shell: desktop collapsible left navigation, persistent top bar with workspace switcher/search/help/profile; compact mobile navigation uses a clear menu and reachable primary action.
- Tenant context is always visible when viewing organization-scoped content. Switching organizations must not silently change the audience or submit context.
- Use distinct public discovery, learner, instructor, recruiter/company, mentor, organization admin, and platform admin shells only where their workflows differ. Do not show a role selector that grants access.
- Organize global navigation by user task: Learn, Teach, Careers, Community, Projects, Mentorship, and Workspace/Admin as permitted. Keep module rollout progressive to avoid presenting unavailable features.
- Breadcrumbs for deep authoring/admin flows; tabs only for peer views; preserve meaningful URLs and browser history.
- Layout widths: reading surfaces 680–800 px; dashboards up to 1280 px; dense tables may scroll horizontally only with clear responsive fallback and important columns prioritized.

## Role-specific dashboard priorities

- **STUDENT:** continue learning, upcoming class/deadline, feedback and progress, saved opportunities, relevant community/project activity, clear profile visibility status.
- **Instructor:** teaching overview, course draft/publish status, upcoming sessions, submissions requiring review, learner risk indicators only when explainable and non-stigmatizing.
- **Recruiter:** active jobs, application pipeline, pending approvals, consent-aware candidate list, clear company/workspace identity and access roles.
- **COMPANY_ADMIN:** company verification, recruiter membership/permissions, job review, organization settings, aggregate hiring metrics with privacy safeguards. The company is an organization, not a separate account or membership concept.
- **Mentor:** requests to respond to, upcoming sessions, stated learner goals, availability and boundaries, private follow-up actions.
- **ORGANIZATION_ADMIN:** member/invitation status, course/cohort administration, tenant configuration, integration health, audit/export controls, scoped adoption reports.
- **PLATFORM_ADMIN:** operational queues, abuse/support escalations, service/provider health, audited access actions. Separate platform operations from ordinary learning navigation and avoid unnecessary exposure of user content.

The full supported bundles are STUDENT, INSTRUCTOR, RECRUITER, COMPANY_ADMIN, MENTOR, ORGANIZATION_ADMIN, and PLATFORM_ADMIN. A user may have several organization-scoped bundles and switch between organizations; the visible dashboard follows active permissions and tenant context, never a self-selected role. Platform administration is a separate, audited grant. Instructor, recruiter, mentor, and learner screens show only records allowed by the current resource relationship and consent.

Every dashboard is permission-derived and configurable within guardrails; user role labels alone do not determine access.

Historical Release 1 UI scope was limited to registration/login/recovery, organization creation/invitation/membership, current organization context, permission-aware access-denied states, and audit-relevant confirmations. That original milestone did not include a course dashboard; the later organization-scoped course workflow is implemented and described in the current project status documentation.

## Responsive behavior

- Design from a 320 px viewport; test common phone, tablet, laptop, and large desktop widths.
- At narrow width, convert sidebars to drawers, multi-column cards to a single column, and tables to prioritized row summaries or accessible detail views.
- Keep primary actions, error messages, and status visible without hover. Touch targets should be comfortably sized (target 44×44 CSS px where practical).
- For live class, provide device checks, clear mic/camera state, captions controls, reconnection status, and a usable non-video path where possible.
- For uploads and long jobs, preserve progress/state across navigation and make retry/cancel behavior explicit.

## Accessibility

- Target WCAG 2.2 AA. Use semantic headings/landmarks, labels and instructions, visible focus, skip links, logical focus order, keyboard-operable menus/dialogs, and accessible validation summaries.
- Maintain contrast for text, controls, focus indicators, disabled states, charts, and overlays. Verify color tokens; proposed values are not certification.
- Provide captions/transcripts for live/recorded content when supported and disclose limitations. Don't rely on audio/video alone for critical information.
- Respect reduced motion, zoom/reflow, browser text settings, and screen reader naming. Announce asynchronous form/job updates without flooding live regions.
- Forms show errors next to fields and in a summary; never erase user input after recoverable failures.
- Assess cognitive accessibility: plain instructions, chunked assessments, forgiving undo for safe actions, and clear consequences for destructive actions.
- Accessibility testing includes automated checks plus keyboard and assistive-technology review; automation alone is insufficient.

## Interaction patterns and states

- Buttons distinguish primary, secondary, tertiary, and destructive action; one primary action per local decision area.
- Use confirmation for irreversible or high-impact actions; present object name, consequence, and recovery/deletion policy. Avoid confirmation dialogs for routine navigation.
- Use optimistic UI only when rollback is safe and clearly handled. Payment, enrollment, grading, permission, and publish outcomes wait for authoritative server response.
- All network-backed views include loading, empty, error, permission-denied, stale/offline, and retry states. Skeletons preserve layout and should not imply real data.
- Toasts confirm brief outcomes; important errors remain inline or in an activity/notification center. Never communicate a durable payment/grade result only through a disappearing toast.
- Search includes scope, clear filters, accessible result count, no-result guidance, and privacy-respecting suggestions. Avoid exposing candidate/user data through autocomplete before authorization.
- State badges pair text/icon with color and distinguish draft, review, scheduled, processing, published, failed, and archived states.
- Media controls visibly indicate camera/mic/share/recording state. Recording consent is obtained before capture starts and remains discoverable.
- AI responses are labeled, can be regenerated/stopped/reported, identify sources where relevant, and make data retention choices findable.

## UI content and privacy

- Explain whether a profile field, course, post, project, application, message, or recording is public, tenant-only, shared with a specific party, or private.
- Show the recipient and purpose before sharing a profile or submitting a job application. Make withdrawal/edit options visible where allowed.
- Use anonymized aggregate labels and minimum-group thresholds in analytics; do not graph individual learner performance to employers by default.
- Do not expose internal IDs, raw errors, provider payloads, moderation details, or secrets in the interface.
- Keep deletion/export and notification controls easy to find; explain retention exceptions plainly.

## Design-system implementation guidance

- Build accessible primitives and tokens before bespoke feature styling; use Tailwind and/or shadcn/ui only if the team can maintain accessible variants and consistent tokens.
- Keep domain behavior out of generic components. Feature components own content and API state; shared controls own presentation and keyboard behavior.
- Use Framer Motion sparingly for meaningful transitions, respect reduced motion, and avoid animation in dense data or live-session controls unless it communicates state.
- Document component states, responsive behavior, error cases, and keyboard interactions. Validate with real users from learner, instructor, recruiter, and administrator groups.

## Decisions to validate

Validate final brand identity, typography/font licensing, dark mode demand, navigation grouping, mobile-first priorities, density preferences for instructors/recruiters, preferred calendar experience, language/localization needs, and whether institution customers require white-label theming.
