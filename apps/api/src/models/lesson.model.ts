import { Schema, model } from "mongoose";
import { contentMatchesType, isStorageBackedContent, lessonContentSchema } from "../validators/lesson-content.validators.js";
const lessonSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  sectionId: { type: Schema.Types.ObjectId, default: null },
  title: { type: String, required: true, trim: true, minlength: 1, maxlength: 160 },
  description: { type: String, trim: true, maxlength: 1000, default: "" },
  contentType: { type: String, enum: ["text", "video", "document", "resource", "external_link", "external_video", "resources"], required: true },
  contentData: { type: Schema.Types.Mixed },
  content: { type: String, maxlength: 100000 },
  externalUrl: { type: String, maxlength: 2048 },
  resourceLinks: { type: [{ title: { type: String, required: true, trim: true, maxlength: 120 }, url: { type: String, required: true, maxlength: 2048 } }], default: [] },
  estimatedDurationMinutes: { type: Number, min: 0, max: 10000, required: true, default: 0 },
  position: { type: Number, min: 0, max: 399, required: true },
  status: { type: String, enum: ["draft", "published"], default: "draft", required: true },
}, { timestamps: true, versionKey: false });
lessonSchema.pre("validate", function () {
  const parsedContent = this.contentData === undefined ? undefined : lessonContentSchema.safeParse(this.contentData);
  if (parsedContent && !parsedContent.success) this.invalidate("contentData", "Lesson content is invalid.");
  if (parsedContent?.success && !contentMatchesType(this.contentType, parsedContent.data)) this.invalidate("contentType", "Lesson content does not match its content type.");
  if (this.contentType === "text" && !this.contentData && !this.content?.trim()) this.invalidate("content", "Text lessons require content.");
  if (this.status === "published" && this.contentType === "video" && !this.contentData) this.invalidate("contentData", "Published video lessons require verified media.");
  if (this.status === "published" && this.contentType === "document" && !this.contentData) this.invalidate("contentData", "Published document lessons require verified media.");
  if (this.status === "published" && this.contentType === "resource" && !this.contentData) this.invalidate("contentData", "Published resource lessons require verified media.");
  if (this.contentType === "external_link" && !this.contentData) this.invalidate("contentData", "External links require validated link metadata.");
  if (this.contentType === "external_video" && !this.contentData && !this.externalUrl) this.invalidate("externalUrl", "External video lessons require a URL.");
  if (this.contentType === "resources" && !this.contentData && (!this.resourceLinks || this.resourceLinks.length === 0)) this.invalidate("resourceLinks", "Resource lessons require at least one link.");
  if (parsedContent?.success && isStorageBackedContent(parsedContent.data) && !this.$locals.verifiedMediaAttachment) this.invalidate("contentData", "Storage-backed lesson content must be created through a verified private asset.");
  if (this.resourceLinks.length > 10) this.invalidate("resourceLinks", "Too many resource links.");
});
lessonSchema.index({ courseId: 1, position: 1 }, { unique: true });
lessonSchema.index({ tenantId: 1, courseId: 1, status: 1, position: 1 });
export const LessonModel = model("Lesson", lessonSchema, "lessons");
