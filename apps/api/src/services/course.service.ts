import mongoose, { Types } from "mongoose";
import { AuditEventModel } from "../models/audit-event.model.js";
import { CourseModel } from "../models/course.model.js";
import { EnrollmentModel } from "../models/enrollment.model.js";
import { LessonModel } from "../models/lesson.model.js";
import { LessonProgressModel } from "../models/lesson-progress.model.js";
import { MediaAssetModel } from "../models/media-asset.model.js";
import { OrganizationMembershipModel } from "../models/organization-membership.model.js";
import { OrganizationModel } from "../models/organization.model.js";
import { UserModel } from "../models/user.model.js";
import { rolesAllow } from "./organization.service.js";
import { getPrivateAssetStorage } from "./private-asset-storage.service.js";

export class CourseError extends Error { constructor(readonly status: 400 | 403 | 404 | 409 | 422, readonly code: string) { super(code); } }
const isDuplicate = (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === 11000;
function id(value: string) { if (!/^[a-f\d]{24}$/i.test(value)) throw new CourseError(404, "NOT_FOUND"); return new Types.ObjectId(value); }
function audit(tenantId: Types.ObjectId, actorId: Types.ObjectId, action: string, type: string, resourceId: string, requestId: string, metadata: Record<string, unknown> = {}) {
  return { tenantId, actorId, action, resourceType: type, resourceId, requestId, occurredAt: new Date(), metadata };
}
function courseDto(course: { toObject?: () => unknown; _id: Types.ObjectId }) {
  const value = (typeof course.toObject === "function" ? course.toObject() : course) as Record<string, unknown>;
  delete value.mutationVersion; delete value.enrollmentVersion;
  if (Array.isArray(value.sections)) {
    const sections = value.sections as Record<string, unknown>[];
    value.sections = sections.slice().sort((a, b) => Number(a.position) - Number(b.position)).map((item) => ({ ...item, id: String(item._id), _id: undefined }));
  }
  return { ...value, id: String(value._id), _id: undefined };
}
function lessonMetadata(lesson: Record<string, unknown>) {
  return { id: String(lesson._id), sectionId: lesson.sectionId ? String(lesson.sectionId) : null, title: lesson.title, description: lesson.description, contentType: lesson.contentType, estimatedDurationMinutes: lesson.estimatedDurationMinutes, position: lesson.position };
}
function escapeRegex(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function cursorEncode(createdAt: Date, objectId: Types.ObjectId) { return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id: objectId.toString() })).toString("base64url"); }
function cursorDecode(value?: string) {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    if (typeof parsed.createdAt !== "string" || !Number.isFinite(Date.parse(parsed.createdAt)) || typeof parsed.id !== "string" || !/^[a-f\d]{24}$/i.test(parsed.id)) throw new Error();
    return { createdAt: new Date(parsed.createdAt), id: new Types.ObjectId(parsed.id) };
  } catch { throw new CourseError(400, "INVALID_CURSOR"); }
}
async function lockMembership(session: mongoose.ClientSession, userId: Types.ObjectId, tenantId: Types.ObjectId, permission: string) {
  const member = await OrganizationMembershipModel.findOneAndUpdate({ userId, tenantId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { new: true, session }).select("roles").lean();
  if (!member) throw new CourseError(404, "NOT_FOUND");
  if (!rolesAllow(member.roles, permission)) throw new CourseError(403, "FORBIDDEN");
  const organization = await OrganizationModel.exists({ _id: tenantId, status: "active" }).session(session);
  if (!organization) throw new CourseError(404, "NOT_FOUND");
  return member.roles;
}
async function membership(userId: Types.ObjectId, tenantId: Types.ObjectId, permission: string) {
  const [org, member] = await Promise.all([
    OrganizationModel.exists({ _id: tenantId, status: "active" }),
    OrganizationMembershipModel.findOne({ userId, tenantId, status: "active" }).select("roles").lean(),
  ]);
  if (!org || !member) throw new CourseError(404, "NOT_FOUND");
  if (!rolesAllow(member.roles, permission)) throw new CourseError(403, "FORBIDDEN");
  return member.roles;
}
async function activeOrganizationIds(tenantIds: Types.ObjectId[]) {
  if (!tenantIds.length) return [];
  const organizations = await OrganizationModel.find({ _id: { $in: tenantIds }, status: "active" }).select("_id").lean();
  return organizations.map((organization) => organization._id);
}
async function managedCourse(courseId: string, actorId: string, session?: mongoose.ClientSession) {
  const actor = id(actorId); const course = await CourseModel.findOne({ _id: id(courseId), ownerScope: "organization" }).session(session ?? null);
  if (!course || !course.tenantId) throw new CourseError(404, "NOT_FOUND");
  const roles = session ? await lockMembership(session, actor, course.tenantId, "course.read") : await membership(actor, course.tenantId, "course.read");
  if (!rolesAllow(roles, "course.manage") && !(course.ownerId.equals(actor) && rolesAllow(roles, "course.manage.own"))) throw new CourseError(404, "NOT_FOUND");
  return { course, roles, actor, tenantId: course.tenantId };
}
async function lockCourse(session: mongoose.ClientSession, course: { _id: Types.ObjectId; tenantId: Types.ObjectId }, statuses: string[]) {
  const result = await CourseModel.updateOne({ _id: course._id, tenantId: course.tenantId, ownerScope: "organization", status: { $in: statuses } }, { $inc: { mutationVersion: 1 } }, { session });
  if (result.matchedCount !== 1) throw new CourseError(409, "COURSE_STATE_CONFLICT");
}
async function compactLessonOrder(session: mongoose.ClientSession, tenantId: Types.ObjectId, courseId: Types.ObjectId) {
  const lessons = await LessonModel.find({ tenantId, courseId }).sort({ position: 1, _id: 1 }).session(session);
  if (lessons.length > 200) throw new CourseError(409, "LESSON_LIMIT");
  for (let index = 0; index < lessons.length; index++) await LessonModel.updateOne({ _id: lessons[index]!._id, tenantId, courseId }, { $set: { position: 200 + index } }, { session });
  for (let index = 0; index < lessons.length; index++) await LessonModel.updateOne({ _id: lessons[index]!._id, tenantId, courseId }, { $set: { position: index } }, { session });
  return lessons;
}

export async function listCourseOrganizations(actorId: string) {
  const userId = id(actorId);
  const memberships = await OrganizationMembershipModel.find({ userId, status: "active", roles: { $in: ["STUDENT", "INSTRUCTOR", "ORGANIZATION_ADMIN", "COMPANY_ADMIN"] } }).select("tenantId roles").lean();
  if (!memberships.length) return [];
  const organizations = await OrganizationModel.find({ _id: { $in: memberships.map((item) => item.tenantId) }, status: "active" }).select("name kind slug").sort({ name: 1 }).lean();
  const roleMap = new Map(memberships.map((item) => [item.tenantId.toString(), item.roles]));
  return organizations.map((org) => ({ id: org._id.toString(), name: org.name, kind: org.kind, slug: org.slug, roles: roleMap.get(org._id.toString()) ?? [] }));
}

export async function createCourse(actorId: string, tenant: string, input: Record<string, unknown>, requestId: string) {
  const actor = id(actorId); const tenantId = id(tenant);
  try {
    let created!: ReturnType<typeof courseDto>;
    await mongoose.connection.transaction(async (session) => {
      await lockMembership(session, actor, tenantId, "course.create");
      const [course] = await CourseModel.create([{ ...input, ownerScope: "organization", tenantId, ownerId: actor, createdBy: actor, status: "draft" }], { session });
      if (!course) throw new Error("Course was not created.");
      await AuditEventModel.create([audit(tenantId, actor, "course.created", "course", course.id, requestId, { slug: course.slug })], { session });
      created = courseDto(course);
    });
    return created;
  } catch (error) { if (isDuplicate(error)) throw new CourseError(409, "COURSE_SLUG_EXISTS"); throw error; }
}

export async function listManagedCourses(actorId: string, cursor?: string, limit = 12) {
  const actor = id(actorId); const memberships = await OrganizationMembershipModel.find({ userId: actor, status: "active", roles: { $in: ["INSTRUCTOR", "ORGANIZATION_ADMIN", "COMPANY_ADMIN"] } }).select("tenantId roles").lean();
  const activeTenants = new Set((await activeOrganizationIds(memberships.map((item) => item.tenantId))).map(String));
  const adminTenants = memberships.filter((item) => activeTenants.has(item.tenantId.toString()) && rolesAllow(item.roles, "course.manage")).map((item) => item.tenantId);
  const instructorTenants = memberships.filter((item) => activeTenants.has(item.tenantId.toString()) && rolesAllow(item.roles, "course.manage.own")).map((item) => item.tenantId);
  const clauses: Record<string, unknown>[] = [];
  if (adminTenants.length) clauses.push({ tenantId: { $in: adminTenants } });
  if (instructorTenants.length) clauses.push({ tenantId: { $in: instructorTenants }, ownerId: actor });
  if (!clauses.length) return { items: [], nextCursor: null, hasMore: false };
  const decoded = cursorDecode(cursor); const filter = { ownerScope: "organization", $or: clauses, ...(decoded ? { $and: [{ $or: [{ updatedAt: { $lt: decoded.createdAt } }, { updatedAt: decoded.createdAt, _id: { $lt: decoded.id } }] }] } : {}) };
  const safeLimit = Math.min(50, Math.max(1, limit));
  const rows = await CourseModel.find(filter).sort({ updatedAt: -1, _id: -1 }).limit(safeLimit + 1).lean();
  const hasMore = rows.length > safeLimit; const items = rows.slice(0, safeLimit);
  const last = items.at(-1);
  return { items: items.map((course) => courseDto(course as never)), nextCursor: hasMore && last ? cursorEncode(last.updatedAt, last._id) : null, hasMore };
}

export async function getManagedCourse(actorId: string, courseId: string) {
  const { course } = await managedCourse(courseId, actorId);
  const lessons = await LessonModel.find({ tenantId: course.tenantId, courseId: course._id }).sort({ position: 1 }).lean();
  return { course: courseDto(course), lessons: lessons.map((lesson) => ({ ...lesson, id: lesson._id.toString(), _id: undefined })) };
}

export async function updateCourse(actorId: string, courseId: string, input: Record<string, unknown>, requestId: string) {
  const courseIdObject = id(courseId); const actor = id(actorId);
  return mongoose.connection.transaction(async (session) => {
    const initial = await CourseModel.findOne({ _id: courseIdObject, ownerScope: "organization" }).session(session);
    if (!initial?.tenantId) throw new CourseError(404, "NOT_FOUND");
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft", "published"]);
    if (course.status === "archived") throw new CourseError(409, "COURSE_ARCHIVED");
    Object.assign(course, input); await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.updated", "course", course.id, requestId, { changedFields: Object.keys(input) })], { session });
    return courseDto(course);
  }).catch((error: unknown) => { if (isDuplicate(error)) throw new CourseError(409, "COURSE_SLUG_EXISTS"); throw error; });
}

export async function publishCourse(actorId: string, courseId: string, requestId: string) {
  const actor = id(actorId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const lessons = await LessonModel.find({ tenantId, courseId: course._id, status: "draft" }).session(session);
    if (!lessons.length) throw new CourseError(422, "COURSE_REQUIRES_LESSONS");
    if (lessons.some((lesson) => ["video", "document", "resource"].includes(lesson.contentType) && !lesson.contentData)) throw new CourseError(422, "LESSON_MEDIA_REQUIRED");
    const publishedAt = new Date();
    await LessonModel.updateMany({ tenantId, courseId: course._id, status: "draft" }, { $set: { status: "published" } }, { session });
    for (const section of course.sections) section.status = "published";
    course.status = "published"; course.publishedAt = publishedAt; await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.published", "course", course.id, requestId, { lessonCount: lessons.length })], { session });
    return courseDto(course);
  });
}

