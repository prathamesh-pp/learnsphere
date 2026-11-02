import { Schema, model } from "mongoose";

export type AccountStatus = "active" | "suspended" | "deleted";
export interface UserRecord {
  emailNormalized: string;
  displayName: string;
  status: AccountStatus;
  emailVerifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserRecord>({
  emailNormalized: { type: String, required: true, unique: true, immutable: true, trim: true, lowercase: true },
  displayName: { type: String, required: true, trim: true, maxlength: 100 },
  status: { type: String, enum: ["active", "suspended", "deleted"], required: true, default: "active", index: true },
  emailVerifiedAt: { type: Date },
}, { timestamps: true, versionKey: false });

export const UserModel = model<UserRecord>("User", userSchema);
