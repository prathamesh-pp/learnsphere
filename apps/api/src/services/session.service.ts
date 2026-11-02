import { createHash, createHmac, randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { AuthSessionModel } from "../models/auth-session.model.js";
import type { Types } from "mongoose";

export const SESSION_COOKIE = "learnsphere_session";
export const PRODUCTION_SESSION_COOKIE = "__Host-learnsphere_session";
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
export const createOpaqueToken = (): string => randomBytes(32).toString("base64url");
export const deriveCsrfToken = (sessionToken: string, key: Buffer): string => createHmac("sha256", key).update("learnsphere/csrf/v1\0").update(sessionToken).digest("base64url");

export async function createSession(userId: Types.ObjectId, idleSeconds: number, absoluteSeconds: number, csrfKey: Buffer, mfaVerified = false) {
  const now = new Date();
  const token = createOpaqueToken();
  const csrfToken = deriveCsrfToken(token, csrfKey);
  const absoluteExpiresAt = new Date(now.getTime() + absoluteSeconds * 1000);
  const expiresAt = new Date(Math.min(now.getTime() + idleSeconds * 1000, absoluteExpiresAt.getTime()));
  await AuthSessionModel.create({ userId, tokenHash: sha256(token), csrfTokenHash: sha256(csrfToken), lastSeenAt: now, expiresAt, absoluteExpiresAt, ...(mfaVerified ? { mfaVerifiedAt: now } : {}) });
  return { token, csrfToken, expiresAt };
}

export async function rotateSession(oldToken: string, userId: Types.ObjectId, idleSeconds: number, csrfKey: Buffer) {
  const oldHash = sha256(oldToken);
  return mongoose.connection.transaction(async (transaction) => {
    const old = await AuthSessionModel.findOneAndUpdate(
      { tokenHash: oldHash, userId, revokedAt: null, $expr: { $and: [{ $gt: ["$expiresAt", "$$NOW"] }, { $gt: ["$absoluteExpiresAt", "$$NOW"] }] } },
      [{ $set: { revokedAt: "$$NOW" } }], { new: false, session: transaction },
    );
    if (!old) return undefined;
    const now = new Date();
    const token = createOpaqueToken();
    const csrfToken = deriveCsrfToken(token, csrfKey);
    const absoluteExpiresAt = old.absoluteExpiresAt;
    const expiresAt = new Date(Math.min(now.getTime() + idleSeconds * 1000, absoluteExpiresAt.getTime()));
    await AuthSessionModel.create([{ userId, tokenHash: sha256(token), csrfTokenHash: sha256(csrfToken), lastSeenAt: now, expiresAt, absoluteExpiresAt, ...(old.mfaVerifiedAt ? { mfaVerifiedAt: old.mfaVerifiedAt } : {}) }], { session: transaction });
    return { token, csrfToken, expiresAt };
  });
}

export async function revokeSession(token: string): Promise<void> {
  await AuthSessionModel.updateOne({ tokenHash: sha256(token), revokedAt: null }, { $set: { revokedAt: new Date() } });
}