export async function archiveCourse(actorId: string, courseId: string, requestId: string) {
  const actor = id(actorId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    if (course.status === "archived") return courseDto(course);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft", "published"]);
    course.status = "archived"; await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.archived", "course", course.id, requestId)], { session });
    return courseDto(course);
  });
}

export async function listCourseDiscovery(actorId: string, filters: { q?: string; category?: string; difficulty?: string; cursor?: string; limit: number }) {
  const actor = id(actorId); const memberships = await OrganizationMembershipModel.find({ userId: actor, status: "active", roles: { $in: ["STUDENT", "INSTRUCTOR", "ORGANIZATION_ADMIN", "COMPANY_ADMIN"] } }).select("tenantId").lean();
  const tenantIds = await activeOrganizationIds(memberships.map((item) => item.tenantId));
  if (!tenantIds.length) return { items: [], nextCursor: null, hasMore: false };
  const conditions: Record<string, unknown>[] = [{ tenantId: { $in: tenantIds } }, { status: "published" }, { ownerScope: "organization" }];
  if (filters.category) conditions.push({ category: filters.category });
  if (filters.difficulty) conditions.push({ difficulty: filters.difficulty });
  if (filters.q) { const expression = new RegExp(escapeRegex(filters.q), "i"); conditions.push({ $or: [{ title: expression }, { shortDescription: expression }, { description: expression }] }); }
  const decoded = cursorDecode(filters.cursor);
  if (decoded) conditions.push({ $or: [{ createdAt: { $lt: decoded.createdAt } }, { createdAt: decoded.createdAt, _id: { $lt: decoded.id } }] });
  const safeLimit = Math.min(50, Math.max(1, filters.limit));
  const rows = await CourseModel.find({ $and: conditions }).sort({ createdAt: -1, _id: -1 }).limit(safeLimit + 1).lean();
  const hasMore = rows.length > safeLimit; const items = rows.slice(0, safeLimit); const last = items.at(-1);
  return { items: items.map((course) => courseDto(course as never)), nextCursor: hasMore && last ? cursorEncode(last.createdAt, last._id) : null, hasMore };
}

