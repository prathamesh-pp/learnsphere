import { Schema, model } from "mongoose";
const progressSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  enrollmentId: { type: Schema.Types.ObjectId, ref: "Enrollment", required: true, immutable: true },
  lessonId: { type: Schema.Types.ObjectId, ref: "Lesson", required: true, immutable: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  isComplete: { type: Boolean, required: true, default: false },
  completedAt: { type: Date },
  lastAccessedAt: { type: Date, required: true, default: Date.now },
  videoProgress: {
    watchedSeconds: { type: Number, min: 0, required: true, default: 0 },
    lastPositionSeconds: { type: Number, min: 0, required: true, default: 0 },
    lastHeartbeatAt: { type: Date },
  },
}, { timestamps: true, versionKey: false });
progressSchema.index({ enrollmentId: 1, lessonId: 1 }, { unique: true });
progressSchema.index({ tenantId: 1, courseId: 1, studentId: 1 });
export const LessonProgressModel = model("LessonProgress", progressSchema, "lessonprogresses");
