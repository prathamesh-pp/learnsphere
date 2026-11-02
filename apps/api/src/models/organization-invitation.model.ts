import { Schema, model } from "mongoose";
import { ORGANIZATION_ROLES } from "./organization-membership.model.js";
const invitationSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  emailNormalized: { type: String, required: true, lowercase: true, trim: true, immutable: true },
  tokenHash: { type: String, required: true, unique: true, select: false, immutable: true },
  roles: { type: [{ type: String, enum: ORGANIZATION_ROLES }], required: true },
  invitedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["pending", "accepted", "revoked", "expired"], required: true, default: "pending" },
  expiresAt: { type: Date, required: true },
  acceptedAt: { type: Date },
}, { timestamps: true, versionKey: false });
invitationSchema.index({ tenantId: 1, emailNormalized: 1, status: 1 });
export const OrganizationInvitationModel = model("OrganizationInvitation", invitationSchema);
