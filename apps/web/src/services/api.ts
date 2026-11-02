import { createApi, fetchBaseQuery, type BaseQueryApi, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from "@reduxjs/toolkit/query/react";
import { sessionExpired, sessionRestored } from "../features/auth/sessionSlice";

const rawBaseQuery = fetchBaseQuery({ baseUrl: import.meta.env.VITE_API_BASE_URL ?? "http://localhost:4000/api/v1", credentials: "include" });
export function createSessionAwareBaseQuery(rawQuery: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>, onUnauthorized: (api: BaseQueryApi) => void, onSessionRestored: (api: BaseQueryApi) => void = () => undefined): BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> {
  let expiryHandled = false;
  const inspect = (result: Awaited<ReturnType<typeof rawQuery>>, api: BaseQueryApi, skipSessionExpiry: boolean, restoreSession = false) => {
    if (restoreSession && !result.error) { expiryHandled = false; onSessionRestored(api); }
    if (!skipSessionExpiry && result.error?.status === 401 && !expiryHandled) { expiryHandled = true; onUnauthorized(api); }
    return result;
  };
  return async (args, api, extraOptions) => {
    const request = typeof args === "string" ? { url: args } : args;
    const method = (request.method ?? "GET").toUpperCase();
    const skipCsrf = request.url === "/auth/login" || request.url === "/auth/register" || request.url === "/auth/recovery";
    const skipSessionExpiry = request.url === "/auth/login" || request.url === "/auth/register" || request.url === "/auth/recovery";
    if (["GET", "HEAD", "OPTIONS"].includes(method) || skipCsrf) return inspect(await rawQuery(args, api, extraOptions), api, skipSessionExpiry, request.url === "/auth/login");
    const csrfResponse = await rawQuery({ url: "/auth/csrf", method: "GET" }, api, extraOptions);
    if (csrfResponse.error) return inspect(csrfResponse, api, false);
    const payload = csrfResponse.data as { data?: { csrfToken?: string } };
    if (!payload.data?.csrfToken) return { error: { status: "CUSTOM_ERROR", error: "The session could not be verified." } };
    const headers = new Headers(request.headers as HeadersInit);
    headers.set("x-csrf-token", payload.data.csrfToken);
    return inspect(await rawQuery({ ...request, headers }, api, extraOptions), api, false);
  };
}

let resetApiCache: () => { type: string } = () => ({ type: "api/resetApiState" });
const baseQueryWithCsrf = createSessionAwareBaseQuery(rawBaseQuery, (baseQueryApi) => {
  baseQueryApi.dispatch(sessionExpired());
  baseQueryApi.dispatch(resetApiCache());
}, (baseQueryApi) => { baseQueryApi.dispatch(sessionRestored()); });

export interface Course {
  id: string; tenantId: string; ownerId: string; title: string; slug: string; shortDescription: string; description: string;
  learningObjectives: string[]; prerequisites: string[]; category: string; difficulty: "beginner" | "intermediate" | "advanced";
  language: string; thumbnailReference?: string; status: "draft" | "published" | "archived"; publishedAt?: string;
  estimatedDurationMinutes: number; tags: string[]; createdAt: string; updatedAt: string; organizationName?: string;
}
export interface LessonMetadata { id: string; title: string; description: string; contentType: "text" | "external_video" | "resources"; estimatedDurationMinutes: number; position: number; progress?: { isComplete: boolean; completedAt: string | null; lastAccessedAt: string | null } }
export interface LessonInput { title: string; description: string; contentType: "text" | "external_video" | "resources"; content?: string; externalUrl?: string; resourceLinks: { title: string; url: string }[]; estimatedDurationMinutes: number }
export type ManagedLesson = LessonInput & { id: string; position: number; status: "draft" | "published" };
export interface CourseInput { title: string; slug: string; shortDescription: string; description: string; learningObjectives: string[]; prerequisites: string[]; category: string; difficulty: Course["difficulty"]; language: string; thumbnailReference?: string; estimatedDurationMinutes: number; tags: string[] }
interface Envelope<T> { data: T }
interface CoursePage { items: Course[]; nextCursor: string | null; hasMore: boolean }
interface Enrollment { id: string; status: "active" | "completed"; progress: { completedLessons: number; totalLessons: number; percent: number }; startedAt?: string; completedAt?: string | null }
interface Organization { id: string; name: string; kind: string; slug: string; roles: string[]; joinedAt?: string | null }
interface User { id: string; email: string; displayName: string; emailVerifiedAt?: string | null }

export const api = createApi({
  reducerPath: "api",
  baseQuery: baseQueryWithCsrf,
  tagTypes: ["Session", "Organizations", "Course", "ManagedCourses", "Enrollments", "Lessons"],
  endpoints: (build) => ({
    currentUser: build.query<Envelope<{ user: User }>, void>({ query: () => "/auth/me", providesTags: ["Session"] }),
    login: build.mutation<Envelope<{ user: User }>, { email: string; password: string; totpCode?: string }>({
      query: (body) => ({ url: "/auth/login", method: "POST", body }), invalidatesTags: ["Session"],
      async onQueryStarted(_arg, { queryFulfilled }) { try { await queryFulfilled; } catch { /* Login errors stay in the mutation result and do not alter session state. */ } },
    }),
    myOrganizations: build.query<Envelope<{ organizations: Organization[] }>, void>({ query: () => "/users/me/organizations", providesTags: ["Organizations"] }),
    discoverCourses: build.query<Envelope<CoursePage>, { q?: string; category?: string; difficulty?: string; cursor?: string; limit?: number }>({
      query: (params) => ({ url: "/courses", params }), providesTags: (result) => result ? [...result.data.items.map((item) => ({ type: "Course" as const, id: item.id })), "Course"] : ["Course"],
    }),
    publishedCourse: build.query<Envelope<{ course: Course; lessons: LessonMetadata[]; enrollment: Enrollment | null }>, string>({ query: (id) => `/courses/${id}`, providesTags: (_result, _error, id) => [{ type: "Course", id }] }),
    managedCourses: build.query<Envelope<CoursePage>, { cursor?: string; limit?: number }>({ query: (params) => ({ url: "/instructor/courses", params }), providesTags: ["ManagedCourses"] }),
    managedCourse: build.query<Envelope<{ course: Course; lessons: ManagedLesson[] }>, string>({ query: (id) => `/instructor/courses/${id}`, providesTags: (_result, _error, id) => [{ type: "Course", id }, "Lessons"] }),
    createCourse: build.mutation<Envelope<{ course: Course }>, { organizationId: string; input: CourseInput }>({ query: ({ organizationId, input }) => ({ url: `/organizations/${organizationId}/courses`, method: "POST", body: input }), invalidatesTags: ["ManagedCourses"] }),
    updateCourse: build.mutation<Envelope<{ course: Course }>, { courseId: string; input: Partial<CourseInput> }>({ query: ({ courseId, input }) => ({ url: `/instructor/courses/${courseId}`, method: "PATCH", body: input }), invalidatesTags: (_result, _error, arg) => ["ManagedCourses", { type: "Course", id: arg.courseId }] }),
    publishCourse: build.mutation<Envelope<{ course: Course }>, string>({ query: (id) => ({ url: `/instructor/courses/${id}/publish`, method: "POST" }), invalidatesTags: (_result, _error, id) => ["ManagedCourses", "Course", { type: "Course", id }] }),
    archiveCourse: build.mutation<Envelope<{ course: Course }>, string>({ query: (id) => ({ url: `/instructor/courses/${id}/archive`, method: "POST" }), invalidatesTags: (_result, _error, id) => ["ManagedCourses", "Course", { type: "Course", id }] }),
    managedLessons: build.query<Envelope<{ lessons: (LessonInput & { id: string; position: number; status: string })[] }>, string>({ query: (id) => `/instructor/courses/${id}/lessons`, providesTags: (_result, _error, id) => [{ type: "Lessons", id }] }),
    createLesson: build.mutation<Envelope<{ lesson: LessonInput & { id: string } }>, { courseId: string; input: LessonInput }>({ query: ({ courseId, input }) => ({ url: `/instructor/courses/${courseId}/lessons`, method: "POST", body: input }), invalidatesTags: (_result, _error, arg) => ["ManagedCourses", { type: "Lessons", id: arg.courseId }, { type: "Course", id: arg.courseId }] }),
    updateLesson: build.mutation<Envelope<{ lesson: LessonInput & { id: string } }>, { courseId: string; lessonId: string; input: LessonInput }>({ query: ({ courseId, lessonId, input }) => ({ url: `/instructor/courses/${courseId}/lessons/${lessonId}`, method: "PATCH", body: input }), invalidatesTags: (_result, _error, arg) => [{ type: "Lessons", id: arg.courseId }, { type: "Course", id: arg.courseId }] }),
    deleteLesson: build.mutation<void, { courseId: string; lessonId: string }>({ query: ({ courseId, lessonId }) => ({ url: `/instructor/courses/${courseId}/lessons/${lessonId}`, method: "DELETE" }), invalidatesTags: (_result, _error, arg) => [{ type: "Lessons", id: arg.courseId }, { type: "Course", id: arg.courseId }] }),
    reorderLessons: build.mutation<Envelope<{ lessons: unknown[] }>, { courseId: string; lessonIds: string[] }>({ query: ({ courseId, lessonIds }) => ({ url: `/instructor/courses/${courseId}/lessons/order`, method: "PUT", body: { lessonIds } }), invalidatesTags: (_result, _error, arg) => [{ type: "Lessons", id: arg.courseId }] }),
    enroll: build.mutation<Envelope<{ enrollment: Enrollment; created: boolean }>, string>({ query: (id) => ({ url: `/courses/${id}/enrollments`, method: "POST" }), invalidatesTags: ["Enrollments", "Course"] }),
    myEnrollments: build.query<Envelope<{ enrollments: { enrollment: Enrollment; course: Course }[] }>, void>({ query: () => "/users/me/enrollments", providesTags: ["Enrollments"] }),
    myEnrollment: build.query<Envelope<{ enrollment: Enrollment; course: Course; lessons: LessonMetadata[] }>, string>({ query: (id) => `/users/me/enrollments/${id}`, providesTags: (_result, _error, id) => [{ type: "Enrollments", id }] }),
    lessonContent: build.query<Envelope<{ lesson: LessonInput & { id: string; position: number } }>, { courseId: string; lessonId: string }>({ query: ({ courseId, lessonId }) => `/courses/${courseId}/lessons/${lessonId}`, providesTags: (_result, _error, arg) => [{ type: "Lessons", id: arg.lessonId }] }),
    completeLesson: build.mutation<Envelope<{ enrollment: Enrollment; progress: { lessonId: string; isComplete: boolean; completedAt: string }; course: Course }>, { courseId: string; lessonId: string }>({ query: ({ courseId, lessonId }) => ({ url: `/courses/${courseId}/lessons/${lessonId}/progress`, method: "PUT" }), invalidatesTags: ["Enrollments", "Course"] }),
  }),
});
resetApiCache = api.util.resetApiState;

export const {
  useCurrentUserQuery, useLoginMutation, useMyOrganizationsQuery, useDiscoverCoursesQuery, usePublishedCourseQuery, useManagedCoursesQuery, useManagedCourseQuery,
  useCreateCourseMutation, useUpdateCourseMutation, usePublishCourseMutation, useArchiveCourseMutation, useManagedLessonsQuery, useCreateLessonMutation,
  useUpdateLessonMutation, useDeleteLessonMutation, useReorderLessonsMutation, useEnrollMutation, useMyEnrollmentsQuery, useMyEnrollmentQuery,
  useLessonContentQuery, useCompleteLessonMutation,
} = api;
