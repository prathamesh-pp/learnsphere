import { z } from "zod";
import { COURSE_DIFFICULTIES } from "../models/course.model.js";
import { contentMatchesType, isStorageBackedContent, lessonContentSchema, lessonContentTypeSchema } from "./lesson-content.validators.js";

const httpsUrl = z.url().max(2048).refine((value) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; } });
const list = (maxItems: number) => z.array(z.string().trim().min(1).max(240)).max(maxItems);
export const createCourseSchema = z.object({
  title: z.string().trim().min(1).max(160), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  shortDescription: z.string().trim().min(1).max(280), description: z.string().trim().min(1).max(20000),
  learningObjectives: list(20).default([]), prerequisites: list(20).default([]), category: z.string().trim().min(1).max(80),
  difficulty: z.enum(COURSE_DIFFICULTIES), language: z.string().trim().min(2).max(16).default("en"),
  thumbnailReference: httpsUrl.optional(), estimatedDurationMinutes: z.number().int().min(0).max(100000).default(0), tags: list(20).default([]),
}).strict();
export const updateCourseSchema = createCourseSchema.partial().strict().refine((input) => Object.keys(input).length > 0);
const lessonFields = z.object({
  title: z.string().trim().min(1).max(160), description: z.string().trim().max(1000).default(""),
  contentType: lessonContentTypeSchema, contentData: lessonContentSchema.optional(), content: z.string().max(100000).optional(), externalUrl: httpsUrl.optional(),
  resourceLinks: z.array(z.object({ title: z.string().trim().min(1).max(120), url: httpsUrl }).strict()).max(10).default([]),
  estimatedDurationMinutes: z.number().int().min(0).max(10000).default(0),
}).strict().superRefine((input, context) => {
  if (input.contentData && !contentMatchesType(input.contentType, input.contentData)) context.addIssue({ code: "custom", path: ["contentData"], message: "Lesson content does not match its content type." });
  if (input.contentData && JSON.stringify(input.contentData).length > 100000) context.addIssue({ code: "custom", path: ["contentData"], message: "Lesson content exceeds 100,000 characters." });
  if (input.contentData && isStorageBackedContent(input.contentData)) context.addIssue({ code: "custom", path: ["contentData"], message: "Private file uploads are unavailable until media storage is configured." });
  if (input.contentType === "text" && !input.contentData && !input.content?.trim()) context.addIssue({ code: "custom", path: ["content"], message: "Text lessons require content." });
  if (input.contentType === "external_link" && !input.contentData) context.addIssue({ code: "custom", path: ["contentData"], message: "External links require a title, description and HTTPS URL." });
  if (input.contentType === "external_video" && !input.contentData && !input.externalUrl) context.addIssue({ code: "custom", path: ["externalUrl"], message: "External video lessons require an HTTPS URL." });
  if (input.contentType === "resources" && !input.contentData && input.resourceLinks.length === 0) context.addIssue({ code: "custom", path: ["resourceLinks"], message: "Add at least one resource link." });
});
export const lessonSchema = lessonFields;
export const createLessonSchema = lessonFields.extend({ sectionId: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional() }).strict();
const sectionFields = z.object({ title: z.string().trim().min(1).max(160), description: z.string().trim().max(1000) }).strict();
export const sectionSchema = sectionFields.extend({ description: sectionFields.shape.description.default("") });
export const updateSectionSchema = sectionFields.partial().strict().refine((input) => Object.keys(input).length > 0);
export const sectionOrderSchema = z.object({ sectionIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(100).refine((ids) => new Set(ids).size === ids.length) }).strict();
export const lessonMoveSchema = z.object({ sectionId: z.string().regex(/^[a-f\d]{24}$/i).nullable(), position: z.number().int().min(0).max(199) }).strict();
export const videoProgressSchema = z.object({ positionSeconds: z.number().finite().min(0).max(86400) }).strict();
export const lessonOrderSchema = z.object({ lessonIds: z.array(z.string().regex(/^[a-f\d]{24}$/i)).min(1).max(200).refine((ids) => new Set(ids).size === ids.length) }).strict();
export const discoveryQuerySchema = z.object({ q: z.string().trim().max(100).optional(), category: z.string().trim().max(80).optional(), difficulty: z.enum(COURSE_DIFFICULTIES).optional(), cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(50).default(12) }).strict();
export const cursorQuerySchema = z.object({ cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(50).default(12) }).strict();
