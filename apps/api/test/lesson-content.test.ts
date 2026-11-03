import assert from "node:assert/strict";
import test from "node:test";
import { contentMatchesType, lessonContentSchema } from "../src/validators/lesson-content.validators.js";
import { createLessonSchema, videoProgressSchema } from "../src/validators/course.validators.js";
import { uploadGrantSchema } from "../src/validators/media.validators.js";

const validText = { type: "text", blocks: [
  { type: "heading", level: 2, text: "Key idea" },
  { type: "paragraph", text: "A safe paragraph." },
  { type: "bulleted_list", items: ["First", "Second"] },
  { type: "numbered_list", items: ["Step one"] },
  { type: "code", language: "ts", code: "const safe = true;" },
  { type: "link", title: "Documentation", url: "https://example.com/docs" },
] };

test("discriminated rich text supports validated headings, paragraphs, lists, code and safe links", () => {
  assert.equal(lessonContentSchema.safeParse(validText).success, true);
  assert.equal(lessonContentSchema.safeParse({ ...validText, arbitrary: true }).success, false);
  assert.equal(lessonContentSchema.safeParse({ type: "text", blocks: [{ type: "link", title: "unsafe", url: "javascript:alert(1)" }] }).success, false);
  assert.equal(lessonContentSchema.safeParse({ type: "text", blocks: [{ type: "heading", level: 1, text: "Unsupported" }] }).success, false);
});

test("content type must match its discriminated content and client cannot claim private assets", () => {
  assert.equal(contentMatchesType("text", lessonContentSchema.parse(validText)), true);
  assert.equal(contentMatchesType("external_link", lessonContentSchema.parse(validText)), false);
  const input = { title: "PDF", description: "", contentType: "document", contentData: { type: "document", assetId: "a".repeat(24), fileName: "lesson.pdf", mimeType: "application/pdf", sizeBytes: 1024 }, resourceLinks: [], estimatedDurationMinutes: 5 };
  assert.equal(createLessonSchema.safeParse(input).success, false);
});

test("video metadata and server heartbeat input are bounded", () => {
  assert.equal(lessonContentSchema.safeParse({ type: "video", source: "external", title: "Lecture", url: "https://cdn.example.com/lecture.mp4", durationSeconds: 120 }).success, true);
  assert.equal(lessonContentSchema.safeParse({ type: "video", source: "external", title: "Lecture", url: "http://example.com/lecture.mp4", durationSeconds: 120 }).success, false);
  assert.equal(videoProgressSchema.safeParse({ positionSeconds: 12.5 }).success, true);
  assert.equal(videoProgressSchema.safeParse({ positionSeconds: 90000 }).success, false);
  assert.equal(createLessonSchema.safeParse({ title: "Link", description: "", contentType: "external_video", externalUrl: "https://user:secret@example.com/video.mp4", resourceLinks: [], estimatedDurationMinutes: 1 }).success, false);
});

test("upload grants enforce matching MIME types, path-safe names and per-type size limits", () => {
  assert.equal(uploadGrantSchema.safeParse({ purpose: "document", fileName: "lesson.pdf", contentType: "application/pdf", sizeBytes: 1024 }).success, true);
  assert.equal(uploadGrantSchema.safeParse({ purpose: "document", fileName: "lesson.pdf", contentType: "text/html", sizeBytes: 1024 }).success, false);
  assert.equal(uploadGrantSchema.safeParse({ purpose: "document", fileName: "..\\secret.pdf", contentType: "application/pdf", sizeBytes: 1024 }).success, false);
  assert.equal(uploadGrantSchema.safeParse({ purpose: "document", fileName: "large.pdf", contentType: "application/pdf", sizeBytes: 10 * 1000 * 1000 + 1 }).success, false);
  assert.equal(uploadGrantSchema.safeParse({ purpose: "video", fileName: "large.mp4", contentType: "video/mp4", sizeBytes: 100 * 1000 * 1000 }).success, true);
  assert.equal(uploadGrantSchema.safeParse({ purpose: "video", fileName: "too-large.mp4", contentType: "video/mp4", sizeBytes: 100 * 1000 * 1000 + 1 }).success, false);
});