export async function getPublishedCourse(actorId: string, courseId: string) {
  const actor = id(actorId); const course = await CourseModel.findOne({ _id: id(courseId), ownerScope: "organization", status: "published" }).lean();
  if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
  await membership(actor, course.tenantId, "course.read");
  const [lessons, enrollment, organization] = await Promise.all([
    LessonModel.find({ tenantId: course.tenantId, courseId: course._id, status: "published" }).sort({ position: 1 }).lean(),
    EnrollmentModel.findOne({ tenantId: course.tenantId, courseId: course._id, studentId: actor, status: { $in: ["active", "completed"] } }).select("_id status progress").lean(),
    OrganizationModel.findById(course.tenantId).select("name").lean(),
  ]);
  return { course: { ...courseDto(course as never), organizationName: organization?.name ?? "" }, lessons: lessons.map((lesson) => lessonMetadata(lesson as Record<string, unknown>)), enrollment: enrollment ? { id: enrollment._id.toString(), status: enrollment.status, progress: enrollment.progress } : null };
}

export async function enrollInCourse(actorId: string, courseId: string, requestId: string) {
  const actor = id(actorId); const courseIdObject = id(courseId);
  try {
    let result!: { enrollment: Record<string, unknown>; created: boolean };
    await mongoose.connection.transaction(async (session) => {
      const course = await CourseModel.findOne({ _id: courseIdObject, ownerScope: "organization", status: "published" }).session(session);
      if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
      await lockCourse(session, { _id: course._id, tenantId: course.tenantId }, ["published"]);
      await lockMembership(session, actor, course.tenantId, "course.read");
      let enrollment = await EnrollmentModel.findOne({ tenantId: course.tenantId, courseId: course._id, studentId: actor }).session(session);
      if (enrollment) { result = { enrollment: enrollment.toObject(), created: false }; return; }
      const totalLessons = await LessonModel.countDocuments({ tenantId: course.tenantId, courseId: course._id, status: "published" }).session(session);
      if (totalLessons < 1) throw new CourseError(409, "COURSE_HAS_NO_PUBLISHED_LESSONS");
      const [created] = await EnrollmentModel.create([{ tenantId: course.tenantId, courseId: course._id, studentId: actor, status: "active", startedAt: new Date(), progress: { completedLessons: 0, totalLessons, percent: 0 } }], { session });
      if (!created) throw new Error("Enrollment was not created.");
      enrollment = created;
      await AuditEventModel.create([audit(course.tenantId, actor, "course.enrolled", "enrollment", enrollment.id, requestId, { courseId: course.id })], { session });
      result = { enrollment: enrollment.toObject(), created: true };
    });
    return result;
  } catch (error) { if (isDuplicate(error)) throw new CourseError(409, "ALREADY_ENROLLED"); throw error; }
}

