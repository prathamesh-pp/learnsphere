import { randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { AuthSessionModel } from "../models/auth-session.model.js";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { findActivePlatformGrant } from "./platform-authorization.service.js";
import { UserModel } from "../models/user.model.js";
import type { AppConfig } from "../config/env.js";
import { consumeRecoveryCode, createRecoveryCodes, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, validTotpStep } from "./mfa.service.js";
import { hashPassword, verifyPassword } from "./password.service.js";
import { createSession, sha256 } from "./session.service.js";

const DUMMY_HASH = hashPassword(randomBytes(32).toString("hex"));
export class InvalidCredentialsError extends Error {}

export async function register(input: { email: string; displayName: string; password: string }): Promise<void> {
  const emailNormalized = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);
  try {
    await mongoose.connection.transaction(async (transaction) => {
      const [user] = await UserModel.create([{ emailNormalized, displayName: input.displayName.trim(), status: "active" }], { session: transaction });
      if (!user) throw new Error("Registration transaction did not create a user.");
      await UserCredentialModel.create([{ userId: user._id, passwordHash, passwordChangedAt: new Date(), mfaEnabled: false, recoveryCodeHashes: [] }], { session: transaction });
    });
  } catch (error) {
    if (isDuplicateKey(error)) return;
    throw error;
  }
}

export async function login(input: { email: string; password: string; totpCode?: string; recoveryCode?: string }, config: AppConfig) {
  const emailNormalized = input.email.trim().toLowerCase();
  const user = await UserModel.findOne({ emailNormalized }).select("_id emailNormalized displayName status").lean();
  const credential = user ? await UserCredentialModel.findOne({ userId: user._id }).select("+passwordHash +totpSecretEncrypted +recoveryCodeHashes mfaEnabled").lean() : null;
  const hash = credential?.passwordHash ?? await DUMMY_HASH;
  const passwordIsValid = await verifyPassword(hash, input.password);
  if (!user || user.status !== "active" || !credential || !passwordIsValid) throw new InvalidCredentialsError();

  const requiresMfa = Boolean(await findActivePlatformGrant(user._id.toString(), new Date()));
  if (requiresMfa && !credential.mfaEnabled) throw new InvalidCredentialsError();
  let mfaVerified = false;
  if (credential.mfaEnabled) {
    if (input.totpCode && credential.totpSecretEncrypted) {
      const secret = decryptTotpSecret(credential.totpSecretEncrypted, config.mfaEncryptionKey);
      const step = validTotpStep(secret, input.totpCode);
      if (step !== undefined) {
        const consumed = await UserCredentialModel.updateOne({ userId: user._id, mfaEnabled: true, $or: [{ lastTotpStep: { $exists: false } }, { lastTotpStep: { $lt: step } }] }, { $set: { lastTotpStep: step } });
        mfaVerified = consumed.modifiedCount === 1;
      }
    } else if (input.recoveryCode) {
      mfaVerified = await consumeRecoveryCode(user._id.toString(), input.recoveryCode);
    }
    if (!mfaVerified) throw new InvalidCredentialsError();
  }
  const session = await createSession(user._id, config.sessionIdleTimeoutSeconds, config.sessionAbsoluteTimeoutSeconds, config.mfaEncryptionKey, mfaVerified);
  return { user: { id: user._id.toString(), email: user.emailNormalized, displayName: user.displayName }, session };
}

export async function beginTotpSetup(userId: string, sessionId: string, key: Buffer, mfaVerifiedRecently = false): Promise<{ secret: string; otpauthUri: string }> {
  const current = await UserCredentialModel.findOne({ userId: new Types.ObjectId(userId) }).select("mfaEnabled").lean();
  if (!current || (current.mfaEnabled && !mfaVerifiedRecently)) throw new InvalidCredentialsError();
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret, key);
  const result = await UserCredentialModel.updateOne({ userId: new Types.ObjectId(userId), mfaEnabled: current.mfaEnabled }, { $set: {
    pendingTotpSecretEncrypted: encrypted,
    pendingTotpSessionId: new Types.ObjectId(sessionId),
    pendingTotpExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
  } });
  if (result.matchedCount !== 1) throw new InvalidCredentialsError();
  const user = await UserModel.findById(userId).select("emailNormalized").lean();
  return { secret, otpauthUri: `otpauth://totp/LearnSphere:${encodeURIComponent(user?.emailNormalized ?? "account")}?secret=${secret}&issuer=LearnSphere&algorithm=SHA1&digits=6&period=30` };
}

export async function confirmTotpSetup(userId: string, sessionId: string, code: string, key: Buffer): Promise<string[]> {
  const setupQuery = { userId: new Types.ObjectId(userId), pendingTotpSessionId: new Types.ObjectId(sessionId), pendingTotpExpiresAt: { $gt: new Date() } };
  const credential = await UserCredentialModel.findOne(setupQuery).select("+pendingTotpSecretEncrypted +pendingTotpSessionId +pendingTotpExpiresAt");
  if (!credential?.pendingTotpSecretEncrypted) throw new InvalidCredentialsError();
  const secret = decryptTotpSecret(credential.pendingTotpSecretEncrypted, key);
  const step = validTotpStep(secret, code);
  if (step === undefined) throw new InvalidCredentialsError();
  const codes = createRecoveryCodes();
  await mongoose.connection.transaction(async (transaction) => {
    const result = await UserCredentialModel.updateOne({ _id: credential._id, mfaEnabled: credential.mfaEnabled, pendingTotpSecretEncrypted: credential.pendingTotpSecretEncrypted, pendingTotpSessionId: new Types.ObjectId(sessionId), pendingTotpExpiresAt: { $gt: new Date() } }, {
      $set: { totpSecretEncrypted: encryptTotpSecret(secret, key), mfaEnabled: true, recoveryCodeHashes: codes.map((value) => sha256(value)), lastTotpStep: step },
      $unset: { pendingTotpSecretEncrypted: 1, pendingTotpSessionId: 1, pendingTotpExpiresAt: 1 },
    }, { session: transaction });
    if (result.modifiedCount !== 1) throw new InvalidCredentialsError();
    await AuthSessionModel.updateMany({ userId: new Types.ObjectId(userId), revokedAt: null }, { $set: { revokedAt: new Date() } }, { session: transaction });
  });
  return codes;
}

export async function getCurrentUser(userId: string) {
  const user = await UserModel.findOne({ _id: new Types.ObjectId(userId), status: "active" }).select("emailNormalized displayName emailVerifiedAt createdAt").lean();
  if (!user) return undefined;
  return { id: user._id.toString(), email: user.emailNormalized, displayName: user.displayName, emailVerifiedAt: user.emailVerifiedAt ?? null, createdAt: user.createdAt };
}

function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
