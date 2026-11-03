import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import test, { after, afterEach, before } from "node:test";
import { AuthSessionModel } from "../../src/models/auth-session.model.js";
import { PlatformGrantModel } from "../../src/models/platform-grant.model.js";
import { UserCredentialModel } from "../../src/models/user-credential.model.js";
import { UserModel } from "../../src/models/user.model.js";
import { OrganizationModel } from "../../src/models/organization.model.js";
import { OrganizationMembershipModel } from "../../src/models/organization-membership.model.js";
import { OrganizationInvitationModel } from "../../src/models/organization-invitation.model.js";
import { AuditEventModel } from "../../src/models/audit-event.model.js";
import { CourseModel } from "../../src/models/course.model.js";
import { LessonModel } from "../../src/models/lesson.model.js";
import { EnrollmentModel } from "../../src/models/enrollment.model.js";
import { LessonProgressModel } from "../../src/models/lesson-progress.model.js";
import { MediaAssetModel, MediaUploadIntentModel } from "../../src/models/media-asset.model.js";
import { isDatabaseReady, isTransactionCapableHello, REQUIRED_INDEXES, hasRequiredIndexes } from "../../src/config/database.js";
import { loadConfig } from "../../src/config/env.js";
import { beginTotpSetup, confirmTotpSetup, login, register } from "../../src/services/auth.service.js";
import { createTotp, encryptTotpSecret, consumeRecoveryCode, createRecoveryCodes } from "../../src/services/mfa.service.js";
import { createSession, rotateSession, sha256 } from "../../src/services/session.service.js";
import { requirePlatformAdmin, sessionCookieName } from "../../src/middleware/auth.middleware.js";