async function studentEnrollment(actor: Types.ObjectId, enrollmentId: string, session?: mongoose.ClientSession) {
  const enrollment = await EnrollmentModel.findOne({ _id: id(enrollmentId), studentId: actor, status: { $in: ["active", "completed"] } }).session(session ?? null);
  if (!enrollment) throw new CourseError(404, "NOT_FOUND");
  const course = await CourseModel.findOne({ _id: enrollment.courseId, tenantId: enrollment.tenantId, ownerScope: "organization", status: "published" }).session(session ?? null);
  if (!course) throw new CourseError(404, "NOT_FOUND");
  if (session) await lockMembership(session, actor, enrollment.tenantId, "course.read");
  else await membership(actor, enrollment.tenantId, "course.read");
  return { enrollment, course };
}

export async function listMyEnrollments(actorId: string) {
  const actor = id(actorId); const memberships = await OrganizationMembershipModel.find({ userId: actor, status: "active", roles: { $in: ["STUDENT", "INSTRUCTOR", "ORGANIZATION_ADMIN", "COMPANY_ADMIN"] } }).select("tenantId").lean();
  if (!memberships.length) return [];
  const tenantIds = await activeOrganizationIds(memberships.map((item) => item.tenantId));
  if (!tenantIds.length) return [];
  const enrollments = await EnrollmentModel.find({ studentId: actor, tenantId: { $in: tenantIds }, status: { $in: ["active", "completed"] } }).sort({ updatedAt: -1, _id: -1 }).limit(100).lean();
  if (!enrollments.length) return [];
  const courses = await CourseModel.find({ _id: { $in: enrollments.map((item) => item.courseId) }, tenantId: { $in: tenantIds }, status: "published" }).lean();
  const byId = new Map(courses.map((course) => [course._id.toString(), course]));
  return enrollments.flatMap((enrollment) => { const course = byId.get(enrollment.courseId.toString()); return course ? [{ enrollment: { id: enrollment._id.toString(), status: enrollment.status, progress: enrollment.progress, updatedAt: enrollment.updatedAt }, course: courseDto(course as never) }] : []; });
}

