import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { courseController as controller } from "../controllers/course.controller.js";
import { requireOrganizationPermission } from "../middleware/organization-authorization.middleware.js";
import { requireManagedCourse, requireManagedCourseList } from "../middleware/course-authorization.middleware.js";
import { createCourseSchema, cursorQuerySchema, discoveryQuerySchema, lessonOrderSchema, lessonSchema, updateCourseSchema } from "../validators/course.validators.js";
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
  router.post("/instructor/courses/:courseId/lessons", requireManagedCourse(config, true), validateBody(lessonSchema), controller.createLesson);
  router.put("/instructor/courses/:courseId/lessons/order", requireManagedCourse(config, true), validateBody(lessonOrderSchema), controller.reorderLessons);
  router.patch("/instructor/courses/:courseId/lessons/:lessonId", requireManagedCourse(config, true), validateBody(lessonSchema), controller.updateLesson);
  router.delete("/instructor/courses/:courseId/lessons/:lessonId", requireManagedCourse(config, true), controller.deleteLesson);
  router.get("/courses", validateQuery(discoveryQuerySchema, controller.discovery));
  router.get("/courses/:courseId", controller.detail);
  router.post("/courses/:courseId/enrollments", controller.enroll);
  router.get("/users/me/enrollments", controller.enrollments);
  router.get("/users/me/enrollments/:enrollmentId", controller.enrollment);
  router.get("/courses/:courseId/lessons/:lessonId", controller.lesson);
  router.put("/courses/:courseId/lessons/:lessonId/progress", controller.complete);
  return router;
}
