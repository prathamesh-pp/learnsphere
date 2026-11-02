import { Schema, model, Types } from "mongoose";

export interface AuthSessionRecord {
  userId: Types.ObjectId;
  tokenHash: string;
  csrfTokenHash: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt?: Date;
  mfaVerifiedAt?: Date;
}

const sessionSchema = new Schema<AuthSessionRecord>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  csrfTokenHash: { type: String, required: true, select: false },
  lastSeenAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  absoluteExpiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
  mfaVerifiedAt: { type: Date },
}, { timestamps: { createdAt: true, updatedAt: false }, versionKey: false });

sessionSchema.index({ userId: 1, expiresAt: 1 });
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const AuthSessionModel = model<AuthSessionRecord>("AuthSession", sessionSchema);
