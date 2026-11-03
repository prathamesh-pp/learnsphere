import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import mongoose, { Types } from "mongoose";
import test, { after, afterEach, before } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AuditEventModel } from "../../src/models/audit-event.model.js";
import { CourseModel } from "../../src/models/course.model.js";
import { EnrollmentModel } from "../../src/models/enrollment.model.js";
import { LessonModel } from "../../src/models/lesson.model.js";
import { LessonProgressModel } from "../../src/models/lesson-progress.model.js";
import { MediaAssetModel, MediaUploadIntentModel } from "../../src/models/media-asset.model.js";
import { OrganizationMembershipModel } from "../../src/models/organization-membership.model.js";
import { OrganizationModel } from "../../src/models/organization.model.js";
import { UserModel } from "../../src/models/user.model.js";
import { UserCredentialModel } from "../../src/models/user-credential.model.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { sha256 } from "../../src/services/session.service.js";
import { accessLesson, archiveCourse, completeLesson, createCourse, createLesson, createSection, deleteLesson, deleteSection, enrollInCourse, getMyEnrollment, getPublishedCourse, listCourseDiscovery, listManagedCourses, listMyEnrollments, moveLesson, publishCourse, recordVideoProgress, reorderLessons, reorderSections, updateLesson, updateSection } from "../../src/services/course.service.js";
import { createLessonMediaUploadGrant, createStudentMediaAccess, deleteLessonMediaAsset, uploadAndVerifyLessonMedia } from "../../src/services/media.service.js";
import { setPrivateAssetStorageProvider, UnconfiguredPrivateAssetStorage, type PrivateAssetStorageProvider, type PrivateUploadRequest, type ProviderAsset } from "../../src/services/private-asset-storage.service.js";

