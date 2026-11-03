import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BaseQueryApi, BaseQueryFn, FetchBaseQueryError, FetchArgs } from "@reduxjs/toolkit/query";
import { createSessionAwareBaseQuery } from "../../services/api";
import { InstructorCoursePage, OrganizationDestination } from "./instructor";
import { LearningPage } from "./learning";
import { CourseDetailPage } from "./discovery";

const mocks = vi.hoisted(() => ({
  lessonResult: {} as { isLoading: boolean; isError: boolean; error: unknown; data?: unknown; refetch: ReturnType<typeof vi.fn> },
  enrollmentResult: {} as any,
  managedCourseResult: {} as any,
  managedLessonsResult: {} as any,
  publishedCourseResult: {} as any,
  calls: [] as { name: string; args: unknown[] }[],
  failures: {} as Record<string, unknown>,
  confirmResult: true,
  mediaAccess: { isLoading: false, isError: true, error: { status: 503 }, refetch: vi.fn() } as any,
  upload: vi.fn(),
}));
vi.mock("../../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api")>();
  const mutation = (name: string) => [
    (...args: unknown[]) => { mocks.calls.push({ name, args }); return { unwrap: () => mocks.failures[name] ? Promise.reject(mocks.failures[name]) : Promise.resolve(name === "createLesson" ? { data: { lesson: { id: "lesson-new" } } } : name === "createMediaUploadGrant" ? { data: { grant: { intentId: "intent-a", uploadUrl: "/api/v1/instructor/courses/course-a/lessons/lesson-new/media-upload-intents/intent-a/content", expiresAt: "2026-12-01T00:00:00.000Z", maxSizeBytes: 10000000 } } } : { data: {} }) }; },
    { isLoading: false, isError: Boolean(mocks.failures[name]), error: mocks.failures[name] },
  ];
  return {
    ...actual,
    useMyOrganizationsQuery: () => ({ data: { data: { organizations: [] } }, isLoading: false, isError: false, isSuccess: true, refetch: vi.fn() }),
    useManagedCourseQuery: () => mocks.managedCourseResult,
    useManagedLessonsQuery: () => mocks.managedLessonsResult,
    usePublishedCourseQuery: () => mocks.publishedCourseResult,
    useMyEnrollmentQuery: () => mocks.enrollmentResult,
    useLessonContentQuery: () => mocks.lessonResult,
    useCompleteLessonMutation: () => mutation("completeLesson"),
    useRecordVideoProgressMutation: () => mutation("recordVideoProgress"),
    useCreateMediaUploadGrantMutation: () => mutation("createMediaUploadGrant"),
    useStudentMediaAccessQuery: () => mocks.mediaAccess,
    uploadMediaWithProgress: mocks.upload,
    useEnrollMutation: () => mutation("enroll"),
    useCreateCourseMutation: () => mutation("createCourse"),
    useUpdateCourseMutation: () => mutation("updateCourse"),
    usePublishCourseMutation: () => mutation("publishCourse"),
    useArchiveCourseMutation: () => mutation("archiveCourse"),
    useCreateLessonMutation: () => mutation("createLesson"),
    useUpdateLessonMutation: () => mutation("updateLesson"),
    useDeleteLessonMutation: () => mutation("deleteLesson"),
    useCreateSectionMutation: () => mutation("createSection"),
    useUpdateSectionMutation: () => mutation("updateSection"),
    useDeleteSectionMutation: () => mutation("deleteSection"),
    useMoveLessonMutation: () => mutation("moveLesson"),
    useReorderLessonsMutation: () => mutation("reorderLessons"),
    useReorderSectionsMutation: () => mutation("reorderSections"),
  };
});

