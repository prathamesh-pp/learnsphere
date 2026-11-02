import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { Types } from "mongoose";
import mongoose from "mongoose";
import { AuthSessionModel } from "../src/models/auth-session.model.js";
import { UserCredentialModel } from "../src/models/user-credential.model.js";
import { UserModel } from "../src/models/user.model.js";
import { PlatformGrantModel } from "../src/models/platform-grant.model.js";
import { loadConfig } from "../src/config/env.js";
import { login, register, InvalidCredentialsError } from "../src/services/auth.service.js";
import { hashPassword, verifyPassword } from "../src/services/password.service.js";
import { consumeRecoveryCode, createRecoveryCodes, createTotp, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, verifyTotp } from "../src/services/mfa.service.js";
import { createOpaqueToken, createSession, deriveCsrfToken, rotateSession, revokeSession, sha256 } from "../src/services/session.service.js";
import { csrfProtection, originProtection, requireSession, sessionCookieName, setSessionCookie } from "../src/middleware/auth.middleware.js";
import { createAuthRateLimiter } from "../src/middleware/auth-rate-limit.middleware.js";
import { createAuthController } from "../src/controllers/auth.controller.js";
import { registrationSchema } from "../src/validators/auth.validators.js";

const testConfig = loadConfig({
  NODE_ENV: "test", MONGODB_URI: "mongodb://127.0.0.1:27017/lms_platform_test",
  WEB_ORIGIN: "http://localhost:5173", MFA_ENCRYPTION_KEY: randomBytes(32).toString("base64url"),
});

function replaceMethod(target: object, name: string, replacement: (...args: never[]) => unknown): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  Object.defineProperty(target, name, { configurable: true, writable: true, value: replacement });
  return () => descriptor ? Object.defineProperty(target, name, descriptor) : Reflect.deleteProperty(target, name);
}

test("registration validation normalizes email and rejects self-assigned privilege fields", () => {
  const parsed = registrationSchema.safeParse({ email: " Learner@Example.com ", displayName: "Learner", password: "long-enough-password", role: "PLATFORM_ADMIN" });
  assert.equal(parsed.success, false);
  const valid = registrationSchema.parse({ email: " Learner@Example.com ", displayName: "Learner", password: "long-enough-password" });
  assert.equal(valid.email, "learner@example.com");
});

test("registration creates a user and separate Argon2id credential without duplicate disclosure", async () => {
  const id = new Types.ObjectId();
  let userCreated = false;
  let credential: Record<string, unknown> | undefined;
  const restoreTransaction = replaceMethod(mongoose.connection, "transaction", (async (run: (session: object) => Promise<unknown>) => run({})) as never);
  const restoreUser = replaceMethod(UserModel, "create", (async (values: [{ emailNormalized: string }]) => {
    userCreated = true; assert.equal(values[0]?.emailNormalized, "learner@example.com"); return [{ _id: id }];
  }) as never);
  const restoreCredential = replaceMethod(UserCredentialModel, "create", (async (values: [Record<string, unknown>]) => {
    credential = values[0]; return values;
  }) as never);
  try {
    await register({ email: "Learner@Example.com", displayName: "Learner", password: "long-enough-password" });
    assert.equal(userCreated, true);
    assert.ok(typeof credential?.passwordHash === "string");
    assert.notEqual(credential?.passwordHash, "long-enough-password");
    assert.equal(await verifyPassword(String(credential?.passwordHash), "long-enough-password"), true);

    const restoreDuplicate = replaceMethod(UserModel, "create", (async () => { throw Object.assign(new Error("duplicate"), { code: 11000 }); }) as never);
    try {
      await assert.doesNotReject(register({ email: "learner@example.com", displayName: "Learner", password: "long-enough-password" }));
    } finally { restoreDuplicate(); }
  } finally { restoreUser(); restoreCredential(); restoreTransaction(); }
});

test("password verification rejects an incorrect password", async () => {
  const hash = await hashPassword("correct-horse-battery-staple");
  assert.equal(hash.startsWith("$argon2id$"), true);
  assert.equal(await verifyPassword(hash, "wrong-password"), false);
});

test("login uses one generic credential error for missing users and bad passwords", async () => {
  const restore = replaceMethod(UserModel, "findOne", (() => ({ select: () => ({ lean: async () => null }) })) as never);
  try {
    await assert.rejects(login({ email: "absent@example.com", password: "wrong-password" }, testConfig), InvalidCredentialsError);
  } finally { restore(); }
});