const uri = process.env.LMS_INTEGRATION_MONGODB_URI;
if (!uri) throw new Error("LMS_INTEGRATION_MONGODB_URI must explicitly point to the isolated test replica set.");
const parsed = new URL(uri);
if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") || parsed.pathname.replace(/^\//, "").split("/")[0] !== "learnsphere_phase2_test" || parsed.searchParams.get("replicaSet") !== "rs0") throw new Error("Integration tests only permit the local learnsphere_phase2_test replica set.");
const runId = randomUUID(); const userIds: Types.ObjectId[] = []; const orgIds: Types.ObjectId[] = []; const courseIds: Types.ObjectId[] = [];
const csrfToken = "a".repeat(40);
const testConfig = loadConfig({ NODE_ENV: "test", MONGODB_URI: uri, WEB_ORIGIN: "http://localhost:5173", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64url") });
class IntegrationMediaProvider implements PrivateAssetStorageProvider {
  readonly deletions: string[] = [];
  reuseAssetId = false;
  async createUploadGrant(request: PrivateUploadRequest) { return { intentId: request.intentId, uploadUrl: `/test-upload/${request.intentId}`, expiresAt: new Date(Date.now() + 600_000).toISOString(), maxSizeBytes: request.maxSizeBytes }; }
  async upload(request: PrivateUploadRequest, source: NodeJS.ReadableStream): Promise<ProviderAsset> {
    let bytes = 0; for await (const chunk of source) bytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
    return { assetId: this.reuseAssetId ? "shared-test-provider-id" : `provider-${request.intentId}`, publicId: request.publicId, resourceType: request.resourceType, deliveryType: "authenticated", format: request.purpose === "video" ? "mp4" : request.fileName.split(".").at(-1)!.toLowerCase(), sizeBytes: bytes, version: 1, responseSignature: "verified-test-signature", ...(request.purpose === "video" ? { durationSeconds: 60, width: 640, height: 360 } : {}) };
  }
  async getVerifiedAsset(_request: PrivateUploadRequest, uploaded: ProviderAsset) { return uploaded; }
  async createDownloadGrant(input: { publicId: string; format: string; resourceType: "video" | "raw"; disposition: "inline" | "attachment" }) { return { url: `https://media.example.test/${input.resourceType}/${input.disposition}/${encodeURIComponent(input.publicId)}.${input.format}?expires=300`, expiresAt: new Date(Date.now() + 300_000).toISOString() }; }
  async deleteAsset(input: { publicId: string; resourceType: "video" | "raw" }) { this.deletions.push(`${input.resourceType}:${input.publicId}`); }
}
let counter = 0;
async function user(label: string) { const item = await UserModel.create({ emailNormalized: `course-${runId}-${++counter}@example.test`, displayName: label, status: "active" }); userIds.push(item._id); return item; }
async function organization(owner: Types.ObjectId, members: { userId: Types.ObjectId; roles: string[] }[] = []) {
  const org = await OrganizationModel.create({ name: `Course Org ${counter}`, slug: `course-${runId}-${++counter}`, kind: "institution", status: "active", createdBy: owner }); orgIds.push(org._id);
  await OrganizationMembershipModel.create([{ tenantId: org._id, userId: owner, status: "active", roles: ["ORGANIZATION_ADMIN"] }, ...members.map((member) => ({ tenantId: org._id, userId: member.userId, status: "active", roles: member.roles }))]);
  return org;
}
const courseInput = { title: "Practical Systems", slug: "practical-systems", shortDescription: "A hands-on introduction.", description: "Learn practical systems one step at a time.", learningObjectives: ["Understand the foundations"], prerequisites: [], category: "Technology", difficulty: "beginner", language: "en", estimatedDurationMinutes: 0, tags: ["systems"] };
const lessonInput = (title: string, content: string) => ({ title, description: "A concise lesson.", contentType: "text", content, resourceLinks: [], estimatedDurationMinutes: 8 });
async function startApi() {
  const app = createApp(testConfig, {
    checkDatabaseReady: async () => true,
    resolveSession: (request, _response, next) => {
      const userId = request.get("x-test-user");
      if (userId) {
        const mfaMode = request.get("x-test-mfa");
        request.authContext = { userId, sessionId: "integration-session", csrfTokenHash: sha256(csrfToken), mfaVerified: mfaMode !== "none", mfaVerifiedAt: mfaMode === "stale" ? new Date(Date.now() - 10 * 60_000) : mfaMode === "expired" ? new Date(Date.now() - 13 * 60 * 60_000) : mfaMode === "none" ? undefined : new Date() };
      }
      next();
    },
  });
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    request: async (path: string, userId: Types.ObjectId | string, options: { method?: string; body?: unknown; mfa?: "none" | "stale" | "expired" | "fresh" } = {}) => {
      const method = options.method ?? "GET";
      const response = await fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { origin: testConfig.webOrigin, "x-test-user": String(userId), "x-test-mfa": options.mfa ?? "none", ...(method === "GET" ? {} : { "content-type": "application/json", "x-csrf-token": csrfToken }), ...(options.body === undefined ? {} : { "content-type": "application/json" }) }, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
      return { status: response.status, body: response.status === 204 ? undefined : await response.json() as Record<string, any> };
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
before(async () => {
  await mongoose.connect(uri!, { autoIndex: false });
  await Promise.all([UserModel.createIndexes(), UserCredentialModel.createIndexes(), OrganizationModel.createIndexes(), OrganizationMembershipModel.createIndexes(), CourseModel.createIndexes(), LessonModel.createIndexes(), EnrollmentModel.createIndexes(), LessonProgressModel.createIndexes(), AuditEventModel.createIndexes(), MediaAssetModel.createIndexes(), MediaUploadIntentModel.createIndexes()]);
});
afterEach(async () => {
  if (orgIds.length) await Promise.all([OrganizationMembershipModel.deleteMany({ tenantId: { $in: orgIds } }), OrganizationModel.deleteMany({ _id: { $in: orgIds } })]);
  if (courseIds.length) await Promise.all([CourseModel.deleteMany({ _id: { $in: courseIds } }), LessonModel.deleteMany({ courseId: { $in: courseIds } }), EnrollmentModel.deleteMany({ courseId: { $in: courseIds } }), LessonProgressModel.deleteMany({ courseId: { $in: courseIds } }), MediaAssetModel.deleteMany({ courseId: { $in: courseIds } }), MediaUploadIntentModel.deleteMany({ courseId: { $in: courseIds } })]);
  if (userIds.length) await Promise.all([OrganizationMembershipModel.deleteMany({ userId: { $in: userIds } }), UserCredentialModel.deleteMany({ userId: { $in: userIds } }), AuditEventModel.deleteMany({ actorId: { $in: userIds } }), UserModel.deleteMany({ _id: { $in: userIds } })]);
  userIds.length = 0; orgIds.length = 0; courseIds.length = 0;
});
after(async () => mongoose.disconnect());

test("course visibility, enrollment and lesson content stay within the owning organization", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student"); const outsider = await user("Outsider");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const otherOrg = await organization(outsider._id);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `systems-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const one = await createLesson(instructor.id, courseId, lessonInput("Foundations", "Secret lesson text."), `req-${runId}`); const two = await createLesson(instructor.id, courseId, lessonInput("Practice", "Practice lesson text."), `req-${runId}`);
  await publishCourse(instructor.id, courseId, `req-${runId}`);
  assert.equal((await listCourseDiscovery(student.id, { limit: 20 })).items.length, 1);
  assert.equal((await listCourseDiscovery(outsider.id, { limit: 20 })).items.length, 0);
  await assert.rejects(getPublishedCourse(outsider.id, courseId));
  await assert.rejects(accessLesson(student.id, courseId, String(one._id)));
  const joined = await enrollInCourse(student.id, courseId, `req-${runId}`); assert.equal(joined.created, true);
  assert.equal((await getPublishedCourse(student.id, courseId)).lessons.length, 2);
  assert.equal((await accessLesson(student.id, courseId, String(one._id))).content, "Secret lesson text.");
  await assert.rejects(getMyEnrollment(outsider.id, String((joined.enrollment as { _id: Types.ObjectId })._id)));
  await completeLesson(student.id, courseId, String(one._id), `req-${runId}`);
  const done = await completeLesson(student.id, courseId, String(two._id), `req-${runId}`);
  assert.equal((done.enrollment as { status: string }).status, "completed");
  const view = await getMyEnrollment(student.id, String((joined.enrollment as { _id: Types.ObjectId })._id));
  assert.ok(view.enrollment.progress); assert.equal(view.enrollment.progress.percent, 100); assert.equal(view.lessons.filter((lesson) => lesson.progress?.isComplete).length, 2);
  assert.equal(await LessonProgressModel.countDocuments({ tenantId: otherOrg._id, courseId: new Types.ObjectId(courseId) }), 0);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org._id, action: "course.lesson.completed" }), 2);
});