const sectionA = { id: "section-a", title: "Foundations", description: "Start here.", position: 0, status: "draft" as const };
const sectionB = { id: "section-b", title: "Practice", description: "", position: 1, status: "draft" as const };
const courseFixture = { id: "course-a", tenantId: "tenant-a", ownerId: "instructor-a", title: "Course", slug: "course", shortDescription: "Short", description: "Full", learningObjectives: [], prerequisites: [], category: "General", difficulty: "beginner" as const, language: "en", status: "draft" as const, estimatedDurationMinutes: 10, tags: [], sections: [sectionA, sectionB], createdAt: "", updatedAt: "" };
const lessonA = { id: "lesson-a", sectionId: sectionA.id, title: "Lesson A", description: "First", contentType: "text" as const, content: "A body", resourceLinks: [], estimatedDurationMinutes: 5, position: 0, status: "draft" as const };
const lessonB = { id: "lesson-b", sectionId: sectionA.id, title: "Lesson B", description: "Second", contentType: "text" as const, content: "B body", resourceLinks: [], estimatedDurationMinutes: 5, position: 1, status: "draft" as const };
function setupInstructor({ sections = [sectionA, sectionB], lessons = [lessonA, lessonB], loading = false, error = false }: { sections?: typeof sectionA[]; lessons?: typeof lessonA[]; loading?: boolean; error?: boolean } = {}) {
  mocks.calls.length = 0; mocks.failures = {}; mocks.confirmResult = true; mocks.upload.mockReset().mockResolvedValue({ data: { asset: { id: "asset-a", state: "ready" } } });
  mocks.managedCourseResult = { data: error ? undefined : { data: { course: { ...courseFixture, sections } } }, isLoading: loading, isError: error, error: error ? { data: { error: { message: "Course load failed." } } } : undefined, refetch: vi.fn() };
  mocks.managedLessonsResult = { data: { data: { lessons } }, isLoading: false, isError: false, refetch: vi.fn() };
  vi.spyOn(window, "confirm").mockImplementation(() => mocks.confirmResult);
}
function openInstructor() { return render(<MemoryRouter initialEntries={["/teach/courses/course-a"]}><Routes><Route path="/teach/courses/:courseId" element={<InstructorCoursePage />} /></Routes></MemoryRouter>); }
const publishedCourseFixture = { ...courseFixture, status: "published" as const, sections: [{ ...sectionA, status: "published" as const }] };
const learnerLessons = [
  { ...lessonA, sectionId: sectionA.id, status: "published" as const, progress: { isComplete: true, completedAt: "2026-01-01", lastAccessedAt: "2026-01-01" } },
  { ...lessonB, sectionId: sectionA.id, status: "published" as const, progress: { isComplete: false, completedAt: null, lastAccessedAt: null } },
];
function setupLearner(lessons = learnerLessons) {
  mocks.calls.length = 0; mocks.failures = {}; mocks.mediaAccess = { isLoading: false, isError: true, error: { status: 503 }, refetch: vi.fn() };
  mocks.enrollmentResult = { data: { data: { enrollment: { id: "enrollment-1", status: "active", progress: { completedLessons: 1, totalLessons: lessons.length, percent: lessons.length ? Math.floor(100 / lessons.length) : 0 } }, course: publishedCourseFixture, lessons } }, isLoading: false, isError: false };
  mocks.lessonResult = { isLoading: false, isError: true, error: { status: "FETCH_ERROR", error: "offline" }, refetch: vi.fn() };
  mocks.publishedCourseResult = { data: { data: { course: publishedCourseFixture, lessons: learnerLessons.slice(0, 1).map(({ progress: _progress, status: _status, ...item }) => item), enrollment: null } }, isLoading: false, isError: false };
}
function openLearning() { return render(<MemoryRouter initialEntries={["/learn/enrollment-1"]}><Routes><Route path="/learn/:enrollmentId" element={<LearningPage />} /></Routes></MemoryRouter>); }
function openCourseDetail() { return render(<MemoryRouter initialEntries={["/courses/course-a"]}><Routes><Route path="/courses/:courseId" element={<CourseDetailPage />} /></Routes></MemoryRouter>); }

