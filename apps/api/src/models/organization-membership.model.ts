import { Schema, model } from "mongoose";
export const ORGANIZATION_ROLES = ["STUDENT", "INSTRUCTOR", "RECRUITER", "COMPANY_ADMIN", "MENTOR", "ORGANIZATION_ADMIN"] as const;
export type OrganizationRole = typeof ORGANIZATION_ROLES[number];
const membershipSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["active", "suspended", "left"], required: true, default: "active" },
  roles: { type: [{ type: String, enum: ORGANIZATION_ROLES }], required: true, default: ["STUDENT"] },
  joinedAt: { type: Date, required: true, default: Date.now },
  invitedBy: { type: Schema.Types.ObjectId, ref: "User" },
  authorizationVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });
membershipSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ userId: 1, status: 1 });
membershipSchema.index({ tenantId: 1, status: 1 });
export const OrganizationMembershipModel = model("OrganizationMembership", membershipSchema);