test("duplicate enrollment is idempotent and archived course is no longer discoverable", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `archive-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  await createLesson(instructor.id, courseId, lessonInput("Only lesson", "Course body."), `req-${runId}`); await publishCourse(instructor.id, courseId, `req-${runId}`);
  const first = await enrollInCourse(student.id, courseId, `req-${runId}`); const second = await enrollInCourse(student.id, courseId, `req-${runId}`);
  assert.equal(first.created, true); assert.equal(second.created, false); assert.equal((second.enrollment as { _id: Types.ObjectId })._id.toString(), (first.enrollment as { _id: Types.ObjectId })._id.toString());
  await archiveCourse(instructor.id, courseId, `req-${runId}`); assert.equal((await listCourseDiscovery(student.id, { limit: 20 })).items.length, 0);
  await assert.rejects(accessLesson(student.id, courseId, String((await LessonModel.findOne({ courseId: courseIds.at(-1) }))!._id)));
});

test("discovery and enrollment summaries exclude suspended and archived organizations", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student");
  const suspendedOrg = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const archivedOrg = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const suspendedCourse = await createCourse(instructor.id, suspendedOrg.id, { ...courseInput, slug: `suspended-${counter}` }, `req-${runId}`); courseIds.push(new Types.ObjectId(String(suspendedCourse.id)));
  const suspendedLesson = await createLesson(instructor.id, String(suspendedCourse.id), lessonInput("Suspended lesson", "Content."), `req-${runId}`); await publishCourse(instructor.id, String(suspendedCourse.id), `req-${runId}`);
  const archivedCourse = await createCourse(instructor.id, archivedOrg.id, { ...courseInput, slug: `inactive-${counter}` }, `req-${runId}`); courseIds.push(new Types.ObjectId(String(archivedCourse.id)));
  await createLesson(instructor.id, String(archivedCourse.id), lessonInput("Archived lesson", "Content."), `req-${runId}`); await publishCourse(instructor.id, String(archivedCourse.id), `req-${runId}`);
  await enrollInCourse(student.id, String(suspendedCourse.id), `req-${runId}`);
  await enrollInCourse(student.id, String(archivedCourse.id), `req-${runId}`);
  await OrganizationModel.updateOne({ _id: suspendedOrg.id }, { $set: { status: "suspended" } });
  await OrganizationModel.updateOne({ _id: archivedOrg.id }, { $set: { status: "archived" } });
  assert.deepEqual((await listCourseDiscovery(student.id, { limit: 20 })).items, []);
  assert.deepEqual(await listMyEnrollments(student.id), []);
  assert.deepEqual((await listManagedCourses(instructor.id)).items, []);
  await assert.rejects(getPublishedCourse(student.id, String(suspendedCourse.id)));
  await assert.rejects(enrollInCourse(student.id, String(archivedCourse.id), `req-${runId}`));
  await assert.rejects(accessLesson(student.id, String(suspendedCourse.id), String(suspendedLesson._id)));
});

test("lesson duration totals are recalculated transactionally after edits and deletions", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `duration-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const first = await createLesson(instructor.id, courseId, lessonInput("First", "One."), `req-${runId}`);
  const second = await createLesson(instructor.id, courseId, lessonInput("Second", "Two."), `req-${runId}`);
  assert.equal((await CourseModel.findById(courseId).select("estimatedDurationMinutes").lean())?.estimatedDurationMinutes, 16);
  await updateLesson(instructor.id, courseId, String(first._id), { ...lessonInput("First", "One."), estimatedDurationMinutes: 25 }, `req-${runId}`);
  assert.equal((await CourseModel.findById(courseId).select("estimatedDurationMinutes").lean())?.estimatedDurationMinutes, 33);
  await deleteLesson(instructor.id, courseId, String(second._id), `req-${runId}`);
  assert.equal((await CourseModel.findById(courseId).select("estimatedDurationMinutes").lean())?.estimatedDurationMinutes, 25);
});

