import { Schema, model } from "mongoose";
const auditSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization" },
  actorId: { type: Schema.Types.ObjectId, ref: "User" },
  action: { type: String, required: true, maxlength: 100, immutable: true },
  resourceType: { type: String, required: true, maxlength: 80, immutable: true },
  resourceId: { type: String, maxlength: 100, immutable: true },
  requestId: { type: String, required: true, maxlength: 100 },
  occurredAt: { type: Date, required: true, default: Date.now, immutable: true },
  metadata: { type: Schema.Types.Mixed, default: {}, immutable: true },
}, { versionKey: false, strict: "throw" });
auditSchema.index({ tenantId: 1, occurredAt: -1 });
auditSchema.index({ actorId: 1, occurredAt: -1 });
auditSchema.index({ resourceType: 1, resourceId: 1, occurredAt: -1 });
export const AuditEventModel = model("AuditEvent", auditSchema);