test("login verifies Argon2id credentials and returns a new opaque session only on success", async () => {
  const userId = new Types.ObjectId();
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  const user = { _id: userId, emailNormalized: "learner@example.com", displayName: "Learner", status: "active" };
  const credential = { passwordHash, mfaEnabled: false };
  const restoreUser = replaceMethod(UserModel, "findOne", (() => ({ select: () => ({ lean: async () => user }) })) as never);
  const restoreCredential = replaceMethod(UserCredentialModel, "findOne", (() => ({ select: () => ({ lean: async () => credential }) })) as never);
  const restoreGrant = replaceMethod(PlatformGrantModel, "exists", (async () => null) as never);
  let persisted: Record<string, unknown> | undefined;
  const restoreSession = replaceMethod(AuthSessionModel, "create", (async (value: Record<string, unknown>) => { persisted = value; }) as never);
  try {
    const result = await login({ email: "learner@example.com", password: "correct-horse-battery-staple" }, testConfig);
    assert.equal(result.user.id, userId.toString());
    assert.equal(result.user.email, "learner@example.com");
    assert.ok(result.session.token);
    assert.equal(persisted?.tokenHash, sha256(result.session.token));
    await assert.rejects(login({ email: "learner@example.com", password: "wrong-password" }, testConfig), InvalidCredentialsError);
  } finally { restoreUser(); restoreCredential(); restoreGrant(); restoreSession(); }
});

test("an active PLATFORM_ADMIN grant requires MFA and cannot be obtained through registration", async () => {
  const userId = new Types.ObjectId();
  const passwordHash = await hashPassword("correct-horse-battery-staple");
  const user = { _id: userId, emailNormalized: "admin@example.com", displayName: "Admin", status: "active" };
  const restoreUser = replaceMethod(UserModel, "findOne", (() => ({ select: () => ({ lean: async () => user }) })) as never);
  const restoreCredential = replaceMethod(UserCredentialModel, "findOne", (() => ({ select: () => ({ lean: async () => ({ passwordHash, mfaEnabled: false }) }) })) as never);
  const restoreGrant = replaceMethod(PlatformGrantModel, "exists", (async () => ({ _id: new Types.ObjectId() })) as never);
  try {
    await assert.rejects(login({ email: "admin@example.com", password: "correct-horse-battery-staple" }, testConfig), InvalidCredentialsError);
  } finally { restoreUser(); restoreCredential(); restoreGrant(); }
});

test("login API errors do not expose credentials or internal details", async () => {
  const restore = replaceMethod(UserModel, "findOne", (() => ({ select: () => ({ lean: async () => null }) })) as never);
  let responseStatus = 0;
  let responseBody: unknown;
  try {
    await createAuthController(testConfig).login(
      { body: { email: "absent@example.com", password: "submitted-secret" } } as never,
      { status(code: number) { responseStatus = code; return this; }, json(body: unknown) { responseBody = body; return this; } } as never,
      (error: unknown) => { throw error; },
    );
    assert.equal(responseStatus, 401);
    const body = JSON.stringify(responseBody);
    assert.doesNotMatch(body, /submitted-secret|passwordHash|stack|token/);
  } finally { restore(); }
});

test("session creation persists only a hash of a cryptographically random opaque identifier", async () => {
  let stored: Record<string, unknown> | undefined;
  const restore = replaceMethod(AuthSessionModel, "create", (async (value: Record<string, unknown>) => { stored = value; }) as never);
  try {
    const session = await createSession(new Types.ObjectId(), 60, 300, testConfig.mfaEncryptionKey);
    assert.notEqual(session.token, session.csrfToken);
    assert.equal(stored?.tokenHash, sha256(session.token));
    assert.equal(stored?.csrfTokenHash, sha256(deriveCsrfToken(session.token, testConfig.mfaEncryptionKey)));
    assert.equal(session.csrfToken, deriveCsrfToken(session.token, testConfig.mfaEncryptionKey));
    assert.equal(Object.values(stored ?? {}).includes(session.token), false);
    assert.equal("token" in (stored ?? {}), false);
    assert.equal(session.token.length, 43);
    assert.equal(session.expiresAt.getTime() - Date.now() <= 60_000, true);
  } finally { restore(); }
});

test("session rotation revokes the prior token and issues a different token", async () => {
  const prior = { absoluteExpiresAt: new Date(Date.now() + 300_000), mfaVerifiedAt: undefined };
  let filter: Record<string, unknown> | undefined;
  let replacement: Record<string, unknown> | undefined;
  const restoreTransaction = replaceMethod(mongoose.connection, "transaction", (async (run: (session: object) => Promise<unknown>) => run({})) as never);
  const restoreFind = replaceMethod(AuthSessionModel, "findOneAndUpdate", (async (query: Record<string, unknown>) => { filter = query; return prior; }) as never);
  const restoreCreate = replaceMethod(AuthSessionModel, "create", (async (values: [Record<string, unknown>]) => { replacement = values[0]; }) as never);
  try {
    const oldToken = createOpaqueToken();
    const rotated = await rotateSession(oldToken, new Types.ObjectId(), 60, testConfig.mfaEncryptionKey);
    assert.ok(rotated);
    assert.equal(filter?.tokenHash, sha256(oldToken));
    assert.notEqual(rotated.token, oldToken);
    assert.equal(replacement?.tokenHash, sha256(rotated.token));
    assert.equal(rotated.csrfToken, deriveCsrfToken(rotated.token, testConfig.mfaEncryptionKey));
  } finally { restoreFind(); restoreCreate(); restoreTransaction(); }
});