test("lesson deletion removes only scoped progress, updates enrollment aggregates and course duration, and audits", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student"); const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `progress-cleanup-${counter}` }, `req-${runId}`); const courseId = new Types.ObjectId(String(course.id)); courseIds.push(courseId);
  const first = await createLesson(instructor.id, String(course.id), lessonInput("Remove me", "One."), `req-${runId}`);
  const keep = await createLesson(instructor.id, String(course.id), lessonInput("Keep me", "Two."), `req-${runId}`);
  const unrelatedCourse = await createCourse(instructor.id, org.id, { ...courseInput, slug: `progress-unrelated-${counter}` }, `req-${runId}`); const unrelatedCourseId = new Types.ObjectId(String(unrelatedCourse.id)); courseIds.push(unrelatedCourseId);
  const unrelatedLesson = await createLesson(instructor.id, String(unrelatedCourse.id), lessonInput("Other course", "Other."), `req-${runId}`);
  const enrollment = await EnrollmentModel.create({ tenantId: org._id, courseId, studentId: student._id, status: "active", progress: { completedLessons: 1, totalLessons: 2, percent: 50 } });
  const unrelatedEnrollment = await EnrollmentModel.create({ tenantId: org._id, courseId: unrelatedCourseId, studentId: student._id, status: "active", progress: { completedLessons: 0, totalLessons: 1, percent: 0 } });
  await LessonProgressModel.create([
    { tenantId: org._id, courseId, enrollmentId: enrollment._id, studentId: student._id, lessonId: first._id, isComplete: true, completedAt: new Date() },
    { tenantId: org._id, courseId, enrollmentId: enrollment._id, studentId: student._id, lessonId: keep._id, isComplete: false },
    { tenantId: org._id, courseId: unrelatedCourseId, enrollmentId: unrelatedEnrollment._id, studentId: student._id, lessonId: unrelatedLesson._id, isComplete: false },
  ]);
  await deleteLesson(instructor.id, String(course.id), String(first._id), `req-${runId}`);
  assert.equal(await LessonProgressModel.countDocuments({ enrollmentId: enrollment._id, lessonId: first._id }), 0);
  assert.equal(await LessonProgressModel.countDocuments({ enrollmentId: enrollment._id }), 1);
  assert.equal(await LessonProgressModel.countDocuments({ enrollmentId: unrelatedEnrollment._id }), 1);
  const updatedEnrollment = await EnrollmentModel.findById(enrollment._id).lean();
  assert.deepEqual(updatedEnrollment?.progress, { completedLessons: 0, totalLessons: 0, percent: 0 });
  assert.equal((await CourseModel.findById(courseId).lean())?.estimatedDurationMinutes, 8);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org._id, action: "course.lesson.deleted", resourceId: String(first._id) }), 1);
});

test("section CRUD, ordering and lesson movement preserve lesson identity and audit mutations", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `curriculum-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const firstSection = await createSection(instructor.id, courseId, { title: "Foundations", description: "Start here." }, `req-${runId}`);
  const secondSection = await createSection(instructor.id, courseId, { title: "Practice" }, `req-${runId}`);
  const lesson = await createLesson(instructor.id, courseId, { ...lessonInput("Origins", "Keep this ID."), sectionId: firstSection.id }, `req-${runId}`);
  const practice = await createLesson(instructor.id, courseId, { ...lessonInput("Practice lesson", "Practice."), sectionId: secondSection.id }, `req-${runId}`);
  const mutationVersionBeforeRejectedDelete = (await CourseModel.findById(courseId).select("+mutationVersion").lean())?.mutationVersion;
  await assert.rejects(deleteSection(instructor.id, courseId, firstSection.id, `req-${runId}`), /SECTION_NOT_EMPTY/);
  assert.equal((await CourseModel.findById(courseId).lean())?.sections.find((section) => String(section._id) === firstSection.id)?.title, "Foundations");
  assert.equal(String((await LessonModel.findById(lesson._id).lean())?.sectionId), firstSection.id);
  assert.equal((await CourseModel.findById(courseId).select("+mutationVersion").lean())?.mutationVersion, mutationVersionBeforeRejectedDelete);
  await updateSection(instructor.id, courseId, firstSection.id, { title: "Foundations updated", description: "Updated." }, `req-${runId}`);
  const reordered = await reorderSections(instructor.id, courseId, [secondSection.id, firstSection.id], `req-${runId}`);
  assert.deepEqual(reordered.map((section) => section.id), [secondSection.id, firstSection.id]);
  const moved = await moveLesson(instructor.id, courseId, String(lesson._id), secondSection.id, 0, `req-${runId}`);
  assert.equal(String(moved?.sectionId), secondSection.id);
  assert.equal(String(moved?._id), String(lesson._id));
  const lessonOrder = await reorderLessons(instructor.id, courseId, [String(lesson._id), String(practice._id)], `req-${runId}`);
  assert.deepEqual(lessonOrder.map((item) => String(item._id)), [String(lesson._id), String(practice._id)]);
  await deleteSection(instructor.id, courseId, firstSection.id, `req-${runId}`);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org._id, action: { $in: ["course.section.created", "course.section.updated", "course.sections.reordered", "course.lesson.moved", "course.lessons.reordered", "course.section.deleted"] } }), 7);
});

test("curriculum mutation rolls back when its audit event fails validation", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `curriculum-rollback-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const section = await createSection(instructor.id, courseId, { title: "Original title" }, `req-${runId}`);
  const before = await CourseModel.findById(courseId).select("+mutationVersion").lean();
  await assert.rejects(updateSection(instructor.id, courseId, section.id, { title: "Must roll back" }, "r".repeat(101)));
  const after = await CourseModel.findById(courseId).select("+mutationVersion").lean();
  assert.equal(after?.sections.find((item) => String(item._id) === section.id)?.title, "Original title");
  assert.equal(after?.mutationVersion, before?.mutationVersion);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org._id, action: "course.section.updated", resourceId: section.id }), 0);
});

