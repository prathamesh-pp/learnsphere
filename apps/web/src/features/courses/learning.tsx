import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCompleteLessonMutation, useLessonContentQuery, useMyEnrollmentQuery, useMyEnrollmentsQuery } from "../../services/api";
import { message } from "../../App";

export function LearningDashboardPage() {
  const { data, isLoading, isError } = useMyEnrollmentsQuery(); const list = data?.data.enrollments ?? [];
  return <main className="page-wrap"><div className="page-title-row"><div><div className="eyebrow">YOUR LEARNING</div><h1>Keep your momentum</h1><p className="muted">Pick up where you left off and celebrate every completed lesson.</p></div><Link className="button secondary" to="/courses">Explore courses</Link></div>
    {isLoading ? <div className="center-state"><span className="spinner" />Loading your courses…</div> : isError ? <div className="notice error">Your learning could not be loaded.</div> : list.length ? <div className="learning-grid">{list.map(({ enrollment, course }) => <Link className="learning-card" to={`/learn/${enrollment.id}`} key={enrollment.id}><div className="learning-card-top"><span className="mini-art">{course.title.slice(0, 1).toUpperCase()}</span><span className={`status-pill ${enrollment.status}`}>{enrollment.status}</span></div><h3>{course.title}</h3><p>{course.shortDescription}</p><div className="progress-meta"><span>{enrollment.progress.completedLessons} of {enrollment.progress.totalLessons} lessons</span><b>{enrollment.progress.percent}%</b></div><div className="progress-track"><span style={{ width: `${enrollment.progress.percent}%` }} /></div><span className="continue-link">{enrollment.status === "completed" ? "Review course" : "Continue learning"} →</span></Link>)}</div> : <div className="empty-state"><span className="empty-icon">↗</span><h3>Your learning journey starts here</h3><p>Enroll in a course and your progress will show up here.</p><Link className="button primary" to="/courses">Browse courses</Link></div>}
  </main>;
}

export function lessonContentError(error: unknown): { title: string; detail: string; retryable: boolean } {
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: number | string }).status : undefined;
  if (status === 401) return { title: "Your session has expired", detail: "Sign in again to continue learning.", retryable: false };
  if (status === 403) return { title: "Lesson access denied", detail: message(error), retryable: false };
  if (status === 404) return { title: "Lesson unavailable", detail: "This lesson may have been unpublished or removed.", retryable: false };
  return { title: "We could not load this lesson", detail: message(error), retryable: true };
}

export function LessonLoadError({ error, retry }: { error: unknown; retry: () => void }) {
  const state = lessonContentError(error);
  return <div className="lesson-load-error" role="alert"><h2>{state.title}</h2><p>{state.detail}</p>{state.retryable && <button className="button secondary" onClick={retry}>Retry</button>}</div>;
}

export function LearningPage() {
  const { enrollmentId = "" } = useParams(); const query = useMyEnrollmentQuery(enrollmentId, { skip: !enrollmentId }); const [complete, result] = useCompleteLessonMutation(); const [activeLesson, setActiveLesson] = useState("");
  const enrollment = query.data?.data.enrollment; const lessons = query.data?.data.lessons ?? []; const selected = lessons.find((lesson) => lesson.id === activeLesson) ?? lessons[0]; const content = useLessonContentQuery({ courseId: query.data?.data.course.id ?? "", lessonId: selected?.id ?? "" }, { skip: !query.data || !selected });
  if (query.isLoading) return <div className="center-state"><span className="spinner" />Opening your course…</div>;
  if (!enrollment || !query.data) return <main className="page-wrap"><div className="notice error">{query.isError ? message(query.error) : "This enrollment is unavailable."}</div><Link to="/learn">Back to learning</Link></main>;
  const course = query.data.data.course; const lesson = content.data?.data.lesson;
  return <main className="page-wrap learning-page"><Link className="back-link" to="/learn">← My learning</Link><div className="learning-header"><div><div className="eyebrow">LEARNING SPACE</div><h1>{course.title}</h1></div><div className="progress-summary"><b>{enrollment.progress.percent}%</b><span>complete</span><div className="progress-track"><span style={{ width: `${enrollment.progress.percent}%` }} /></div></div></div><div className="learning-layout"><aside className="lesson-sidebar"><div className="eyebrow">COURSE CONTENT</div><h3>{lessons.length} lessons</h3>{lessons.map((item, index) => <button className={`sidebar-lesson ${selected?.id === item.id ? "selected" : ""}`} key={item.id} onClick={() => setActiveLesson(item.id)}><span className={`lesson-check ${item.progress?.isComplete ? "done" : ""}`}>{item.progress?.isComplete ? "✓" : String(index + 1).padStart(2, "0")}</span><span><b>{item.title}</b><small>{item.estimatedDurationMinutes} min</small></span></button>)}</aside><article className="lesson-content">
    {!selected ? <div className="empty-state"><h3>No lessons available yet</h3><p>Your instructor has not published lesson content.</p></div> : content.isError ? <LessonLoadError error={content.error} retry={() => { void content.refetch(); }} /> : content.isLoading || !lesson ? <div className="center-state"><span className="spinner" />Loading lesson…</div> : <><div className="eyebrow">LESSON {String(selected.position + 1).padStart(2, "0")}</div><h2>{lesson.title}</h2><p className="lesson-description">{lesson.description}</p><div className="lesson-prose">{lesson.contentType === "text" ? lesson.content?.split("\n").map((paragraph, index) => paragraph.trim() ? <p key={index}>{paragraph}</p> : null) : lesson.externalUrl ? <a href={lesson.externalUrl} target="_blank" rel="noreferrer">Open lesson resource ↗</a> : lesson.resourceLinks?.map((link) => <p key={link.url}><a href={link.url} target="_blank" rel="noreferrer">{link.title} ↗</a></p>)}</div><div className="lesson-footer"><span className="muted">{selected.progress?.isComplete ? "Lesson completed" : "Take your time. Your progress is saved when you complete the lesson."}</span><button className="button primary" disabled={selected.progress?.isComplete || result.isLoading} onClick={() => void complete({ courseId: course.id, lessonId: selected.id })}>{selected.progress?.isComplete ? "✓ Completed" : result.isLoading ? "Saving progress…" : "Mark as complete"}</button></div>{result.isError && <p className="inline-error">{message(result.error)}</p>}</>}
  </article></div></main>;
}