test("logout revokes by token hash and never queries with the raw session id", async () => {
  const token = createOpaqueToken();
  let filter: Record<string, unknown> | undefined;
  const restore = replaceMethod(AuthSessionModel, "updateOne", (async (query: Record<string, unknown>) => { filter = query; }) as never);
  try {
    await revokeSession(token);
    assert.equal(filter?.tokenHash, sha256(token));
    assert.equal(JSON.stringify(filter).includes(token), false);
  } finally { restore(); }
});

test("MFA TOTP secret is authenticated-encrypted and TOTP validation is time-bound", () => {
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, testConfig.mfaEncryptionKey);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptTotpSecret(encrypted, testConfig.mfaEncryptionKey), secret);
  assert.throws(() => decryptTotpSecret(`${encrypted.slice(0, -2)}xx`, testConfig.mfaEncryptionKey));
  const code = createTotp(secret, 1_800_000_000_000);
  assert.equal(verifyTotp(secret, code, 1_800_000_000_000), true);
  assert.equal(verifyTotp(secret, code, 1_800_000_090_000), false);
});

test("recovery codes are random, hashed, and consumed once using an atomic update", async () => {
  const codes = createRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, codes.length);
  const stored = new Set([sha256(codes[0]!) ]);
  const restore = replaceMethod(UserCredentialModel, "updateOne", (async (filter: { recoveryCodeHashes: string }, update: { $pull: { recoveryCodeHashes: string } }) => {
    assert.equal(filter.recoveryCodeHashes, update.$pull.recoveryCodeHashes);
    if (!stored.delete(filter.recoveryCodeHashes)) return { modifiedCount: 0 };
    return { modifiedCount: 1 };
  }) as never);
  try {
    assert.equal(await consumeRecoveryCode("012345678901234567890123", codes[0]!), true);
    assert.equal(await consumeRecoveryCode("012345678901234567890123", codes[0]!), false);
  } finally { restore(); }
});

test("CSRF requires the session-bound token and Origin is exact", () => {
  const baseRequest = { method: "POST", get: (name: string) => name === "x-csrf-token" ? "a".repeat(43) : undefined, authContext: { csrfTokenHash: sha256("a".repeat(43)) } };
  let status = 200;
  let continued = false;
  const response = { status(code: number) { status = code; return this; }, json() { return this; } };
  csrfProtection()(baseRequest as never, response as never, (() => { continued = true; }) as never);
  assert.equal(status, 200);
  assert.equal(continued, true);
  let rejectedStatus = 200;
  const rejectedResponse = { status(code: number) { rejectedStatus = code; return this; }, json() { return this; } };
  csrfProtection()({ ...baseRequest, get: () => "wrong-token" } as never, rejectedResponse as never, (() => undefined) as never);
  assert.equal(rejectedStatus, 403);

  let originStatus = 200;
  const originResponse = { status(code: number) { originStatus = code; return this; }, json() { return this; } };
  originProtection(testConfig)({ method: "POST", get: () => "http://localhost:5173.attacker.test" } as never, originResponse as never, (() => undefined) as never);
  assert.equal(originStatus, 403);
});

test("session authentication rejects expired or revoked token records", async () => {
  let query: Record<string, unknown> | undefined;
  const restore = replaceMethod(AuthSessionModel, "findOneAndUpdate", ((filter: Record<string, unknown>) => {
    query = filter;
    return { select: async () => null };
  }) as never);
  try {
    let responseStatus = 200;
    const request = { headers: { cookie: `${sessionCookieName(testConfig)}=${createOpaqueToken()}` } };
    const response = { status(code: number) { responseStatus = code; return this; }, json() { return this; } };
    await requireSession(testConfig)(request as never, response as never, (() => undefined) as never);
    assert.equal(responseStatus, 401);
    assert.equal(query?.revokedAt, null);
    assert.ok(query?.$expr);
  } finally { restore(); }
});

test("session cookies are HttpOnly, SameSite=Lax, and never set a Domain attribute", () => {
  let cookie = "";
  const response = { append: (_name: string, value: string) => { cookie = value; } };
  setSessionCookie(response as never, testConfig, createOpaqueToken(), new Date(Date.now() + 60_000));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Domain=/i);
  const productionCookie = { append: (_name: string, value: string) => { cookie = value; } };
  const productionConfig = { ...testConfig, nodeEnv: "production" as const, webOrigin: "https://learnsphere.example" };
  setSessionCookie(productionCookie as never, productionConfig, createOpaqueToken(), new Date(Date.now() + 60_000));
  assert.match(cookie, /^__Host-learnsphere_session=/);
  assert.match(cookie, /; Secure/);
});

test("authentication rate limiter returns 429 after the configured process-local threshold", async () => {
  const limiter = createAuthRateLimiter(1, 60_000);
  const request = { path: "/login", ip: "127.0.0.1" };
  let status = 200;
  let continued = 0;
  const response = { setHeader() { return this; }, status(code: number) { status = code; return this; }, json() { return this; } };
  const next = () => { continued += 1; };
  await limiter(request as never, response as never, next as never);
  await limiter(request as never, response as never, next as never);
  assert.equal(continued, 1);
  assert.equal(status, 429);
});