export async function getMyEnrollment(actorId: string, enrollmentId: string) {
  const actor = id(actorId); const { enrollment, course } = await studentEnrollment(actor, enrollmentId);
  const lessons = await LessonModel.find({ tenantId: course.tenantId, courseId: course._id, status: "published" }).sort({ position: 1 }).lean();
  const progress = await LessonProgressModel.find({ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, studentId: actor }).select("lessonId isComplete completedAt lastAccessedAt videoProgress").lean();
  const progressByLesson = new Map(progress.map((item) => [item.lessonId.toString(), item]));
  return { enrollment: { id: enrollment.id, status: enrollment.status, startedAt: enrollment.startedAt, completedAt: enrollment.completedAt ?? null, progress: enrollment.progress }, course: courseDto(course), lessons: lessons.map((lesson) => ({ ...lessonMetadata(lesson as Record<string, unknown>), progress: progressByLesson.get(lesson._id.toString()) ? { isComplete: progressByLesson.get(lesson._id.toString())!.isComplete, completedAt: progressByLesson.get(lesson._id.toString())!.completedAt ?? null, lastAccessedAt: progressByLesson.get(lesson._id.toString())!.lastAccessedAt, videoProgress: progressByLesson.get(lesson._id.toString())!.videoProgress ?? null } : { isComplete: false, completedAt: null, lastAccessedAt: null, videoProgress: null } })) };
}

