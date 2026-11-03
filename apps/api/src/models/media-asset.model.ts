import { Schema, model } from "mongoose";

const mediaAssetSchema = new Schema({
  provider: { type: String, enum: ["cloudinary"], required: true, immutable: true },
  providerAssetId: { type: String, required: true, immutable: true },
  publicId: { type: String, required: true, immutable: true },
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  lessonId: { type: Schema.Types.ObjectId, ref: "Lesson", required: true, immutable: true },
  uploaderId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  intentId: { type: Schema.Types.ObjectId, ref: "MediaUploadIntent", required: true, immutable: true },
  purpose: { type: String, enum: ["video", "document", "resource"], required: true, immutable: true },
  resourceType: { type: String, enum: ["video", "raw"], required: true, immutable: true },
  deliveryType: { type: String, enum: ["authenticated"], required: true, immutable: true },
  format: { type: String, required: true, immutable: true },
  mimeType: { type: String, required: true, immutable: true },
  sizeBytes: { type: Number, required: true, min: 1, immutable: true },
  durationSeconds: { type: Number, min: 0, immutable: true },
  width: { type: Number, min: 0, immutable: true },
  height: { type: Number, min: 0, immutable: true },
  version: { type: Number, required: true, immutable: true },
  state: { type: String, enum: ["ready", "deletion_requested", "deleted"], required: true, default: "ready" },
  verifiedAt: { type: Date, required: true, immutable: true },
  deletionRequestedAt: { type: Date },
  deletedAt: { type: Date },
}, { timestamps: true, versionKey: false });
mediaAssetSchema.index({ providerAssetId: 1 }, { unique: true });
mediaAssetSchema.index({ publicId: 1 }, { unique: true });
mediaAssetSchema.index({ intentId: 1 }, { unique: true });
mediaAssetSchema.index({ tenantId: 1, courseId: 1, lessonId: 1, state: 1 });
export const MediaAssetModel = model("MediaAsset", mediaAssetSchema, "mediaassets");

const mediaUploadIntentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  lessonId: { type: Schema.Types.ObjectId, ref: "Lesson", required: true, immutable: true },
  uploaderId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  purpose: { type: String, enum: ["video", "document", "resource"], required: true, immutable: true },
  resourceType: { type: String, enum: ["video", "raw"], required: true, immutable: true },
  deliveryType: { type: String, enum: ["authenticated"], required: true, immutable: true },
  fileName: { type: String, required: true, immutable: true },
  expectedMimeType: { type: String, required: true, immutable: true },
  expectedExtension: { type: String, required: true, immutable: true },
  expectedSizeBytes: { type: Number, required: true, min: 1, immutable: true },
  maxSizeBytes: { type: Number, required: true, min: 1, immutable: true },
  publicId: { type: String, required: true, immutable: true },
  state: { type: String, enum: ["pending", "finalized", "failed", "rejected", "expired"], required: true, default: "pending" },
  expiresAt: { type: Date, required: true, immutable: true },
  finalizedAt: { type: Date },
  providerAssetId: { type: String },
}, { timestamps: true, versionKey: false });
mediaUploadIntentSchema.index({ publicId: 1 }, { unique: true });
mediaUploadIntentSchema.index({ uploaderId: 1, state: 1, expiresAt: 1 });
mediaUploadIntentSchema.index({ expiresAt: 1 });
export const MediaUploadIntentModel = model("MediaUploadIntent", mediaUploadIntentSchema, "mediauploadintents");
