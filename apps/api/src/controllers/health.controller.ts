import type { Request, Response } from "express";

export type DatabaseReadinessCheck = () => Promise<boolean>;

export function getLiveness(_request: Request, response: Response): void {
  response.status(200).json({ status: "ok" });
}

export function createReadinessHandler(checkDatabase: DatabaseReadinessCheck) {
  return async function getReadiness(_request: Request, response: Response): Promise<void> {
    let databaseReady = false;
    try {
      databaseReady = await checkDatabase();
    } catch {
      databaseReady = false;
    }

    if (!databaseReady) {
      response.status(503).json({
        status: "not_ready",
        dependencies: { mongodb: "unavailable" },
      });
      return;
    }

    response.status(200).json({
      status: "ready",
      dependencies: { mongodb: "ready" },
    });
  };
}
