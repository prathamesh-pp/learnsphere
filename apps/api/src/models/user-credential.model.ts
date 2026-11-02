import { Schema, model, Types } from "mongoose";

export interface UserCredentialRecord {
  userId: Types.ObjectId;
  passwordHash: string;
  passwordChangedAt: Date;
  mfaEnabled: boolean;
  totpSecretEncrypted?: string;
  pendingTotpSecretEncrypted?: string;
  pendingTotpSessionId?: Types.ObjectId;
  pendingTotpExpiresAt?: Date;
  recoveryCodeHashes: string[];
  lastTotpStep?: number;
}

const credentialSchema = new Schema<UserCredentialRecord>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, immutable: true },
  passwordHash: { type: String, required: true, select: false },
  passwordChangedAt: { type: Date, required: true },
  mfaEnabled: { type: Boolean, default: false, required: true },
  totpSecretEncrypted: { type: String, select: false },
  pendingTotpSecretEncrypted: { type: String, select: false },
  pendingTotpSessionId: { type: Schema.Types.ObjectId, ref: "AuthSession", select: false },
  pendingTotpExpiresAt: { type: Date, select: false },
  recoveryCodeHashes: { type: [String], default: [], select: false },
  lastTotpStep: { type: Number, select: false },
}, { timestamps: true, versionKey: false });

export const UserCredentialModel = model<UserCredentialRecord>("UserCredential", credentialSchema);