test("curriculum writes serialize concurrent section creation and lesson reorder/move operations", async () => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `curriculum-race-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const [first, second] = await Promise.all([
    createSection(instructor.id, courseId, { title: "Concurrent A" }, `req-${runId}`),
    createSection(instructor.id, courseId, { title: "Concurrent B" }, `req-${runId}`),
  ]);
  const [third, fourth] = await Promise.all([
    createSection(instructor.id, courseId, { title: "Concurrent C" }, `req-${runId}`),
    createSection(instructor.id, courseId, { title: "Concurrent D" }, `req-${runId}`),
  ]);
  const lessons = await Promise.all([
    createLesson(instructor.id, courseId, { ...lessonInput("A", "A."), sectionId: first.id }, `req-${runId}`),
    createLesson(instructor.id, courseId, { ...lessonInput("B", "B."), sectionId: second.id }, `req-${runId}`),
  ]);
  await Promise.all([
    reorderLessons(instructor.id, courseId, [String(lessons[1]!._id), String(lessons[0]!._id)], `req-${runId}`),
    moveLesson(instructor.id, courseId, String(lessons[0]!._id), second.id, 0, `req-${runId}`),
  ]);
  const storedSections = (await CourseModel.findById(courseId).lean())!.sections;
  assert.deepEqual(storedSections.map((section) => section.position).sort((a, b) => a - b), [0, 1, 2, 3]);
  const storedLessons = await LessonModel.find({ courseId: new Types.ObjectId(courseId) }).sort({ position: 1 }).lean();
  assert.deepEqual(storedLessons.map((item) => item.position), [0, 1]);
  assert.equal(storedLessons.find((item) => item._id.equals(lessons[0]!._id))?.sectionId?.toString(), second.id);
  assert.ok([third.id, fourth.id].every((id) => storedSections.some((section) => String(section._id) === id)));
});

test("curriculum APIs enforce instructor, student, current-membership, course and tenant boundaries", async (context) => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const peerInstructor = await user("Peer instructor"); const student = await user("Student"); const outsider = await user("Outsider");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: peerInstructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const foreignOrg = await organization(outsider._id);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `curriculum-auth-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const section = await createSection(instructor.id, courseId, { title: "Owned section" }, `req-${runId}`);
  const lesson = await createLesson(instructor.id, courseId, { ...lessonInput("Owned lesson", "Private draft."), sectionId: section.id }, `req-${runId}`);
  const foreignCourse = await createCourse(outsider.id, foreignOrg.id, { ...courseInput, slug: `foreign-curriculum-${counter}` }, `req-${runId}`); courseIds.push(new Types.ObjectId(String(foreignCourse.id)));
  const foreignSection = await createSection(outsider.id, String(foreignCourse.id), { title: "Foreign section" }, `req-${runId}`);
  const foreignLesson = await createLesson(outsider.id, String(foreignCourse.id), lessonInput("Foreign lesson", "Other tenant."), `req-${runId}`);
  const api = await startApi(); context.after(async () => api.close());
  const sectionPath = `/instructor/courses/${courseId}/sections/${section.id}`;
  const lessonPath = `/instructor/courses/${courseId}/lessons/${lesson._id}`;
  assert.equal((await api.request(`/instructor/courses/${courseId}/sections`, peerInstructor.id, { method: "POST", body: { title: "No access" } })).status, 404);
  assert.equal((await api.request(sectionPath, peerInstructor.id, { method: "PATCH", body: { title: "No access" } })).status, 404);
  assert.equal((await api.request(sectionPath, peerInstructor.id, { method: "DELETE" })).status, 404);
  assert.equal((await api.request(`/instructor/courses/${courseId}/sections/order`, peerInstructor.id, { method: "PUT", body: { sectionIds: [section.id] } })).status, 404);
  assert.equal((await api.request(`${lessonPath}/move`, peerInstructor.id, { method: "PUT", body: { sectionId: null, position: 0 } })).status, 404);
  assert.equal((await api.request(`/instructor/courses/${courseId}/lessons/order`, peerInstructor.id, { method: "PUT", body: { lessonIds: [String(lesson._id)] } })).status, 404);
  assert.equal((await api.request(`/instructor/courses/${courseId}/sections`, student.id, { method: "POST", body: { title: "Student write" } })).status, 404);
  assert.equal((await api.request(sectionPath, student.id, { method: "PATCH", body: { title: "Student write" } })).status, 404);
  assert.equal((await api.request(lessonPath, student.id, { method: "PATCH", body: lessonInput("Student write", "No." ) })).status, 404);
  assert.equal((await api.request(sectionPath, instructor.id, { method: "PATCH", body: { title: "Foreign ID" } })).status, 200);
  assert.equal((await api.request(`/instructor/courses/${courseId}/sections/${foreignSection.id}`, instructor.id, { method: "PATCH", body: { title: "Cross-course ID" } })).status, 404);
  assert.equal((await api.request(`/instructor/courses/${courseId}/sections/order`, instructor.id, { method: "PUT", body: { sectionIds: [foreignSection.id] } })).status, 422);
  assert.equal((await api.request(`${lessonPath}/move`, instructor.id, { method: "PUT", body: { sectionId: foreignSection.id, position: 0 } })).status, 404);
  assert.equal((await api.request(`/instructor/courses/${courseId}/lessons/order`, instructor.id, { method: "PUT", body: { lessonIds: [String(foreignLesson._id)] } })).status, 422);
  await OrganizationMembershipModel.updateOne({ tenantId: org._id, userId: instructor._id }, { $set: { status: "suspended" } });
  assert.equal((await api.request(sectionPath, instructor.id, { method: "PATCH", body: { title: "Membership revoked" } })).status, 404);
});

