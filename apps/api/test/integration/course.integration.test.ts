import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import test, { after, afterEach, before } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { AuditEventModel } from "../../src/models/audit-event.model.js";
import { CourseModel } from "../../src/models/course.model.js";
import { EnrollmentModel } from "../../src/models/enrollment.model.js";
import { LessonModel } from "../../src/models/lesson.model.js";
import { LessonProgressModel } from "../../src/models/lesson-progress.model.js";
import { OrganizationMembershipModel } from "../../src/models/organization-membership.model.js";
import { OrganizationModel } from "../../src/models/organization.model.js";
import { UserModel } from "../../src/models/user.model.js";
import { UserCredentialModel } from "../../src/models/user-credential.model.js";
import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config/env.js";
import { sha256 } from "../../src/services/session.service.js";
import { accessLesson, archiveCourse, completeLesson, createCourse, createLesson, deleteLesson, enrollInCourse, getMyEnrollment, getPublishedCourse, listCourseDiscovery, listManagedCourses, listMyEnrollments, publishCourse, updateLesson } from "../../src/services/course.service.js";

const uri = process.env.LMS_INTEGRATION_MONGODB_URI;
if (!uri) throw new Error("LMS_INTEGRATION_MONGODB_URI must explicitly point to the isolated test replica set.");
const parsed = new URL(uri);
if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") || parsed.pathname.replace(/^\//, "").split("/")[0] !== "learnsphere_phase2_test" || parsed.searchParams.get("replicaSet") !== "rs0") throw new Error("Integration tests only permit the local learnsphere_phase2_test replica set.");
const runId = randomUUID(); const userIds: Types.ObjectId[] = []; const orgIds: Types.ObjectId[] = []; const courseIds: Types.ObjectId[] = [];
const csrfToken = "a".repeat(40);
const testConfig = loadConfig({ NODE_ENV: "test", MONGODB_URI: uri, WEB_ORIGIN: "http://localhost:5173", MFA_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64url") });
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
  await Promise.all([UserModel.createIndexes(), UserCredentialModel.createIndexes(), OrganizationModel.createIndexes(), OrganizationMembershipModel.createIndexes(), CourseModel.createIndexes(), LessonModel.createIndexes(), EnrollmentModel.createIndexes(), LessonProgressModel.createIndexes(), AuditEventModel.createIndexes()]);
});
afterEach(async () => {
  if (orgIds.length) await Promise.all([OrganizationMembershipModel.deleteMany({ tenantId: { $in: orgIds } }), OrganizationModel.deleteMany({ _id: { $in: orgIds } })]);
  if (courseIds.length) await Promise.all([CourseModel.deleteMany({ _id: { $in: courseIds } }), LessonModel.deleteMany({ courseId: { $in: courseIds } }), EnrollmentModel.deleteMany({ courseId: { $in: courseIds } }), LessonProgressModel.deleteMany({ courseId: { $in: courseIds } })]);
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