const integrationUri = process.env.LMS_INTEGRATION_MONGODB_URI;
const requiredDatabaseName = "learnsphere_phase2_test";
if (!integrationUri) throw new Error("LMS_INTEGRATION_MONGODB_URI must explicitly point to the isolated test replica set.");
const parsedUri = new URL(integrationUri);
const databaseName = parsedUri.pathname.replace(/^\//, "").split("/")[0];
if (!(["localhost", "127.0.0.1", "::1"].includes(parsedUri.hostname)) || databaseName !== requiredDatabaseName || parsedUri.searchParams.get("replicaSet") !== "rs0") {
  throw new Error(`Integration tests only permit a local replica set and database named ${requiredDatabaseName}.`);
}

const config = loadConfig({
  NODE_ENV: "test",
  MONGODB_URI: integrationUri,
  WEB_ORIGIN: "http://localhost:5173",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64url"),
});

let runId = randomUUID();
const userIds: Types.ObjectId[] = [];
const credentialIds: Types.ObjectId[] = [];

function rememberUser(id: Types.ObjectId): Types.ObjectId { userIds.push(id); return id; }

async function createUser(emailPrefix: string, credential: Partial<Pick<import("../../src/models/user-credential.model.js").UserCredentialRecord, "mfaEnabled" | "totpSecretEncrypted" | "recoveryCodeHashes" | "lastTotpStep">> = {}) {
  const user = await UserModel.create({ emailNormalized: `${emailPrefix}-${runId}@example.test`, displayName: "Integration User", status: "active" });
  rememberUser(user._id);
  const createdCredential = await UserCredentialModel.create({ userId: user._id, passwordHash: "integration-hash", passwordChangedAt: new Date(), mfaEnabled: false, recoveryCodeHashes: [], ...credential });
  credentialIds.push(createdCredential._id);
  return { user, credential: createdCredential };
}

async function runMiddleware(
  middlewares: readonly import("express").RequestHandler[],
  request: Record<string, unknown>,
): Promise<{ statusCode: number; body?: unknown; passed: boolean }> {
  let statusCode = 0;
  let body: unknown;
  let passed = false;
  const response = { status(code: number) { statusCode = code; return this; }, json(value: unknown) { body = value; return this; } };
  const run = (index: number): Promise<void> => new Promise((resolve, reject) => {
    const middleware = middlewares[index];
    if (!middleware) { passed = true; resolve(); return; }
    let calledNext = false;
    const result = middleware(request as never, response as never, (error?: unknown) => {
      calledNext = true;
      if (error) { reject(error); return; }
      void run(index + 1).then(resolve, reject);
    });
    Promise.resolve(result).then(() => { if (!calledNext) resolve(); }, reject);
  });
  await run(0);
  return { statusCode, body, passed };
}

before(async () => {
  await mongoose.connect(integrationUri!, { autoIndex: false });
  const hello = await mongoose.connection.db!.admin().command({ hello: 1 });
  if (!isTransactionCapableHello(hello as Readonly<Record<string, unknown>>)) throw new Error("Integration database is not transaction-capable.");
  await Promise.all([UserModel.createIndexes(), UserCredentialModel.createIndexes(), AuthSessionModel.createIndexes(), PlatformGrantModel.createIndexes(), OrganizationModel.createIndexes(), OrganizationMembershipModel.createIndexes(), OrganizationInvitationModel.createIndexes(), AuditEventModel.createIndexes(), CourseModel.createIndexes(), LessonModel.createIndexes(), EnrollmentModel.createIndexes(), LessonProgressModel.createIndexes(), MediaAssetModel.createIndexes(), MediaUploadIntentModel.createIndexes()]);
  assert.equal(await isDatabaseReady(), true);
});

afterEach(async () => {
  if (userIds.length) {
    await Promise.all([
      AuthSessionModel.deleteMany({ userId: { $in: userIds } }),
      PlatformGrantModel.deleteMany({ userId: { $in: userIds } }),
      OrganizationMembershipModel.deleteMany({ userId: { $in: userIds } }),
      OrganizationModel.deleteMany({ createdBy: { $in: userIds } }),
      OrganizationInvitationModel.deleteMany({ invitedBy: { $in: userIds } }),
      AuditEventModel.deleteMany({ actorId: { $in: userIds } }),
      UserCredentialModel.deleteMany({ userId: { $in: userIds } }),
      UserModel.deleteMany({ _id: { $in: userIds } }),
    ]);
  }
  userIds.length = 0;
  credentialIds.length = 0;
  runId = randomUUID();
});

after(async () => { await mongoose.disconnect(); });

test("concurrent rotation of one session produces one replacement", async () => {
  const { user } = await createUser("rotation");
  const session = await createSession(user._id, 600, 3600, config.mfaEncryptionKey);
  const outcomes = await Promise.all([
    rotateSession(session.token, user._id, 600, config.mfaEncryptionKey),
    rotateSession(session.token, user._id, 600, config.mfaEncryptionKey),
  ]);
  assert.equal(outcomes.filter(Boolean).length, 1);
  const replacement = outcomes.find((item) => item !== undefined)!;
  assert.ok(await AuthSessionModel.exists({ tokenHash: sha256(replacement.token), revokedAt: null }));
  assert.equal(await AuthSessionModel.exists({ tokenHash: sha256(session.token), revokedAt: null }), null);
});

test("rotation transaction rolls old-session revocation back if replacement creation fails", async () => {
  const { user } = await createUser("rotation-rollback");
  const session = await createSession(user._id, 600, 3600, config.mfaEncryptionKey);
  const originalCreate = AuthSessionModel.create;
  AuthSessionModel.create = (() => { throw new Error("injected replacement failure"); }) as typeof AuthSessionModel.create;
  try {
    await assert.rejects(rotateSession(session.token, user._id, 600, config.mfaEncryptionKey), /injected replacement failure/);
  } finally { AuthSessionModel.create = originalCreate; }
  assert.ok(await AuthSessionModel.exists({ tokenHash: sha256(session.token), revokedAt: null }));
});

test("registration transaction rolls user creation back if credential creation fails", async () => {
  const email = `registration-rollback-${runId}@example.test`;
  const originalCreate = UserCredentialModel.create;
  UserCredentialModel.create = (() => { throw new Error("injected credential failure"); }) as typeof UserCredentialModel.create;
  try {
    await assert.rejects(register({ email, displayName: "Rollback", password: "long-enough-test-password" }), /injected credential failure/);
  } finally { UserCredentialModel.create = originalCreate; }
  assert.equal(await UserModel.exists({ emailNormalized: email }), null);
});

test("MFA enrollment transaction rolls back credential and session changes together", async () => {
  const { user } = await createUser("mfa-rollback");
  const session = await createSession(user._id, 600, 3600, config.mfaEncryptionKey);
  const setup = await beginTotpSetup(user._id.toString(), (await AuthSessionModel.findOne({ tokenHash: sha256(session.token) }))!._id.toString(), config.mfaEncryptionKey);
  const sessionRecord = await AuthSessionModel.findOne({ tokenHash: sha256(session.token) });
  assert.ok(sessionRecord);
  const originalUpdateMany = AuthSessionModel.updateMany;
  AuthSessionModel.updateMany = (() => { throw new Error("injected session revocation failure"); }) as typeof AuthSessionModel.updateMany;
  try {
    await assert.rejects(confirmTotpSetup(user._id.toString(), sessionRecord._id.toString(), createTotp(setup.secret), config.mfaEncryptionKey), /injected session revocation failure/);
  } finally { AuthSessionModel.updateMany = originalUpdateMany; }
  const stored = await UserCredentialModel.findOne({ userId: user._id }).select("+pendingTotpSecretEncrypted");
  assert.equal(stored?.mfaEnabled, false);
  assert.ok(stored?.pendingTotpSecretEncrypted);
  assert.equal((await AuthSessionModel.findOne({ tokenHash: sha256(session.token) }))?.revokedAt, undefined);
});

test("grant revocation immediately blocks a previously authenticated session", async () => {
  const { user } = await createUser("grant-revoke", { mfaEnabled: true, totpSecretEncrypted: encryptTotpSecret("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", config.mfaEncryptionKey) });
  const session = await createSession(user._id, 600, 3600, config.mfaEncryptionKey, true);
  const grant = await PlatformGrantModel.create({ userId: user._id, roleKey: "PLATFORM_ADMIN", permissions: ["platform.audit.read"], startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000) });
  const [authenticate, authorize] = requirePlatformAdmin(config, { permission: "platform.audit.read" });
  const request = { headers: { cookie: `${sessionCookieName(config)}=${session.token}` } };
  const allowed = await runMiddleware([authenticate, authorize], request);
  assert.equal(allowed.passed, true);
  await PlatformGrantModel.updateOne({ _id: grant._id }, { $set: { revokedAt: new Date() } });
  const denied = await runMiddleware([authenticate, authorize], request);
  assert.equal(denied.passed, false);
  assert.equal(denied.statusCode, 403);
});