export async function accessLesson(actorId: string, courseId: string, lessonId: string) {
  const actor = id(actorId); const courseIdObject = id(courseId); const lessonIdObject = id(lessonId);
  return mongoose.connection.transaction(async (session) => {
    const course = await CourseModel.findOne({ _id: courseIdObject, ownerScope: "organization", status: "published" }).session(session);
    if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
    await lockCourse(session, { _id: course._id, tenantId: course.tenantId }, ["published"]);
    await lockMembership(session, actor, course.tenantId, "course.read");
    const lesson = await LessonModel.findOne({ _id: lessonIdObject, tenantId: course.tenantId, courseId: course._id, status: "published" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    const enrollment = await EnrollmentModel.findOneAndUpdate({ tenantId: course.tenantId, courseId: course._id, studentId: actor, status: { $in: ["active", "completed"] } }, { $inc: { progressVersion: 1 } }, { new: true, session }).select("+progressVersion");
    if (!enrollment) throw new CourseError(403, "ENROLLMENT_REQUIRED");
    await LessonProgressModel.findOneAndUpdate({ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor }, { $setOnInsert: { tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor, isComplete: false }, $set: { lastAccessedAt: new Date() } }, { upsert: true, new: true, session });
    return lesson.toObject();
  });
}

function lessonVideoDurationSeconds(lesson: { contentType: string; contentData?: { type?: string; durationSeconds?: number }; estimatedDurationMinutes?: number }) {
  if (lesson.contentData?.type === "video" && Number.isInteger(lesson.contentData.durationSeconds)) return lesson.contentData.durationSeconds!;
  if (lesson.contentType === "external_video" && lesson.estimatedDurationMinutes && lesson.estimatedDurationMinutes > 0) return lesson.estimatedDurationMinutes * 60;
  return 0;
}

export async function recordVideoProgress(actorId: string, courseId: string, lessonId: string, positionSeconds: number) {
  const actor = id(actorId); const courseIdObject = id(courseId); const lessonIdObject = id(lessonId);
  return mongoose.connection.transaction(async (session) => {
    const course = await CourseModel.findOne({ _id: courseIdObject, ownerScope: "organization", status: "published" }).session(session);
    if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
    await lockCourse(session, { _id: course._id, tenantId: course.tenantId }, ["published"]);
    await lockMembership(session, actor, course.tenantId, "course.read");
    const lesson = await LessonModel.findOne({ _id: lessonIdObject, tenantId: course.tenantId, courseId: course._id, status: "published" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    const duration = lessonVideoDurationSeconds(lesson);
    if (!duration) throw new CourseError(409, "VIDEO_DURATION_UNAVAILABLE");
    const enrollment = await EnrollmentModel.findOneAndUpdate({ tenantId: course.tenantId, courseId: course._id, studentId: actor, status: { $in: ["active", "completed"] } }, { $inc: { progressVersion: 1 } }, { new: true, session }).select("+progressVersion");
    if (!enrollment) throw new CourseError(403, "ENROLLMENT_REQUIRED");
    const now = new Date(); const boundedPosition = Math.min(positionSeconds, duration);
    const progress = await LessonProgressModel.findOne({ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor }).session(session);
    const previous = progress?.videoProgress;
    const elapsedSeconds = previous?.lastHeartbeatAt ? Math.max(0, Math.min(30, (now.getTime() - previous.lastHeartbeatAt.getTime()) / 1000)) : 0;
    const forwardSeconds = previous ? Math.max(0, boundedPosition - previous.lastPositionSeconds) : 0;
    const creditedSeconds = Math.min(forwardSeconds, elapsedSeconds * 1.25);
    const watchedSeconds = Math.min(duration, (previous?.watchedSeconds ?? 0) + creditedSeconds);
    if (progress) {
      progress.videoProgress = { watchedSeconds, lastPositionSeconds: boundedPosition, lastHeartbeatAt: now };
      progress.lastAccessedAt = now;
      await progress.save({ session });
    } else {
      await LessonProgressModel.create([{ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor, isComplete: false, lastAccessedAt: now, videoProgress: { watchedSeconds: 0, lastPositionSeconds: boundedPosition, lastHeartbeatAt: now } }], { session });
    }
    return { lessonId: lesson.id, durationSeconds: duration, watchedSeconds: Math.floor(watchedSeconds), completionThresholdSeconds: Math.ceil(duration * 0.9) };
  });
}

export async function completeLesson(actorId: string, courseId: string, lessonId: string, requestId: string) {
  const actor = id(actorId); const courseIdObject = id(courseId); const lessonIdObject = id(lessonId);
  return mongoose.connection.transaction(async (session) => {
    const course = await CourseModel.findOne({ _id: courseIdObject, ownerScope: "organization", status: "published" }).session(session);
    if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
    await lockCourse(session, { _id: course._id, tenantId: course.tenantId }, ["published"]);
    await lockMembership(session, actor, course.tenantId, "course.read");
    const lesson = await LessonModel.findOne({ _id: lessonIdObject, tenantId: course.tenantId, courseId: course._id, status: "published" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    const enrollment = await EnrollmentModel.findOneAndUpdate({ tenantId: course.tenantId, courseId: course._id, studentId: actor, status: { $in: ["active", "completed"] } }, { $inc: { progressVersion: 1 } }, { new: true, session }).select("+progressVersion");
    if (!enrollment) throw new CourseError(403, "ENROLLMENT_REQUIRED");
    const existing = await LessonProgressModel.findOne({ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor }).session(session);
    const videoDuration = lessonVideoDurationSeconds(lesson);
    if ((lesson.contentType === "video" || lesson.contentType === "external_video") && (!videoDuration || (existing?.videoProgress?.watchedSeconds ?? 0) < Math.ceil(videoDuration * 0.9))) throw new CourseError(409, "VIDEO_WATCH_THRESHOLD_NOT_MET");
    const now = new Date(); let newlyCompleted = false;
    if (existing) {
      if (!existing.isComplete) { existing.isComplete = true; existing.completedAt = now; newlyCompleted = true; }
      existing.lastAccessedAt = now; await existing.save({ session });
    } else {
      await LessonProgressModel.create([{ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, lessonId: lesson._id, studentId: actor, isComplete: true, completedAt: now, lastAccessedAt: now }], { session });
      newlyCompleted = true;
    }
    const totalLessons = await LessonModel.countDocuments({ tenantId: course.tenantId, courseId: course._id, status: "published" }).session(session);
    const completedLessons = await LessonProgressModel.countDocuments({ tenantId: course.tenantId, courseId: course._id, enrollmentId: enrollment._id, studentId: actor, isComplete: true }).session(session);
    enrollment.progress = { completedLessons, totalLessons, percent: totalLessons ? Math.floor(completedLessons * 100 / totalLessons) : 0 };
    if (totalLessons > 0 && completedLessons === totalLessons) { enrollment.status = "completed"; enrollment.completedAt ??= now; }
    await enrollment.save({ session });
    if (newlyCompleted) await AuditEventModel.create([audit(course.tenantId, actor, "course.lesson.completed", "lesson", lesson.id, requestId, { courseId: course.id })], { session });
    return { enrollment: enrollment.toObject(), progress: { lessonId: lesson.id, isComplete: true, completedAt: existing?.completedAt ?? now }, course: courseDto(course) };
  });
}

export async function listManagedLessons(actorId: string, courseId: string) {
  const { course } = await managedCourse(courseId, actorId);
  const lessons = await LessonModel.find({ tenantId: course.tenantId, courseId: course._id }).sort({ position: 1 }).lean();
  return lessons.map((lesson) => ({ ...lesson, id: lesson._id.toString(), _id: undefined }));
}

export async function createLesson(actorId: string, courseId: string, input: Record<string, unknown> & { sectionId?: string | null }, requestId: string) {
  const actor = id(actorId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    if (input.sectionId && !course.sections.id(id(input.sectionId))) throw new CourseError(404, "NOT_FOUND");
    const position = await LessonModel.countDocuments({ tenantId, courseId: course._id }).session(session);
    if (position >= 200) throw new CourseError(409, "LESSON_LIMIT");
    const [lesson] = await LessonModel.create([{ ...input, sectionId: input.sectionId ? id(input.sectionId) : null, tenantId, courseId: course._id, position, status: "draft" }], { session });
    if (!lesson) throw new Error("Lesson was not created.");
    await recalculateCourseDuration(course, tenantId, session);
    await AuditEventModel.create([audit(tenantId, actor, "course.lesson.created", "lesson", lesson.id, requestId, { courseId: course.id })], { session });
    return lesson.toObject();
  });
}

export async function updateLesson(actorId: string, courseId: string, lessonId: string, input: Record<string, unknown>, requestId: string) {
  const actor = id(actorId); const lessonObjectId = id(lessonId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: course._id, status: "draft" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    Object.assign(lesson, input); await lesson.save({ session });
    await recalculateCourseDuration(course, tenantId, session);
    await AuditEventModel.create([audit(tenantId, actor, "course.lesson.updated", "lesson", lesson.id, requestId, { courseId: course.id, changedFields: Object.keys(input) })], { session });
    return lesson.toObject();
  });
}

export async function deleteLesson(actorId: string, courseId: string, lessonId: string, requestId: string) {
  const actor = id(actorId); const lessonObjectId = id(lessonId);
  let mediaToDelete: { _id: Types.ObjectId; publicId: string; resourceType: "video" | "raw"; tenantId: Types.ObjectId }[] = [];
  await mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: course._id, status: "draft" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    mediaToDelete = await MediaAssetModel.find({ tenantId, courseId: course._id, lessonId: lesson._id, state: "ready" }).session(session).lean();
    if (mediaToDelete.length) {
      await MediaAssetModel.updateMany({ tenantId, courseId: course._id, lessonId: lesson._id, state: "ready" }, { $set: { state: "deletion_requested", deletionRequestedAt: new Date() } }, { session });
      await AuditEventModel.create(mediaToDelete.map((asset) => audit(tenantId, actor, "course.media.deletion_requested", "mediaAsset", String(asset._id), requestId, { courseId: course.id, lessonId: lesson.id, reason: "lesson_deleted" })), { session });
    }
    await LessonModel.deleteOne({ _id: lesson._id, tenantId, courseId: course._id }, { session });
    await LessonProgressModel.deleteMany({ tenantId, courseId: course._id, lessonId: lesson._id }, { session });
    const enrollments = await EnrollmentModel.find({ tenantId, courseId: course._id }).session(session);
    const totalLessons = await LessonModel.countDocuments({ tenantId, courseId: course._id, status: "published" }).session(session);
    for (const enrollment of enrollments) {
      const completedLessons = await LessonProgressModel.countDocuments({ tenantId, courseId: course._id, enrollmentId: enrollment._id, studentId: enrollment.studentId, isComplete: true }).session(session);
      enrollment.progress = { completedLessons, totalLessons, percent: totalLessons ? Math.floor(completedLessons * 100 / totalLessons) : 0 };
      await enrollment.save({ session });
    }
    await compactLessonOrder(session, tenantId, course._id);
    await recalculateCourseDuration(course, tenantId, session);
    await AuditEventModel.create([audit(tenantId, actor, "course.lesson.deleted", "lesson", lesson.id, requestId, { courseId: course.id })], { session });
  });
  for (const asset of mediaToDelete) {
    try {
      await getPrivateAssetStorage().deleteAsset({ publicId: asset.publicId, resourceType: asset.resourceType });
      await mongoose.connection.transaction(async (session) => {
        const deleted = await MediaAssetModel.findOneAndUpdate({ _id: asset._id, tenantId: asset.tenantId, state: "deletion_requested" }, { $set: { state: "deleted", deletedAt: new Date() } }, { new: true, session });
        if (deleted) await AuditEventModel.create([audit(asset.tenantId, actor, "course.media.deleted", "mediaAsset", String(asset._id), requestId, { reason: "lesson_deleted" })], { session });
      });
    } catch { /* Reconciliation retries deletion; the requested state blocks delivery meanwhile. */ }
  }
}

export async function createSection(actorId: string, courseId: string, input: { title: string; description?: string }, requestId: string) {
  const actor = id(actorId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    if (course.sections.length >= 100) throw new CourseError(409, "SECTION_LIMIT");
    const section = course.sections.create({ ...input, position: course.sections.length, status: "draft" });
    course.sections.push(section); await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.section.created", "section", section.id, requestId, { courseId: course.id })], { session });
    return { ...section.toObject(), id: section.id };
  });
}

export async function updateSection(actorId: string, courseId: string, sectionId: string, input: { title?: string; description?: string }, requestId: string) {
  const actor = id(actorId); const sectionObjectId = id(sectionId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const section = course.sections.id(sectionObjectId);
    if (!section) throw new CourseError(404, "NOT_FOUND");
    Object.assign(section, input); await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.section.updated", "section", section.id, requestId, { courseId: course.id, changedFields: Object.keys(input) })], { session });
    return { ...section.toObject(), id: section.id };
  });
}

