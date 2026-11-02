import { Router } from "express";
import {
  createReadinessHandler,
  getLiveness,
  type DatabaseReadinessCheck,
} from "../controllers/health.controller.js";

export function createHealthRouter(checkDatabase: DatabaseReadinessCheck): Router {
  const router = Router();
  const readinessHandler = createReadinessHandler(checkDatabase);

  router.get("/api/health", getLiveness);
  router.get("/health/live", getLiveness);
  router.get("/health/ready", readinessHandler);

  return router;
}