describe("course organization choice", () => {
  it("requires an explicit choice when more than one organization is eligible", () => {
    const onChange = vi.fn();
    render(<OrganizationDestination organizations={[{ id: "org-a", name: "Alpha" }, { id: "org-b", name: "Beta" }]} value="" onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Course organization" });
    expect((select as HTMLSelectElement).required).toBe(true);
    fireEvent.change(select, { target: { value: "org-b" } });
    expect(onChange).toHaveBeenCalledWith("org-b");
  });

  it("clearly identifies the single eligible organization", () => {
    render(<OrganizationDestination organizations={[{ id: "org-a", name: "Alpha Institute" }]} value="org-a" onChange={() => undefined} />);
    expect(screen.getByText(/created in/i).textContent).toContain("Alpha Institute");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("explains when no eligible organization is available", () => {
    render(<OrganizationDestination organizations={[]} value="" onChange={() => undefined} />);
    expect(screen.getByRole("alert").textContent).toMatch(/active organization/i);
  });
});

describe("instructor curriculum interactions", () => {
  it("creates and edits a section through its form", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.click(screen.getByRole("button", { name: /Add section/ }));
    await user.type(screen.getByRole("textbox", { name: "Section title" }), "Review");
    await user.type(screen.getByRole("textbox", { name: "Description" }), "Review the foundations.");
    await user.click(screen.getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(mocks.calls[0]?.name).toBe("createSection"));
    expect(mocks.calls[0]?.args[0]).toEqual({ courseId: "course-a", input: { title: "Review", description: "Review the foundations." } });
    expect(screen.queryByRole("textbox", { name: "Section title" })).toBeNull();

    await user.click(screen.getAllByRole("button", { name: "Edit" })[0]!);
    const title = screen.getByRole("textbox", { name: "Section title" });
    await user.clear(title); await user.type(title, "Core review");
    await user.click(screen.getByRole("button", { name: "Save section" }));
    await waitFor(() => expect(mocks.calls[1]?.name).toBe("updateSection"));
    expect(mocks.calls[1]?.args[0]).toEqual({ courseId: "course-a", sectionId: "section-a", input: { title: "Core review", description: "Start here." } });
  });

  it("confirms deletion of an empty section and displays the nonempty conflict", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    const emptySection = screen.getAllByRole("heading", { name: "Practice", level: 3 })[0]!.closest(".curriculum-section") as HTMLElement;
    await user.click(within(emptySection).getByRole("button", { name: "Remove" }));
    expect(window.confirm).toHaveBeenCalled();
    expect(mocks.calls[0]?.name).toBe("deleteSection");
    expect(mocks.calls[0]?.args[0]).toEqual({ courseId: "course-a", sectionId: "section-b" });

    mocks.failures.deleteSection = { data: { error: { message: "Section is not empty." } } };
    const occupiedSection = screen.getByRole("heading", { name: "Foundations", level: 3 }).closest(".curriculum-section") as HTMLElement;
    await user.click(within(occupiedSection).getAllByRole("button", { name: "Remove" })[0]!);
    expect(await screen.findByText("Section is not empty.")).toBeTruthy();
  });

  it("creates and edits lessons while keeping section movement explicit", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.click(screen.getByRole("button", { name: /Add lesson/ }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "New lesson");
    await user.type(screen.getByRole("textbox", { name: /Rich lesson content/ }), "## New section\n\nNew body");
    expect(screen.getByRole("heading", { name: "New section", level: 3 })).toBeTruthy();
    await user.selectOptions(screen.getByRole("combobox", { name: "Section" }), "section-b");
    await user.click(screen.getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(mocks.calls[0]?.name).toBe("createLesson"));
    expect(mocks.calls[0]?.args[0]).toMatchObject({ courseId: "course-a", input: { title: "New lesson", content: "## New section\n\nNew body", contentData: { type: "text", blocks: [{ type: "heading", level: 2, text: "New section" }, { type: "paragraph", text: "New body" }] }, sectionId: "section-b" } });
    expect(screen.queryByRole("textbox", { name: "Lesson title" })).toBeNull();

    const lessonRow = screen.getByText("Lesson A").closest(".lesson-manage-row") as HTMLElement;
    await user.click(within(lessonRow).getByRole("button", { name: "Edit" }));
    const lessonTitle = screen.getByRole("textbox", { name: "Lesson title" });
    await user.clear(lessonTitle); await user.type(lessonTitle, "Lesson A updated");
    await user.click(screen.getByRole("button", { name: "Save lesson" }));
    await waitFor(() => expect(mocks.calls[1]?.name).toBe("updateLesson"));
    expect(mocks.calls[1]?.args[0]).toMatchObject({ courseId: "course-a", lessonId: "lesson-a", input: { title: "Lesson A updated" } });
    expect((mocks.calls[1]?.args[0] as { input: Record<string, unknown> }).input).not.toHaveProperty("sectionId");
  });

  it("requires confirmation before deleting a lesson", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    const row = screen.getByText("Lesson A").closest(".lesson-manage-row") as HTMLElement;
    mocks.confirmResult = false;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(mocks.calls).toHaveLength(0);
    mocks.confirmResult = true;
    await user.click(within(row).getByRole("button", { name: "Remove" }));
    expect(mocks.calls[0]).toEqual({ name: "deleteLesson", args: [{ courseId: "course-a", lessonId: "lesson-a" }] });
  });

  it("preserves external video lessons and offers a private media upload flow", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.click(screen.getByRole("button", { name: /Add lesson/ }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "Video lesson");
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson content type" }), "video");
    await user.type(screen.getByRole("textbox", { name: "HTTPS video URL" }), "https://cdn.example.com/video.mp4");
    await user.clear(screen.getByLabelText(/Estimated time/)); await user.type(screen.getByLabelText(/Estimated time/), "2");
    await user.click(screen.getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(mocks.calls[0]?.name).toBe("createLesson"));
    expect(mocks.calls[0]?.args[0]).toMatchObject({ input: { contentType: "video", contentData: { type: "video", source: "external", durationSeconds: 120, url: "https://cdn.example.com/video.mp4" } } });
    cleanup(); setupInstructor(); openInstructor(); await user.click(screen.getByRole("button", { name: /Add lesson/ }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson content type" }), "document");
    expect(screen.getByLabelText("Private media file")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add lesson" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates a draft lesson, streams a selected PDF and waits for verification before closing", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.click(screen.getByRole("button", { name: /Add lesson/ }));
    await user.type(screen.getByRole("textbox", { name: "Lesson title" }), "Guide");
    await user.selectOptions(screen.getByRole("combobox", { name: "Lesson content type" }), "document");
    await user.upload(screen.getByLabelText("Private media file"), new File(["%PDF-1.7"], "guide.pdf", { type: "application/pdf" }));
    await user.click(screen.getByRole("button", { name: "Add lesson" }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(mocks.calls.map((call) => call.name)).toEqual(["createLesson", "createMediaUploadGrant"]);
    expect(mocks.calls[0]?.args[0]).toMatchObject({ input: { contentType: "document", title: "Guide" } });
    expect(mocks.calls[1]?.args[0]).toMatchObject({ courseId: "course-a", lessonId: "lesson-new", purpose: "document", fileName: "guide.pdf", contentType: "application/pdf", sizeBytes: 8 });
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ contentType: "application/pdf", file: expect.any(File) }));
  });

  it("reorders sections and lessons using the displayed up/down controls", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.click(screen.getByRole("button", { name: "Move Practice up" }));
    expect(mocks.calls[0]).toEqual({ name: "reorderSections", args: [{ courseId: "course-a", sectionIds: ["section-b", "section-a"] }] });
    mocks.calls.length = 0;
    await user.click(screen.getByRole("button", { name: "Move Lesson B up" }));
    expect(mocks.calls[0]).toEqual({ name: "reorderLessons", args: [{ courseId: "course-a", lessonIds: ["lesson-b", "lesson-a"] }] });
  });

  it("moves a lesson between sections and reports request failures", async () => {
    setupInstructor(); const user = userEvent.setup(); openInstructor();
    await user.selectOptions(screen.getByRole("combobox", { name: "Move Lesson A to section" }), "section-b");
    expect(mocks.calls[0]).toEqual({ name: "moveLesson", args: [{ courseId: "course-a", lessonId: "lesson-a", sectionId: "section-b", position: 0 }] });
    mocks.failures.moveLesson = { data: { error: { message: "Move failed." } } };
    await user.selectOptions(screen.getByRole("combobox", { name: "Move Lesson B to section" }), "section-b");
    expect(await screen.findByText("Move failed.")).toBeTruthy();
  });

  it("shows loading, empty, and retryable curriculum query states", async () => {
    setupInstructor({ loading: true }); openInstructor();
    expect(screen.getByText("Loading course…")).toBeTruthy();
  });

  it("shows an empty curriculum and retries a failed lesson list", async () => {
    setupInstructor({ sections: [], lessons: [] }); openInstructor();
    expect(screen.getByRole("heading", { name: "Start your curriculum" })).toBeTruthy();
    cleanup();
    setupInstructor(); mocks.managedLessonsResult = { data: { data: { lessons: [] } }, isLoading: false, isError: true, refetch: vi.fn() }; const refetch = mocks.managedLessonsResult.refetch; openInstructor();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("retries a failed course load", async () => {
    setupInstructor({ error: true }); const refetch = mocks.managedCourseResult.refetch; openInstructor();
    await userEvent.setup().click(await screen.findByRole("button", { name: "Retry" }));
    expect(refetch).toHaveBeenCalledOnce();
  });
});

describe("lesson content failures", () => {
  beforeEach(() => { setupLearner(); });

  it("shows a network error and retries instead of spinning forever", () => {
    openLearning();
    expect(screen.getByRole("alert").textContent).toContain("could not load this lesson");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.lessonResult.refetch).toHaveBeenCalledOnce();
  });

  it("renders the section hierarchy, current lesson and duration", () => {
    openLearning();
    expect(screen.getByRole("heading", { name: "Foundations", level: 4 })).toBeTruthy();
    expect(screen.getAllByRole("button").find((button) => button.classList.contains("sidebar-lesson"))?.getAttribute("aria-current")).toBe("true");
  });

  it("navigates between accessible lessons and marks completed lessons in the outline", async () => {
    setupLearner(); mocks.lessonResult = { isLoading: false, isError: false, data: { data: { lesson: { id: "lesson-a", title: "Lesson A", description: "First", contentType: "text", content: "Body" } } }, error: undefined, refetch: vi.fn() };
    const user = userEvent.setup(); openLearning();
    const outline = () => screen.getAllByRole("button").filter((button) => button.classList.contains("sidebar-lesson"));
    expect(outline()[0]?.classList.contains("selected")).toBe(true);
    expect(outline()[0]?.querySelector(".lesson-check")?.classList.contains("done")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(outline()[1]?.getAttribute("aria-current")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Previous" }));
    expect(outline()[0]?.getAttribute("aria-current")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Mark as complete" }));
    expect(mocks.calls.at(-1)).toEqual({ name: "completeLesson", args: [{ courseId: "course-a", lessonId: "lesson-b" }] });
  });

  it("renders structured rich text blocks as user content", () => {
    setupLearner(); mocks.lessonResult = { isLoading: false, isError: false, error: undefined, data: { data: { lesson: { id: "lesson-a", title: "Lesson A", description: "First", contentType: "text", contentData: { type: "text", blocks: [{ type: "heading", level: 2, text: "Concepts" }, { type: "paragraph", text: "A clear explanation." }, { type: "bulleted_list", items: ["One", "Two"] }, { type: "code", language: "ts", code: "const value = 1;" }, { type: "link", title: "Reference", url: "https://example.com" }] } } } }, refetch: vi.fn() };
    openLearning();
    expect(screen.getByRole("heading", { name: "Concepts", level: 3 })).toBeTruthy();
    expect(screen.getByText("A clear explanation.")).toBeTruthy();
    expect(screen.getByText("const value = 1;")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Reference/ }).getAttribute("rel")).toContain("noopener");
  });

  it("renders video playback, reports progress and prevents completion before the watch threshold", () => {
    setupLearner();
    const first = mocks.enrollmentResult.data.data.lessons[0];
    mocks.enrollmentResult.data.data.lessons[0] = { ...first, contentType: "video", estimatedDurationMinutes: 1, progress: { ...first.progress, isComplete: false, videoProgress: { watchedSeconds: 0, lastPositionSeconds: 0 } } };
    mocks.lessonResult = { isLoading: false, isError: false, error: undefined, data: { data: { lesson: { id: "lesson-a", title: "Lecture", description: "Watch", contentType: "video", contentData: { type: "video", source: "external", title: "Lecture video", url: "https://cdn.example.com/lecture.mp4", durationSeconds: 60 } } } }, refetch: vi.fn() };
    openLearning();
    const video = screen.getByLabelText("Lecture video");
    expect((screen.getByRole("button", { name: "Mark as complete" }) as HTMLButtonElement).disabled).toBe(true);
    Object.defineProperty(video, "currentTime", { configurable: true, value: 8 }); fireEvent.timeUpdate(video);
    expect(mocks.calls.at(-1)).toEqual({ name: "recordVideoProgress", args: [{ courseId: "course-a", lessonId: "lesson-a", positionSeconds: 8 }] });
    expect((screen.getByRole("button", { name: "Mark as complete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows unavailable private file delivery, retries access, and keeps completion disabled", async () => {
    setupLearner();
    const first = mocks.enrollmentResult.data.data.lessons[0];
    mocks.enrollmentResult.data.data.lessons[0] = { ...first, contentType: "document", progress: { ...first.progress, isComplete: false } };
    mocks.lessonResult = { isLoading: false, isError: false, error: undefined, data: { data: { lesson: { id: "lesson-a", title: "Guide", description: "PDF", contentType: "document", contentData: { type: "document", assetId: "a".repeat(24), fileName: "guide.pdf", mimeType: "application/pdf", sizeBytes: 2048 } } } }, refetch: vi.fn() };
    openLearning();
    expect(screen.getByRole("alert").textContent).toContain("Document access expired or is unavailable");
    await userEvent.setup().click(screen.getByRole("button", { name: "Retry" }));
    expect((screen.getByRole("button", { name: "Mark as complete" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows loading and empty learning states", () => {
    mocks.enrollmentResult = { isLoading: true };
    openLearning();
    expect(screen.getByText("Opening your course…")).toBeTruthy();
  });

  it("distinguishes denied and missing lessons without offering a retry", () => {
    mocks.lessonResult = { isLoading: false, isError: true, error: { status: 403, data: { error: { message: "Enrollment required." } } }, refetch: vi.fn() };
    const { rerender } = openLearning();
    expect(screen.getByRole("alert").textContent).toContain("Lesson access denied");
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    mocks.lessonResult = { isLoading: false, isError: true, error: { status: 404 }, refetch: vi.fn() };
    rerender(<MemoryRouter initialEntries={["/learn/enrollment-1"]}><Routes><Route path="/learn/:enrollmentId" element={<LearningPage />} /></Routes></MemoryRouter>);
    expect(screen.getByRole("alert").textContent).toContain("Lesson unavailable");
  });
});

describe("published student course preview", () => {
  it("groups lessons by section and marks preview content locked until enrollment", async () => {
    setupLearner(); openCourseDetail();
    expect(screen.getByRole("heading", { name: "Foundations", level: 4 })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Locked until enrollment" })).toBeTruthy();
    expect(screen.queryByText("Secret unpublished body.")).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "Enroll for free" }));
    expect(mocks.calls.at(-1)).toEqual({ name: "enroll", args: ["course-a"] });
  });
});

describe("centralized session expiry", () => {
  it("resets once for concurrent 401s, ignores validation errors, and rearms after login", async () => {
    const rawQuery = vi.fn(async (args: string | FetchArgs) => {
      const url = typeof args === "string" ? args : args.url;
      if (url === "/auth/login") return { data: { ok: true } };
      if (url === "/bad-input") return { error: { status: 400, data: { error: { message: "Invalid." } } } };
      return { error: { status: 401, data: { error: { message: "Unauthenticated." } } } };
    }) as unknown as BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError>;
    const onUnauthorized = vi.fn(); const onRestored = vi.fn();
    const baseQuery = createSessionAwareBaseQuery(rawQuery, onUnauthorized, onRestored);
    const baseApi = { dispatch: vi.fn(), getState: () => ({}), endpoint: "test", type: "query", forced: false, signal: new AbortController().signal, abort: vi.fn(), extra: {}, queryCacheKey: "test" } as unknown as BaseQueryApi;
    await Promise.all([baseQuery("/auth/me", baseApi, {}), baseQuery("/courses", baseApi, {})]);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await baseQuery("/bad-input", baseApi, {});
    expect(onUnauthorized).toHaveBeenCalledOnce();
    await baseQuery({ url: "/auth/login", method: "POST", body: {} }, baseApi, {});
    expect(onRestored).toHaveBeenCalledOnce();
    await baseQuery("/auth/me", baseApi, {});
    expect(onUnauthorized).toHaveBeenCalledTimes(2);
  });
});
