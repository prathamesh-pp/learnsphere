import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { csrfProtection, requireSession } from "../middleware/auth.middleware.js";

/** Register user-cookie authenticated routes here: authentication always runs before CSRF. */
export function createAuthenticatedRouter(config: AppConfig): Router {
  const router = Router();
  router.use(requireSession(config));
  router.use(csrfProtection());
  return router;
}
