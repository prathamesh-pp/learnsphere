import { Schema, model } from "mongoose";

export const COURSE_DIFFICULTIES = ["beginner", "intermediate", "advanced"] as const;
export const COURSE_STATUSES = ["draft", "published", "archived"] as const;
const sectionSchema = new Schema({
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  position: { type: Number, min: 0, max: 99, required: true },
  status: { type: String, enum: ["draft", "published"], default: "draft", required: true },
}, { timestamps: true });
const courseSchema = new Schema({
  ownerScope: { type: String, enum: ["organization", "platform"], required: true, immutable: true },
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: function (this: { ownerScope: string }) { return this.ownerScope === "organization"; }, immutable: true },
  ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  slug: { type: String, required: true, trim: true, lowercase: true, match: /^[a-z0-9]+(?:-[a-z0-9]+)*$/, maxlength: 120 },
  shortDescription: { type: String, required: true, trim: true, maxlength: 280 },
  description: { type: String, required: true, trim: true, maxlength: 20000 },
  learningObjectives: { type: [String], required: true, default: [] },
  prerequisites: { type: [String], required: true, default: [] },
  category: { type: String, required: true, trim: true, maxlength: 80 },
  difficulty: { type: String, enum: COURSE_DIFFICULTIES, required: true },
  language: { type: String, required: true, trim: true, lowercase: true, maxlength: 16, default: "en" },
  thumbnailReference: { type: String, trim: true, maxlength: 2048 },
  status: { type: String, enum: COURSE_STATUSES, required: true, default: "draft" },
  publishedAt: { type: Date },
  estimatedDurationMinutes: { type: Number, min: 0, max: 100000, required: true, default: 0 },
  sections: { type: [sectionSchema], default: [] },
  tags: { type: [String], required: true, default: [] },
  mutationVersion: { type: Number, default: 0, select: false },
  enrollmentVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });
courseSchema.pre("validate", function () {
  if (this.ownerScope === "platform" && this.tenantId) this.invalidate("tenantId", "Platform courses cannot have a tenant owner.");
  if (this.ownerScope === "organization" && !this.tenantId) this.invalidate("tenantId", "Organization courses require a tenant.");
  if (this.learningObjectives.length > 20 || this.prerequisites.length > 20 || this.tags.length > 20) this.invalidate("tags", "Course lists exceed their limit.");
  for (const item of [...this.learningObjectives, ...this.prerequisites, ...this.tags]) if (typeof item !== "string" || item.length > 240) this.invalidate("learningObjectives", "Course list items are too long.");
});
courseSchema.index({ tenantId: 1, slug: 1 }, { unique: true, partialFilterExpression: { ownerScope: "organization" } });
courseSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { ownerScope: "platform" } });
courseSchema.index({ tenantId: 1, status: 1, createdAt: -1, _id: -1 });
courseSchema.index({ tenantId: 1, ownerId: 1, updatedAt: -1, _id: -1 });
export const CourseModel = model("Course", courseSchema, "courses");
