import cors from "cors";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { createAuthRouter } from "./routes/auth.routes.js";
import { csrfProtection, originProtection, resolveOptionalSession } from "./middleware/auth.middleware.js";
import { isDatabaseReady } from "./config/database.js";
import type { AppConfig } from "./config/env.js";
import { createHealthRouter } from "./routes/health.routes.js";
import type { RequestHandler } from "express";
import { createOrganizationRouter } from "./routes/organization.routes.js";
import { createCourseRouter } from "./routes/course.routes.js";

export type AppDependencies = Readonly<{
  checkDatabaseReady: () => Promise<boolean>;
  /** Injectable session resolver for isolated HTTP tests; production uses the real Mongo-backed resolver. */
  resolveSession?: RequestHandler;
}>;

declare global {
  namespace Express { interface Request { auditRequestId?: string } }
}

export function createApp(config: AppConfig, dependencies: AppDependencies = {
  checkDatabaseReady: isDatabaseReady,
}) {
  const app = express();

  app.use((request, response, next) => {
    request.auditRequestId = randomUUID();
    response.setHeader("x-request-id", request.auditRequestId);
    next();
  });
  app.use(helmet());
  app.use(cors({ origin: config.webOrigin, credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(originProtection(config));
  // Health paths skip session lookup in the resolver; all routers remain after the global security chain.
  app.use(dependencies.resolveSession ?? resolveOptionalSession(config));
  app.use(csrfProtection());
  app.use("/api/v1/auth", createAuthRouter(config));
  app.use("/api/v1", createOrganizationRouter(config));
  app.use("/api/v1", createCourseRouter(config));
  app.use(createHealthRouter(dependencies.checkDatabaseReady));

  app.use((_request, response) => {
    response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } });
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    const errorType = typeof error === "object" && error !== null && "type" in error ? error.type : undefined;
    const status = errorType === "entity.too.large" ? 413 : errorType === "entity.parse.failed" ? 400 : 500;
    const code = status === 413 ? "PAYLOAD_TOO_LARGE" : status === 400 ? "INVALID_JSON" : "INTERNAL_ERROR";
    const message = status === 413 ? "Request body is too large." : status === 400 ? "Request body is invalid." : "An unexpected error occurred.";
    response.status(status).json({ error: { code, message } });
  });

  return app;
}
