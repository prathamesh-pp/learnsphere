import { Schema, model } from "mongoose";

export const ORGANIZATION_KINDS = ["institution", "company", "program"] as const;
export type OrganizationKind = typeof ORGANIZATION_KINDS[number];
const organizationSchema = new Schema({
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 80 },
  name: { type: String, required: true, trim: true, minlength: 1, maxlength: 120 },
  kind: { type: String, enum: ORGANIZATION_KINDS, required: true },
  status: { type: String, enum: ["active", "suspended", "archived"], default: "active", required: true },
  settings: { type: Schema.Types.Mixed, default: {} },
  authorizationVersion: { type: Number, default: 0, select: false },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
}, { timestamps: true, versionKey: false });
organizationSchema.index({ slug:  1 }, { unique: true });
organizationSchema.index({ status: 1, kind: 1 });
export const OrganizationModel = model("Organization", organizationSchema);
