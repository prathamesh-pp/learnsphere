import { Schema, model } from "mongoose";
const enrollmentSchema = new Schema({
  tenantId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, immutable: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true, immutable: true },
  studentId: { type: Schema.Types.ObjectId, ref: "User", required: true, immutable: true },
  status: { type: String, enum: ["active", "completed"], required: true, default: "active" },
  startedAt: { type: Date, required: true, default: Date.now },
  completedAt: { type: Date },
  progress: { completedLessons: { type: Number, min: 0, required: true, default: 0 }, totalLessons: { type: Number, min: 0, required: true, default: 0 }, percent: { type: Number, min: 0, max: 100, required: true, default: 0 } },
  progressVersion: { type: Number, default: 0, select: false },
}, { timestamps: true, versionKey: false });
enrollmentSchema.index({ tenantId: 1, courseId: 1, studentId: 1 }, { unique: true });
enrollmentSchema.index({ studentId: 1, status: 1, updatedAt: -1, _id: -1 });
enrollmentSchema.index({ tenantId: 1, courseId: 1, status: 1 });
export const EnrollmentModel = model("Enrollment", enrollmentSchema, "enrollments");
