import { Schema, model } from "mongoose";

/** Read-only to identity flows. Grant management requires a separate audited platform-operations boundary. */
const platformGrantSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  roleKey: { type: String, enum: ["PLATFORM_ADMIN"], required: true },
  permissions: { type: [String], required: true },
  startsAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date },
}, { timestamps: true, versionKey: false });

// Supports the per-request active-grant lookup; revokedAt:null matches both null and absent fields.
platformGrantSchema.index({ userId: 1, roleKey: 1, revokedAt: 1, startsAt: 1, expiresAt: 1 });
export const PlatformGrantModel = model("PlatformGrant", platformGrantSchema);