test("students only receive published lesson metadata and must enroll before lesson content access", async (context) => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `published-content-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const section = await createSection(instructor.id, courseId, { title: "Published section" }, `req-${runId}`);
  const first = await createLesson(instructor.id, courseId, { ...lessonInput("Visible lesson", "Visible body."), sectionId: section.id }, `req-${runId}`);
  const second = await createLesson(instructor.id, courseId, { ...lessonInput("Hidden lesson", "Secret unpublished body."), sectionId: section.id }, `req-${runId}`);
  await publishCourse(instructor.id, courseId, `req-${runId}`);
  const api = await startApi(); context.after(async () => api.close());
  assert.equal((await api.request(`/courses/${courseId}/lessons/${first._id}`, student.id)).status, 403);
  await enrollInCourse(student.id, courseId, `req-${runId}`);
  await LessonModel.updateOne({ _id: second._id }, { $set: { status: "draft" } });
  const outline = await api.request(`/courses/${courseId}`, student.id);
  assert.deepEqual((outline.body as { data: { lessons: { id: string }[] } }).data.lessons.map((item) => item.id), [String(first._id)]);
  const hidden = await api.request(`/courses/${courseId}/lessons/${second._id}`, student.id);
  assert.equal(hidden.status, 404);
  assert.doesNotMatch(JSON.stringify(hidden.body), /Secret unpublished body/);
});

test("video completion requires server-credited playback and uploads fail closed without private storage", async (context) => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const peerInstructor = await user("Peer Instructor"); const student = await user("Student");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: peerInstructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `video-progress-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const lesson = await createLesson(instructor.id, courseId, { title: "Video", description: "", contentType: "video", contentData: { type: "video", source: "external", title: "Video", url: "https://cdn.example.test/video.mp4", durationSeconds: 60 }, resourceLinks: [], estimatedDurationMinutes: 1 }, `req-${runId}`);
  await publishCourse(instructor.id, courseId, `req-${runId}`);
  const enrollment = await enrollInCourse(student.id, courseId, `req-${runId}`);
  await assert.rejects(completeLesson(student.id, courseId, String(lesson._id), `req-${runId}`), /VIDEO_WATCH_THRESHOLD_NOT_MET/);
  await recordVideoProgress(student.id, courseId, String(lesson._id), 0);
  const fastForward = await recordVideoProgress(student.id, courseId, String(lesson._id), 60);
  assert.ok(fastForward.watchedSeconds < 54, "a client seek must not satisfy the video completion threshold");
  await assert.rejects(completeLesson(student.id, courseId, String(lesson._id), `req-${runId}`), /VIDEO_WATCH_THRESHOLD_NOT_MET/);
  const progress = await LessonProgressModel.findOne({ enrollmentId: enrollment.enrollment._id, lessonId: lesson._id });
  assert.ok(progress);
  progress.videoProgress = { watchedSeconds: 50, lastPositionSeconds: 50, lastHeartbeatAt: new Date(Date.now() - 40_000) };
  await progress.save();
  const credited = await recordVideoProgress(student.id, courseId, String(lesson._id), 60);
  assert.equal(credited.watchedSeconds, 60);
  await completeLesson(student.id, courseId, String(lesson._id), `req-${runId}`);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org._id, action: "course.lesson.completed", resourceId: String(lesson._id) }), 1);

  const uploadCourse = await createCourse(instructor.id, org.id, { ...courseInput, slug: `upload-grant-${counter}` }, `req-${runId}`); const uploadCourseId = String(uploadCourse.id); courseIds.push(new Types.ObjectId(uploadCourseId));
  const uploadLesson = await createLesson(instructor.id, uploadCourseId, { title: "PDF", description: "", contentType: "document", resourceLinks: [], estimatedDurationMinutes: 0 }, `req-${runId}`);
  const api = await startApi(); context.after(() => api.close());
  const uploadPath = `/instructor/courses/${uploadCourseId}/lessons/${uploadLesson._id}/media-upload-grants`;
  const body = { purpose: "document", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 1000 };
  assert.equal((await api.request(uploadPath, peerInstructor.id, { method: "POST", mfa: "fresh", body })).status, 404);
  assert.equal((await api.request(uploadPath, student.id, { method: "POST", mfa: "fresh", body })).status, 404);
  assert.equal((await api.request(uploadPath, instructor.id, { method: "POST", mfa: "fresh", body: { ...body, contentType: "text/html" } })).status, 400);
  const unavailable = await api.request(uploadPath, instructor.id, { method: "POST", mfa: "fresh", body });
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.body?.error?.code, "MEDIA_STORAGE_UNAVAILABLE");
});

