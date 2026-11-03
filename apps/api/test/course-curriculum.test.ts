import assert from "node:assert/strict";
import test from "node:test";
import { createLessonSchema, lessonMoveSchema, sectionOrderSchema, sectionSchema, updateSectionSchema } from "../src/validators/course.validators.js";

test("section inputs trim labels and apply the empty description default", () => {
  assert.deepEqual(sectionSchema.parse({ title: "  Foundations  " }), { title: "Foundations", description: "" });
  assert.equal(sectionSchema.safeParse({ title: "   " }).success, false);
  assert.equal(updateSectionSchema.safeParse({}).success, false);
});

test("section ordering requires distinct stable IDs", () => {
  const validId = "a".repeat(24);
  assert.equal(sectionOrderSchema.safeParse({ sectionIds: [validId] }).success, true);
  assert.equal(sectionOrderSchema.safeParse({ sectionIds: [validId, validId] }).success, false);
  assert.equal(sectionOrderSchema.safeParse({ sectionIds: ["bad"] }).success, false);
});

test("lesson movement accepts a nullable section and a bounded target position", () => {
  const validId = "b".repeat(24);
  assert.equal(lessonMoveSchema.safeParse({ sectionId: null, position: 0 }).success, true);
  assert.equal(lessonMoveSchema.safeParse({ sectionId: validId, position: 199 }).success, true);
  assert.equal(lessonMoveSchema.safeParse({ sectionId: validId, position: 200 }).success, false);
  assert.equal(lessonMoveSchema.safeParse({ sectionId: "unknown", position: 0 }).success, false);
});

test("lesson creation may reference only a well-formed section ID", () => {
  const lesson = { title: "Lesson", description: "", contentType: "text", content: "Body", resourceLinks: [], estimatedDurationMinutes: 10 };
  assert.equal(createLessonSchema.safeParse({ ...lesson, sectionId: "c".repeat(24) }).success, true);
  assert.equal(createLessonSchema.safeParse({ ...lesson, sectionId: "wrong" }).success, false);
  assert.equal(createLessonSchema.safeParse({ ...lesson, sectionId: "d".repeat(24), unexpected: true }).success, false);
});
