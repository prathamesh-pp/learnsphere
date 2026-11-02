import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { BaseQueryApi, BaseQueryFn, FetchBaseQueryError, FetchArgs } from "@reduxjs/toolkit/query";
import { createSessionAwareBaseQuery } from "../../services/api";
import { OrganizationDestination } from "./instructor";
import { LearningPage } from "./learning";

const mocks = vi.hoisted(() => ({ lessonResult: {} as { isLoading: boolean; isError: boolean; error: unknown; refetch: ReturnType<typeof vi.fn> } }));
vi.mock("../../services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../services/api")>();
  return {
    ...actual,
    useMyEnrollmentQuery: () => ({ data: { data: { enrollment: { id: "enrollment-1", status: "active", progress: { completedLessons: 0, totalLessons: 1, percent: 0 } }, course: { id: "course-1", title: "Course" }, lessons: [{ id: "lesson-1", title: "Lesson", description: "Description", estimatedDurationMinutes: 5, position: 0 }] } }, isLoading: false, isError: false }),
    useLessonContentQuery: () => mocks.lessonResult,
    useCompleteLessonMutation: () => [vi.fn(), { isLoading: false, isError: false }],
  };
});

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

describe("lesson content failures", () => {
  beforeEach(() => { mocks.lessonResult = { isLoading: false, isError: true, error: { status: "FETCH_ERROR", error: "offline" }, refetch: vi.fn() }; });
  function openLearning() {
    return render(<MemoryRouter initialEntries={["/learn/enrollment-1"]}><Routes><Route path="/learn/:enrollmentId" element={<LearningPage />} /></Routes></MemoryRouter>);
  }

  it("shows a network error and retries instead of spinning forever", () => {
    openLearning();
    expect(screen.getByRole("alert").textContent).toContain("could not load this lesson");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(mocks.lessonResult.refetch).toHaveBeenCalledOnce();
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