test("media lifecycle mock-provider integration verifies tenant binding, lesson attachment, transactions, delivery and deletion", async (context) => {
  const provider = new IntegrationMediaProvider(); setPrivateAssetStorageProvider(provider); context.after(() => setPrivateAssetStorageProvider(new UnconfiguredPrivateAssetStorage()));
  const owner = await user("Media Owner"); const instructor = await user("Media Instructor"); const peer = await user("Media Peer"); const student = await user("Media Student"); const outsider = await user("Media Outsider");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: peer._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }]);
  const otherOrg = await organization(outsider._id);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `media-course-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const lesson = await createLesson(instructor.id, courseId, { title: "Private PDF", description: "", contentType: "document", resourceLinks: [], estimatedDurationMinutes: 0 }, `req-${runId}`);
  const input = { lessonId: String(lesson._id), purpose: "document" as const, fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: Buffer.byteLength("%PDF-1.7 test") };
  await assert.rejects(createLessonMediaUploadGrant(peer.id, courseId, input, `req-${runId}`), /NOT_FOUND/);
  await assert.rejects(createLessonMediaUploadGrant(student.id, courseId, input, `req-${runId}`), /NOT_FOUND/);
  await assert.rejects(createLessonMediaUploadGrant(outsider.id, courseId, input, `req-${runId}`), /NOT_FOUND/);
  const grant = await createLessonMediaUploadGrant(instructor.id, courseId, input, `req-${runId}`);
  assert.equal(grant.intentId.length, 24);
  assert.doesNotMatch(JSON.stringify(grant), /api_secret|api_key|cloud_name/);
  const intent = await MediaUploadIntentModel.findById(grant.intentId).lean(); assert.equal(intent?.tenantId.toString(), org.id);
  provider.reuseAssetId = true;
  const bytes = Buffer.from("%PDF-1.7 test");
  const uploaded = await uploadAndVerifyLessonMedia(instructor.id, courseId, String(lesson._id), grant.intentId, Readable.from([bytes]), bytes.length, "application/pdf", `req-${runId}`);
  const asset = await MediaAssetModel.findById(uploaded.asset.id).lean();
  assert.equal(asset?.tenantId.toString(), org.id); assert.equal(asset?.courseId.toString(), courseId); assert.equal(asset?.lessonId.toString(), String(lesson._id));
  assert.equal(asset?.state, "ready"); assert.equal((await LessonModel.findById(lesson._id).lean())?.contentData?.assetId, uploaded.asset.id);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org.id, action: "course.media.verified", resourceId: uploaded.asset.id }), 1);

  const secondLesson = await createLesson(instructor.id, courseId, { title: "Rollback PDF", description: "", contentType: "document", resourceLinks: [], estimatedDurationMinutes: 0 }, `req-${runId}`);
  const secondInput = { ...input, lessonId: String(secondLesson._id), fileName: "rollback.pdf" };
  const secondGrant = await createLessonMediaUploadGrant(instructor.id, courseId, secondInput, `req-${runId}`);
  await assert.rejects(uploadAndVerifyLessonMedia(instructor.id, courseId, String(secondLesson._id), secondGrant.intentId, Readable.from([bytes]), bytes.length, "application/pdf", `req-${runId}`));
  assert.equal((await LessonModel.findById(secondLesson._id).lean())?.contentData, undefined);
  assert.equal(await MediaAssetModel.countDocuments({ tenantId: org.id, courseId: new Types.ObjectId(courseId) }), 1);
  assert.equal((await MediaUploadIntentModel.findById(secondGrant.intentId).lean())?.state, "failed");
  assert.equal(provider.deletions.length, 1);
  await deleteLesson(instructor.id, courseId, String(secondLesson._id), `req-${runId}`);

  await publishCourse(instructor.id, courseId, `req-${runId}`);
  await assert.rejects(createStudentMediaAccess(student.id, courseId, String(lesson._id), uploaded.asset.id), /ENROLLMENT_REQUIRED/);
  await enrollInCourse(student.id, courseId, `req-${runId}`);
  const delivery = await createStudentMediaAccess(student.id, courseId, String(lesson._id), uploaded.asset.id, "inline");
  assert.match(delivery.url, /raw\/inline/); assert.ok(Date.parse(delivery.expiresAt) > Date.now());
  await OrganizationMembershipModel.updateOne({ tenantId: org.id, userId: student._id }, { $set: { status: "suspended" } });
  await assert.rejects(createStudentMediaAccess(student.id, courseId, String(lesson._id), uploaded.asset.id));

  const deleteCourse = await createCourse(instructor.id, org.id, { ...courseInput, slug: `media-delete-${counter}` }, `req-${runId}`); const deleteCourseId = String(deleteCourse.id); courseIds.push(new Types.ObjectId(deleteCourseId));
  const lessonToDelete = await createLesson(instructor.id, deleteCourseId, { title: "Delete PDF", description: "", contentType: "document", resourceLinks: [], estimatedDurationMinutes: 0 }, `req-${runId}`);
  provider.reuseAssetId = false;
  const deleteGrant = await createLessonMediaUploadGrant(instructor.id, deleteCourseId, { ...input, lessonId: String(lessonToDelete._id) }, `req-${runId}`);
  const deleteUpload = await uploadAndVerifyLessonMedia(instructor.id, deleteCourseId, String(lessonToDelete._id), deleteGrant.intentId, Readable.from([bytes]), bytes.length, "application/pdf", `req-${runId}`);
  await deleteLessonMediaAsset(instructor.id, deleteCourseId, String(lessonToDelete._id), deleteUpload.asset.id, `req-${runId}`);
  assert.equal((await MediaAssetModel.findById(deleteUpload.asset.id).lean())?.state, "deleted");
  assert.equal(await AuditEventModel.countDocuments({ tenantId: org.id, action: "course.media.deleted", resourceId: deleteUpload.asset.id }), 1);
  assert.equal(await MediaAssetModel.countDocuments({ tenantId: otherOrg.id }), 0);
});

test("course routes enforce MFA and prevent another instructor or organization accessing the owner's course", async (context) => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const otherInstructor = await user("Other Instructor"); const outsider = await user("Outsider");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: otherInstructor._id, roles: ["INSTRUCTOR"] }]);
  await organization(outsider._id);
  await UserCredentialModel.create({ userId: owner._id, passwordHash: "test-hash", passwordChangedAt: new Date(), mfaEnabled: true, totpSecretEncrypted: "test-encrypted-secret" });
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `route-auth-${counter}` }, `req-${runId}`); courseIds.push(new Types.ObjectId(String(course.id)));
  const api = await startApi(); context.after(async () => api.close());
  assert.equal((await api.request(`/instructor/courses/${course.id}`, owner.id, { mfa: "none" })).status, 403);
  assert.equal((await api.request(`/instructor/courses/${course.id}`, owner.id, { mfa: "fresh" })).status, 200);
  assert.equal((await api.request(`/instructor/courses/${course.id}`, owner.id, { mfa: "stale" })).status, 200);
  assert.equal((await api.request(`/instructor/courses/${course.id}`, owner.id, { mfa: "expired" })).status, 403);
  const denied = await api.request(`/instructor/courses/${course.id}`, otherInstructor.id);
  assert.equal(denied.status, 404);
  const updateDenied = await api.request(`/instructor/courses/${course.id}`, otherInstructor.id, { method: "PATCH", body: { title: "Unauthorized change" } });
  assert.equal(updateDenied.status, 404);
  assert.equal((await api.request(`/courses/${course.id}`, outsider.id)).status, 404);
  const adminWriteWithoutMfa = await api.request(`/instructor/courses/${course.id}`, owner.id, { method: "PATCH", body: { title: "Admin change" }, mfa: "stale" });
  assert.equal(adminWriteWithoutMfa.status, 403);
  const adminWriteWithMfa = await api.request(`/instructor/courses/${course.id}`, owner.id, { method: "PATCH", body: { title: "Admin change" }, mfa: "fresh" });
  assert.equal(adminWriteWithMfa.status, 200);
  assert.equal((await CourseModel.findById(course.id).select("title").lean())?.title, "Admin change");
});

test("course API safely serializes concurrent enrollments and lesson completions", async (context) => {
  const owner = await user("Owner"); const instructor = await user("Instructor"); const student = await user("Student"); const otherStudent = await user("Other Student");
  const org = await organization(owner._id, [{ userId: instructor._id, roles: ["INSTRUCTOR"] }, { userId: student._id, roles: ["STUDENT"] }, { userId: otherStudent._id, roles: ["STUDENT"] }]);
  const course = await createCourse(instructor.id, org.id, { ...courseInput, slug: `concurrent-${counter}` }, `req-${runId}`); const courseId = String(course.id); courseIds.push(new Types.ObjectId(courseId));
  const first = await createLesson(instructor.id, courseId, lessonInput("First", "One."), `req-${runId}`);
  const second = await createLesson(instructor.id, courseId, lessonInput("Second", "Two."), `req-${runId}`);
  await publishCourse(instructor.id, courseId, `req-${runId}`);
  const api = await startApi(); context.after(async () => api.close());
  const enrollResponses = await Promise.all([api.request(`/courses/${courseId}/enrollments`, student.id, { method: "POST" }), api.request(`/courses/${courseId}/enrollments`, student.id, { method: "POST" })]);
  assert.ok(enrollResponses.every((response) => response.status === 200 || response.status === 201));
  assert.equal(await EnrollmentModel.countDocuments({ tenantId: org.id, courseId: new Types.ObjectId(courseId), studentId: student._id }), 1);
  const enrollmentList = (await api.request("/users/me/enrollments", student.id)).body as { data: { enrollments: { enrollment: { id: string } }[] } };
  const enrollmentId = enrollmentList.data.enrollments[0]!.enrollment.id;
  assert.equal((await api.request(`/users/me/enrollments/${enrollmentId}`, otherStudent.id)).status, 404);
  assert.equal((await api.request(`/courses/${courseId}/lessons/${first._id}/progress`, otherStudent.id, { method: "PUT" })).status, 403);
  assert.equal(await LessonProgressModel.countDocuments({ enrollmentId: new Types.ObjectId(enrollmentId) }), 0);
  const completionResponses = await Promise.all([first, second].map((lesson) => api.request(`/courses/${courseId}/lessons/${lesson._id}/progress`, student.id, { method: "PUT" })));
  assert.ok(completionResponses.every((response) => response.status === 200));
  const final = await api.request(`/users/me/enrollments/${enrollmentId}`, student.id);
  const finalBody = final.body as { data: { enrollment: { progress: { completedLessons: number; totalLessons: number; percent: number }; status: string } } };
  assert.equal(finalBody.data.enrollment.progress.completedLessons, 2);
  assert.equal(finalBody.data.enrollment.progress.totalLessons, 2);
  assert.equal(finalBody.data.enrollment.progress.percent, 100);
  assert.equal(finalBody.data.enrollment.status, "completed");
  assert.equal(await LessonProgressModel.countDocuments({ enrollmentId: new Types.ObjectId(enrollmentId) }), 2);
});
