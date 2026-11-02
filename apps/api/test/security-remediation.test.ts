import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Types } from "mongoose";
import { PlatformGrantModel } from "../src/models/platform-grant.model.js";
import { UserCredentialModel } from "../src/models/user-credential.model.js";
import { loadConfig } from "../src/config/env.js";
import { activePlatformGrantFilter } from "../src/services/platform-authorization.service.js";
import { requirePlatformAdmin } from "../src/middleware/auth.middleware.js";
import { hasRequiredIndexes, isTransactionCapableHello, REQUIRED_INDEXES } from "../src/config/database.js";

const config = loadConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017/lms_platform_test",
  WEB_ORIGIN: "http://localhost:5173",
  MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
});

function mockMethod(target: object, name: string, value: (...args: never[]) => unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value });
  return () => descriptor ? Object.defineProperty(target, name, descriptor) : Reflect.deleteProperty(target, name);
}

async function runPlatformGuard(
  options: Parameters<typeof requirePlatformAdmin>[1],
  context?: { userId: string; mfaVerifiedAt?: Date },
  grant: unknown = { _id: new Types.ObjectId() },
  mfaConfigured: unknown = { _id: new Types.ObjectId() },
) {
  let statusCode = 0;
  let body: unknown;
  let nextCalled = false;
  const request = { authContext: context ? { ...context, sessionId: new Types.ObjectId().toString(), csrfTokenHash: "", mfaVerified: Boolean(context.mfaVerifiedAt) } : undefined };
  const response = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } };
  const [, authorize] = requirePlatformAdmin(config, options);
  const restoreCredential = mockMethod(UserCredentialModel, "exists", (async () => mfaConfigured) as never);
  try { await new Promise<void>((resolve, reject) => {
    let calledNext = false;
    const result = authorize(request as never, response as never, (error?: unknown) => {
      calledNext = true;
      if (error) { reject(error); return; }
      nextCalled = true;
      resolve();
    });
    Promise.resolve(result).then(() => { if (!calledNext) resolve(); }, reject);
  }); } finally { restoreCredential(); }
  return { statusCode, body, nextCalled };
}

test("active platform grant query is canonical for missing and null revocation dates", () => {
  const userId = new Types.ObjectId();
  const filter = activePlatformGrantFilter(userId.toString(), new Date("2026-10-01T00:00:00Z"), "platform.audit.read");
  assert.ok(filter.userId instanceof Types.ObjectId);
  assert.equal(filter.roleKey, "PLATFORM_ADMIN");
  assert.equal(filter.revokedAt, null);
  assert.deepEqual(filter.startsAt, { $lte: new Date("2026-10-01T00:00:00Z") });
  assert.deepEqual(filter.expiresAt, { $gt: new Date("2026-10-01T00:00:00Z") });
  assert.equal(filter.permissions, "platform.audit.read");
});

test("platform authorization requires an active grant and completed, fresh MFA", async () => {
  let capturedFilter: Record<string, unknown> | undefined;
  const restore = mockMethod(PlatformGrantModel, "exists", (async (filter: Record<string, unknown>) => {
    capturedFilter = filter;
    return { _id: new Types.ObjectId() };
  }) as never);
  try {
    const userId = new Types.ObjectId().toString();
    const fresh = await runPlatformGuard({ sensitive: true, permission: "platform.audit.read" }, { userId, mfaVerifiedAt: new Date() });
    assert.equal(fresh.nextCalled, true);
    assert.equal(capturedFilter?.revokedAt, null);
    assert.equal(capturedFilter?.permissions, "platform.audit.read");

    const missingMfa = await runPlatformGuard({}, { userId });
    assert.equal(missingMfa.statusCode, 403);
    assert.deepEqual(missingMfa.body, { error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } });

    const disabledMfa = await runPlatformGuard({}, { userId, mfaVerifiedAt: new Date() }, { _id: new Types.ObjectId() }, null);
    assert.equal(disabledMfa.statusCode, 403);

    const staleSensitiveMfa = await runPlatformGuard({ sensitive: true }, { userId, mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) });
    assert.equal(staleSensitiveMfa.statusCode, 403);
    const olderButGeneralMfa = await runPlatformGuard({}, { userId, mfaVerifiedAt: new Date(Date.now() - 10 * 60_000) });
    assert.equal(olderButGeneralMfa.nextCalled, true);
  } finally { restore(); }
});

test("missing grants and grant-store failures deny access without exposing grant details", async () => {
  const restoreMissing = mockMethod(PlatformGrantModel, "exists", (async () => null) as never);
  try {
    const denied = await runPlatformGuard({}, { userId: new Types.ObjectId().toString(), mfaVerifiedAt: new Date() });
    assert.equal(denied.statusCode, 403);
    assert.deepEqual(denied.body, { error: { code: "FORBIDDEN", message: "Access is not permitted." } });
  } finally { restoreMissing(); }

  const restoreFailure = mockMethod(PlatformGrantModel, "exists", (async () => { throw new Error("private grant query detail"); }) as never);
  try {
    const failed = await runPlatformGuard({}, { userId: new Types.ObjectId().toString(), mfaVerifiedAt: new Date() });
    assert.equal(failed.statusCode, 503);
    assert.doesNotMatch(JSON.stringify(failed.body), /private grant query detail/);
  } finally { restoreFailure(); }
});

test("readiness topology check rejects standalone MongoDB and accepts replica sets or mongos", () => {
  assert.equal(isTransactionCapableHello({ isWritablePrimary: true, logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }), false);
  assert.equal(isTransactionCapableHello({ setName: "rs0", isWritablePrimary: true, logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }), true);
  assert.equal(isTransactionCapableHello({ msg: "isdbgrid", isWritablePrimary: true, logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }), true);
  assert.equal(isTransactionCapableHello({ setName: "rs0", isWritablePrimary: false, logicalSessionTimeoutMinutes: 30, maxWireVersion: 25 }), false);
  assert.equal(isTransactionCapableHello({ setName: "rs0", isWritablePrimary: true, logicalSessionTimeoutMinutes: 30, maxWireVersion: 7 }), false);
});

test("required indexes, including tenant-aware partial course indexes, must all be present", () => {
  const allCollections: Record<string, Array<Record<string, unknown>>> = {};
  for (const spec of REQUIRED_INDEXES) {
    (allCollections[spec.collection] ??= []).push({ key: spec.key, ...(spec.unique === undefined ? {} : { unique: spec.unique }), ...(spec.expireAfterSeconds === undefined ? {} : { expireAfterSeconds: spec.expireAfterSeconds }), ...(spec.partialFilterExpression === undefined ? {} : { partialFilterExpression: spec.partialFilterExpression }) });
  }
  assert.equal(hasRequiredIndexes(REQUIRED_INDEXES, allCollections), true);
  allCollections.authsessions = allCollections.authsessions!.filter((index) => index.expireAfterSeconds === undefined);
  assert.equal(hasRequiredIndexes(REQUIRED_INDEXES, allCollections), false);
});
