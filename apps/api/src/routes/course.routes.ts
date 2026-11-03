import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { courseController as controller } from "../controllers/course.controller.js";
import { requireOrganizationPermission } from "../middleware/organization-authorization.middleware.js";
import { requireManagedCourse, requireManagedCourseList } from "../middleware/course-authorization.middleware.js";
import { createCourseSchema, createLessonSchema, cursorQuerySchema, discoveryQuerySchema, lessonMoveSchema, lessonOrderSchema, lessonSchema, sectionOrderSchema, sectionSchema, updateCourseSchema, updateSectionSchema, videoProgressSchema } from "../validators/course.validators.js";
import { uploadGrantSchema } from "../validators/media.validators.js";
import { createAuthenticatedRouter } from "./authenticated.router.js";

function validateBody(schema: { safeParse: (input: unknown) => { success: true; data: unknown } | { success: false } }) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request input is invalid." } }); return; }
    req.body = parsed.data; next();
  };
}
function validateQuery(schema: { safeParse: (input: unknown) => { success: true; data: unknown } | { success: false } }, handler: import("express").RequestHandler) {
  return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request input is invalid." } }); return; }
    req.query = parsed.data as unknown as typeof req.query; handler(req, res, next);
  };
}
export function createCourseRouter(config: AppConfig) {
  const router: Router = createAuthenticatedRouter(config);
  router.post("/organizations/:organizationId/courses", requireOrganizationPermission("course.create", config), validateBody(createCourseSchema), controller.create);
  router.get("/instructor/courses", requireManagedCourseList(config), validateQuery(cursorQuerySchema, controller.managedList));
  router.get("/instructor/courses/:courseId", requireManagedCourse(config), controller.managedGet);
  router.patch("/instructor/courses/:courseId", requireManagedCourse(config, true), validateBody(updateCourseSchema), controller.update);
  router.post("/instructor/courses/:courseId/publish", requireManagedCourse(config, true), controller.publish);
  router.post("/instructor/courses/:courseId/archive", requireManagedCourse(config, true), controller.archive);
  router.get("/instructor/courses/:courseId/lessons", requireManagedCourse(config), controller.lessons);
  router.post("/instructor/courses/:courseId/lessons/:lessonId/media-upload-grants", requireManagedCourse(config, true), validateBody(uploadGrantSchema), controller.createLessonAssetUploadGrant);
  router.put("/instructor/courses/:courseId/lessons/:lessonId/media-upload-intents/:intentId/content", requireManagedCourse(config, true), controller.uploadLessonAsset);
  router.delete("/instructor/courses/:courseId/lessons/:lessonId/media-assets/:assetId", requireManagedCourse(config, true), controller.deleteLessonAsset);
  router.post("/instructor/courses/:courseId/sections", requireManagedCourse(config, true), validateBody(sectionSchema), controller.createSection);
  router.patch("/instructor/courses/:courseId/sections/:sectionId", requireManagedCourse(config, true), validateBody(updateSectionSchema), controller.updateSection);
  router.delete("/instructor/courses/:courseId/sections/:sectionId", requireManagedCourse(config, true), controller.deleteSection);
  router.put("/instructor/courses/:courseId/sections/order", requireManagedCourse(config, true), validateBody(sectionOrderSchema), controller.reorderSections);
  router.post("/instructor/courses/:courseId/lessons", requireManagedCourse(config, true), validateBody(createLessonSchema), controller.createLesson);
  router.put("/instructor/courses/:courseId/lessons/:lessonId/move", requireManagedCourse(config, true), validateBody(lessonMoveSchema), controller.moveLesson);
  router.put("/instructor/courses/:courseId/lessons/order", requireManagedCourse(config, true), validateBody(lessonOrderSchema), controller.reorderLessons);
  router.patch("/instructor/courses/:courseId/lessons/:lessonId", requireManagedCourse(config, true), validateBody(lessonSchema), controller.updateLesson);
  router.delete("/instructor/courses/:courseId/lessons/:lessonId", requireManagedCourse(config, true), controller.deleteLesson);
  router.get("/courses", validateQuery(discoveryQuerySchema, controller.discovery));
  router.get("/courses/:courseId", controller.detail);
  router.post("/courses/:courseId/enrollments", controller.enroll);
  router.get("/users/me/enrollments", controller.enrollments);
  router.get("/users/me/enrollments/:enrollmentId", controller.enrollment);
  router.get("/courses/:courseId/lessons/:lessonId", controller.lesson);
  router.get("/courses/:courseId/lessons/:lessonId/media-assets/:assetId/access", controller.studentMediaAccess);
  router.put("/courses/:courseId/lessons/:lessonId/video-progress", validateBody(videoProgressSchema), controller.videoProgress);
  router.put("/courses/:courseId/lessons/:lessonId/progress", controller.complete);
  return router;
}