test("active grant lookup accepts absent and null revokedAt but denies revoked grants", async () => {
  const { user } = await createUser("grant-null");
  const base = { userId: user._id, roleKey: "PLATFORM_ADMIN", permissions: [], startsAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60_000) };
  const missing = await PlatformGrantModel.create(base);
  assert.ok(await PlatformGrantModel.exists({ _id: missing._id, revokedAt: null }));
  const explicitlyNull = await PlatformGrantModel.create({ ...base, revokedAt: null });
  assert.ok(await PlatformGrantModel.exists({ _id: explicitlyNull._id, revokedAt: null }));
  await PlatformGrantModel.updateOne({ _id: missing._id }, { $set: { revokedAt: new Date() } });
  assert.equal(await PlatformGrantModel.exists({ _id: missing._id, revokedAt: null }), null);
});

test("concurrent recovery-code consumption has exactly one winner", async () => {
  const codes = createRecoveryCodes();
  const { user } = await createUser("recovery-race", { mfaEnabled: true, recoveryCodeHashes: [sha256(codes[0]!)] });
  const results = await Promise.all([consumeRecoveryCode(user._id.toString(), codes[0]!), consumeRecoveryCode(user._id.toString(), codes[0]!)]);
  assert.deepEqual(results.sort(), [false, true]);
});

test("concurrent TOTP replay has exactly one login winner", async () => {
  const secret = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const password = "long-enough-integration-password";
  const { user, credential } = await createUser("totp-race", { mfaEnabled: true, totpSecretEncrypted: encryptTotpSecret(secret, config.mfaEncryptionKey) });
  const { hashPassword } = await import("../../src/services/password.service.js");
  credential.passwordHash = await hashPassword(password);
  await credential.save();
  const code = createTotp(secret);
  const results = await Promise.allSettled([
    login({ email: user.emailNormalized, password, totpCode: code }, config),
    login({ email: user.emailNormalized, password, totpCode: code }, config),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await UserCredentialModel.findOne({ userId: user._id }).select("+lastTotpStep"))?.lastTotpStep !== undefined, true);
});

test("required unique and TTL indexes exist, and replica-set readiness succeeds", async () => {
  const collectionNames = [...new Set(REQUIRED_INDEXES.map((spec) => spec.collection))];
  const indexes = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [name, await mongoose.connection.db!.collection(name).listIndexes().toArray()])));
  assert.equal(hasRequiredIndexes(REQUIRED_INDEXES, indexes), true);
  assert.equal(await isDatabaseReady(), true);
});
