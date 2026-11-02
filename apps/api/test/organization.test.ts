import assert from "node:assert/strict";
import test from "node:test";
import { rolesAllow } from "../src/services/organization.service.js";
import { acceptInvitationSchema, createOrganizationSchema, invitationSchema, memberRolesSchema } from "../src/validators/organization.validators.js";
import { requirePrivilegedMfa } from "../src/middleware/organization-authorization.middleware.js";
import { loadConfig } from "../src/config/env.js";

test("organization permission bundles are scoped and never include platform administration", () => {
  assert.equal(rolesAllow(["STUDENT"], "organization.read"), true);
  assert.equal(rolesAllow(["STUDENT"], "member.invite"), false);
  assert.equal(rolesAllow(["ORGANIZATION_ADMIN"], "member.manage"), true);
  assert.equal(rolesAllow(["ORGANIZATION_ADMIN"], "platform.case.manage"), false);
  assert.equal(rolesAllow(["PLATFORM_ADMIN"], "member.manage"), false);
});

test("organization creation denies sessions without recent MFA", async () => {
  const middleware = requirePrivilegedMfa(loadConfig({ NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1:27017/lms_platform_test", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64url") }));
  let status = 0; let body: unknown;
  await middleware({ authContext: { userId: "user", sessionId: "session", csrfTokenHash: "hash", mfaVerified: false } } as never, { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } } as never, (() => undefined) as never);
  assert.equal(status, 403);
  assert.deepEqual(body, { error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } });
  status = 0; body = undefined;
  await middleware({ authContext: { userId: "user", sessionId: "session", csrfTokenHash: "hash", mfaVerified: true, mfaVerifiedAt: new Date(Date.now() - 301_000) } } as never, { status(value: number) { status = value; return this; }, json(value: unknown) { body = value; return this; } } as never, (() => undefined) as never);
  assert.equal(status, 403);
  assert.deepEqual(body, { error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } });
});

test("organization validators reject client supplied privilege or unknown fields", () => {
  assert.equal(createOrganizationSchema.safeParse({ name: "School", slug: "school", kind: "institution", role: "PLATFORM_ADMIN" }).success, false);
  assert.equal(createOrganizationSchema.safeParse({ name: "School", slug: "school", kind: "institution", tenantId: "attacker" }).success, false);
  assert.equal(invitationSchema.safeParse({ email: "a@example.test", roles: ["PLATFORM_ADMIN"] }).success, false);
  assert.equal(memberRolesSchema.safeParse({ roles: ["PLATFORM_ADMIN"] }).success, false);
  assert.equal(acceptInvitationSchema.safeParse({ token: "short" }).success, false);
});