export async function deleteSection(actorId: string, courseId: string, sectionId: string, requestId: string) {
  const actor = id(actorId); const sectionObjectId = id(sectionId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const section = course.sections.id(sectionObjectId);
    if (!section) throw new CourseError(404, "NOT_FOUND");
    if (await LessonModel.exists({ tenantId, courseId: course._id, sectionId: sectionObjectId }).session(session)) throw new CourseError(409, "SECTION_NOT_EMPTY");
    const sectionTitle = section.title;
    section.deleteOne();
    course.sections.forEach((item, index) => { item.position = index; });
    await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.section.deleted", "section", sectionId, requestId, { courseId: course.id, title: sectionTitle })], { session });
  });
}

export async function reorderSections(actorId: string, courseId: string, sectionIds: string[], requestId: string) {
  const actor = id(actorId); const requested = sectionIds.map(id);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    if (course.sections.length !== requested.length || requested.some((sectionId) => !course.sections.id(sectionId))) throw new CourseError(422, "INVALID_SECTION_ORDER");
    const ordered = requested.map((sectionId) => course.sections.id(sectionId)!);
    ordered.forEach((section, index) => { section.position = index; });
    await course.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "course.sections.reordered", "course", course.id, requestId, { sectionCount: ordered.length })], { session });
    return course.sections.slice().sort((a, b) => a.position - b.position).map((section) => ({ ...section.toObject(), id: section.id }));
  });
}

