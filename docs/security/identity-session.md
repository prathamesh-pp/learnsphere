# Identity and session security (Phase 2)

This document describes the implemented identity boundary. Organization membership, authorization roles, email delivery, and other product modules are not implemented in this phase.

## Local configuration

Copy `.env.example` to `.env`, provide a MongoDB replica-set URI (transactions are used for identity/session changes), and replace `MFA_ENCRYPTION_KEY` with a fresh 32-byte base64url key. Generate a local key with:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Use a different key per environment, store it outside source control, and preserve the key for as long as encrypted TOTP secrets need to be read. Rotation requires an explicit decrypt/re-encrypt procedure and revocation of existing sessions; changing it directly makes existing MFA secrets and session-derived CSRF tokens unusable. `.env.example` intentionally contains a non-working placeholder, not a usable secret.

## API behavior

- `POST /api/v1/auth/register`: creates a user and separate Argon2id credential; always returns the same generic `202` response for a new or duplicate email. It does not automatically sign in.
- `POST /api/v1/auth/login`: verifies credentials and, for a `PLATFORM_ADMIN` with an active platform grant, requires configured TOTP MFA. Success sets the opaque server-side session cookie and returns only a user projection.
- `GET /api/v1/auth/me`: returns the authenticated user projection.
- `GET /api/v1/auth/csrf`: returns a stable per-session synchronizer token. It is derived with domain-separated HMAC from the opaque session token and server key; MongoDB stores only its hash. Keep it in frontend memory and send it as `X-CSRF-Token` on authenticated `POST`, `PUT`, `PATCH`, and `DELETE` requests. The session identifier remains only in the HttpOnly cookie. Concurrent tabs receive the same token until session rotation.
- `POST /api/v1/auth/session/rotate` and `POST /api/v1/auth/logout`: require exact `Origin` and valid CSRF token. Rotation atomically revokes the prior opaque token and issues a new one.
- `POST /api/v1/auth/recovery`: validates and rate-limits the non-enumerating boundary, then returns the same `503 RECOVERY_UNAVAILABLE` response for every address. It deliberately does not create/reset credentials or send email. A real approved delivery provider and recovery policy are required before account recovery can be enabled.
- `GET /api/v1/auth/mfa/totp`, `POST /api/v1/auth/mfa/totp/setup`, and `POST /api/v1/auth/mfa/totp/confirm`: allow users to enroll TOTP. Pending setup is bound to its initiating session and expires after ten minutes. The secret is encrypted with AES-256-GCM; ten one-time recovery codes are shown once, stored as SHA-256 hashes, and atomically removed on use. TOTP steps cannot be replayed. Enabling or replacing MFA revokes prior sessions; replacing an existing factor requires recent MFA verification. Email ownership is not verified in this phase because no delivery provider is configured.

Registration accepts no role, grant, or tenant fields. `PLATFORM_ADMIN` is read from the separate `platformGrants` collection; no public grant-writing endpoint exists. Administrators must enroll MFA before a platform grant is made through a separately audited operational process.

## Session and rate-limit policy

Session IDs are 256-bit random base64url tokens. MongoDB stores only SHA-256 token hashes. Sessions have configurable sliding idle expiration, immutable absolute expiration, revocation timestamps, and a TTL cleanup index. Authentication rejects expired/revoked sessions even before TTL cleanup. Cookies are host-only, `HttpOnly`, `SameSite=Lax`; production cookies use `Secure` and the `__Host-` prefix.

Platform authorization is separate from authentication. Platform routes must compose the middleware array returned by `requirePlatformAdmin(config)`; it checks the current grant and configured MFA credential on each request. Pass `{ permission, sensitive: true }` for permission-specific sensitive routes. `revokedAt:null` is the canonical active-record condition and matches both null and absent values. General platform access uses `PLATFORM_ADMIN_MFA_MAX_AGE_SECONDS`; sensitive actions use the shorter `PLATFORM_ADMIN_SENSITIVE_MFA_MAX_AGE_SECONDS`. Grant changes affect the next protected request; operations added later must recheck authorization at their transactional write boundary if revocation races with in-flight work.

The app resolves valid cookie sessions and applies Origin plus CSRF protection before dispatching application routers. Therefore every unsafe request that already has an authenticated session is checked globally, including routes added later below that middleware. Register authenticated routes with `createAuthenticatedRouter(config)`, which applies authentication before CSRF, as an additional route-level guard. Health probes follow the global security chain, while safe probe reads skip session/database lookup so liveness stays independent. Session idle touches use MongoDB server time and atomically cap `expiresAt` to `absoluteExpiresAt`.

Startup requires MongoDB 4.2 or newer on a writable replica set or mongos, creates only declared auth indexes with `createIndexes()`, and verifies required unique and TTL indexes before opening the listener. Readiness repeats the topology and index checks. No destructive `syncIndexes()` operation is used.

Authentication rate limits are atomic within one API process, keyed by route and client IP. They are **not multi-instance protection**; inject a shared atomic `RateLimitStore` implementation before horizontal production deployment. Current process-local defaults are 3 registrations/hour, 10 login attempts/15 minutes, 3 recovery initiations/hour, and 5 MFA operations/15 minutes per IP and route. These values need security/abuse review before public launch.

## Data and operational limits

Registration, session rotation, and MFA enrollment/revocation use MongoDB transactions; local and test MongoDB must run as a replica set. `npm run test` runs isolated unit/HTTP tests. `npm run test:integration` requires the explicit loopback `LMS_INTEGRATION_MONGODB_URI` and only accepts a replica-set database named `learnsphere_phase2_test`; it uses and removes its own fixture records without dropping collections or the database. GitHub Actions starts a disposable single-node replica set for these tests. No reset email is sent and no password-recovery token is issued in this phase. Registration creates only a global user; organization memberships and tenant authorization remain out of scope. API logs do not record request bodies, cookies, passwords, CSRF values, recovery codes, or database error details.
