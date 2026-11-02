import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { CourseError, archiveCourse, accessLesson, completeLesson, createCourse, createLesson, deleteLesson, enrollInCourse, getManagedCourse, getMyEnrollment, getPublishedCourse, listCourseDiscovery, listManagedCourses, listManagedLessons, listMyEnrollments, publishCourse, reorderLessons, updateCourse, updateLesson } from "../services/course.service.js";

function requestId(request: Request) { return request.auditRequestId ?? randomUUID(); }
function fail(error: unknown, response: Response, next: NextFunction) {
  if (error instanceof CourseError) {
    response.status(error.status).json({ error: { code: error.code, message: error.status === 404 ? "The requested resource was not found." : error.status === 403 ? "Access is not permitted." : error.status === 422 || error.status === 400 ? "Request input is invalid." : "The requested operation could not be completed." } });
    return;
  }
  next(error);
}
export const courseController = {
  create: async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ data: { course: await createCourse(req.authContext!.userId, String(req.params.organizationId), req.body, requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  managedList: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await listManagedCourses(req.authContext!.userId, req.query.cursor as string | undefined, Number(req.query.limit ?? 12)) }); } catch (error) { fail(error, res, next); } },
  managedGet: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await getManagedCourse(req.authContext!.userId, String(req.params.courseId)) }); } catch (error) { fail(error, res, next); } },
  update: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { course: await updateCourse(req.authContext!.userId, String(req.params.courseId), req.body, requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  publish: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { course: await publishCourse(req.authContext!.userId, String(req.params.courseId), requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  archive: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { course: await archiveCourse(req.authContext!.userId, String(req.params.courseId), requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  lessons: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { lessons: await listManagedLessons(req.authContext!.userId, String(req.params.courseId)) } }); } catch (error) { fail(error, res, next); } },
  createLesson: async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ data: { lesson: await createLesson(req.authContext!.userId, String(req.params.courseId), req.body, requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  updateLesson: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { lesson: await updateLesson(req.authContext!.userId, String(req.params.courseId), String(req.params.lessonId), req.body, requestId(req)) } }); } catch (error) { fail(error, res, next); } },
  deleteLesson: async (req: Request, res: Response, next: NextFunction) => { try { await deleteLesson(req.authContext!.userId, String(req.params.courseId), String(req.params.lessonId), requestId(req)); res.status(204).end(); } catch (error) { fail(error, res, next); } },
  reorderLessons: async (req: Request, res: Response, next: NextFunction) => { try { const lessons = await reorderLessons(req.authContext!.userId, String(req.params.courseId), req.body.lessonIds, requestId(req)); res.json({ data: { lessons } }); } catch (error) { fail(error, res, next); } },
  discovery: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await listCourseDiscovery(req.authContext!.userId, { ...req.query, limit: Number(req.query.limit ?? 12) } as never) }); } catch (error) { fail(error, res, next); } },
  detail: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await getPublishedCourse(req.authContext!.userId, String(req.params.courseId)) }); } catch (error) { fail(error, res, next); } },
  enroll: async (req: Request, res: Response, next: NextFunction) => { try { const result = await enrollInCourse(req.authContext!.userId, String(req.params.courseId), requestId(req)); res.status(result.created ? 201 : 200).json({ data: result }); } catch (error) { fail(error, res, next); } },
  enrollments: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { enrollments: await listMyEnrollments(req.authContext!.userId) } }); } catch (error) { fail(error, res, next); } },
  enrollment: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await getMyEnrollment(req.authContext!.userId, String(req.params.enrollmentId)) }); } catch (error) { fail(error, res, next); } },
  lesson: async (req: Request, res: Response, next: NextFunction) => { try { const lesson = await accessLesson(req.authContext!.userId, String(req.params.courseId), String(req.params.lessonId)); res.json({ data: { lesson: { id: lesson._id.toString(), title: lesson.title, description: lesson.description, contentType: lesson.contentType, content: lesson.content, externalUrl: lesson.externalUrl, resourceLinks: lesson.resourceLinks, estimatedDurationMinutes: lesson.estimatedDurationMinutes, position: lesson.position } } }); } catch (error) { fail(error, res, next); } },
  complete: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await completeLesson(req.authContext!.userId, String(req.params.courseId), String(req.params.lessonId), requestId(req)) }); } catch (error) { fail(error, res, next); } },
};
