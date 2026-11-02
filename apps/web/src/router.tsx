import { createBrowserRouter } from "react-router-dom";
import { App } from "./App";
import { CourseDetailPage, CourseDiscoveryPage } from "./features/courses/discovery";
import { InstructorDashboardPage, InstructorCoursePage } from "./features/courses/instructor";
import { LearningDashboardPage, LearningPage } from "./features/courses/learning";

export const router = createBrowserRouter([{ element: <App />, children: [
  { index: true, element: <CourseDiscoveryPage /> },
  { path: "courses", element: <CourseDiscoveryPage /> },
  { path: "courses/:courseId", element: <CourseDetailPage /> },
  { path: "teach", element: <InstructorDashboardPage /> },
  { path: "teach/courses/new", element: <InstructorCoursePage /> },
  { path: "teach/courses/:courseId", element: <InstructorCoursePage /> },
  { path: "learn", element: <LearningDashboardPage /> },
  { path: "learn/:enrollmentId", element: <LearningPage /> },
  { path: "*", element: <CourseDiscoveryPage /> },
] }]);