export async function moveLesson(actorId: string, courseId: string, lessonId: string, sectionId: string | null, position: number, requestId: string) {
  const actor = id(actorId); const lessonObjectId = id(lessonId); const sectionObjectId = sectionId === null ? null : id(sectionId);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    if (sectionObjectId && !course.sections.id(sectionObjectId)) throw new CourseError(404, "NOT_FOUND");
    const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: course._id, status: "draft" }).session(session);
    if (!lesson) throw new CourseError(404, "NOT_FOUND");
    const peerFilter = { tenantId, courseId: course._id, _id: { $ne: lesson._id }, sectionId: sectionObjectId };
    const peers = await LessonModel.find(peerFilter).sort({ position: 1 }).session(session);
    if (position > peers.length) throw new CourseError(422, "INVALID_LESSON_POSITION");
    const all = await LessonModel.find({ tenantId, courseId: course._id }).session(session);
    for (let index = 0; index < all.length; index++) await LessonModel.updateOne({ _id: all[index]!._id, tenantId, courseId: course._id }, { $set: { position: 200 + index } }, { session });
    const sequence = peers.map((item) => item._id); sequence.splice(position, 0, lesson._id);
    const otherGroups = all.filter((item) => !item._id.equals(lesson._id) && item.sectionId?.toString() !== sectionObjectId?.toString());
    const finalOrder = [...otherGroups.map((item) => item._id), ...sequence];
    for (let index = 0; index < finalOrder.length; index++) await LessonModel.updateOne({ _id: finalOrder[index]!, tenantId, courseId: course._id }, { $set: { position: index, ...(finalOrder[index]!.equals(lesson._id) ? { sectionId: sectionObjectId } : {}) } }, { session });
    const moved = await LessonModel.findById(lesson._id).session(session);
    await AuditEventModel.create([audit(tenantId, actor, "course.lesson.moved", "lesson", lesson.id, requestId, { courseId: course.id, sectionId, position })], { session });
    return moved?.toObject();
  });
}

async function recalculateCourseDuration(course: { _id: Types.ObjectId; estimatedDurationMinutes: number; save: (options: { session: mongoose.ClientSession }) => Promise<unknown> }, tenantId: Types.ObjectId, session: mongoose.ClientSession) {
  const rows = await LessonModel.aggregate([{ $match: { tenantId, courseId: course._id } }, { $group: { _id: null, minutes: { $sum: "$estimatedDurationMinutes" } } }]).session(session);
  course.estimatedDurationMinutes = rows[0]?.minutes ?? 0;
  await course.save({ session });
}

export async function reorderLessons(actorId: string, courseId: string, lessonIds: string[], requestId: string) {
  const actor = id(actorId); const requested = lessonIds.map(id);
  return mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await managedCourse(courseId, actorId, session);
    await lockCourse(session, { _id: course._id, tenantId }, ["draft"]);
    const lessons = await LessonModel.find({ tenantId, courseId: course._id }).session(session);
    if (lessons.length !== requested.length || new Set(lessons.map((lesson) => lesson.id)).size !== requested.length || requested.some((lessonId) => !lessons.some((lesson) => lesson._id.equals(lessonId)))) throw new CourseError(422, "INVALID_LESSON_ORDER");
    for (let index = 0; index < requested.length; index++) await LessonModel.updateOne({ _id: requested[index], tenantId, courseId: course._id }, { $set: { position: 200 + index } }, { session });
    for (let index = 0; index < requested.length; index++) await LessonModel.updateOne({ _id: requested[index], tenantId, courseId: course._id }, { $set: { position: index } }, { session });
    await AuditEventModel.create([audit(tenantId, actor, "course.lessons.reordered", "course", course.id, requestId, { lessonCount: requested.length })], { session });
    return LessonModel.find({ tenantId, courseId: course._id }).sort({ position: 1 }).session(session).lean();
  });
}
