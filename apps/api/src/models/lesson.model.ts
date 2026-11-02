import { Schema, model } from "mongoose";
const lessonSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  description: { type: String, required: true, trim: true, maxlength: 1000, default: "" },
  contentType: { type: String, enum: ["text", "external_video", "resources"], required: true },
  content: { type: String, maxlength: 100000 },
  externalUrl: { type: String, maxlength: 2048 },
  resourceLinks: { type: [{ title: { type: String, required: true, trim: true, maxlength: 120 }, url: { type: String, required: true, maxlength: 2048 } }], default: [] },
  estimatedDurationMinutes: { type: Number, min: 0, max: 10000, required: true, default: 0 },
  position: { type: Number, min: 0, max: 399, required: true },
  status: { type: String, enum: ["draft", "published"], default: "draft", required: true },
}, { timestamps: true, versionKey: false });
lessonSchema.pre("validate", function () {
  if (this.contentType === "text" && !this.content?.trim()) this.invalidate("content", "Text lessons require content.");
  if (this.contentType === "external_video" && !this.externalUrl) this.invalidate("externalUrl", "External video lessons require a URL.");
  if (this.contentType === "resources" && (!this.resourceLinks || this.resourceLinks.length === 0)) this.invalidate("resourceLinks", "Resource lessons require at least one link.");
  if (this.resourceLinks.length > 10) this.invalidate("resourceLinks", "Too many resource links.");
});
lessonSchema.index({ courseId: 1, position: 1 }, { unique: true });
lessonSchema.index({ tenantId: 1, courseId: 1, status: 1, position: 1 });
export const LessonModel = model("Lesson", lessonSchema, "lessons");
