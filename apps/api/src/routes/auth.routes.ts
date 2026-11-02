import { Router } from "express";
import type { AppConfig } from "../config/env.js";
import { createAuthController } from "../controllers/auth.controller.js";
import { createAuthRateLimiter } from "../middleware/auth-rate-limit.middleware.js";
import { createAuthenticatedRouter } from "./authenticated.router.js";
import { loginSchema, recoveryInitiationSchema, registrationSchema, totpVerifySchema } from "../validators/auth.validators.js";

function validateBody<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }) {
  return (request: import("express").Request, response: import("express").Response, next: import("express").NextFunction): void => {
    const parsed = schema.safeParse(request.body);
    if (!parsed.success) { response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request input is invalid." } }); return; }
    request.body = parsed.data;
    next();
  };
}

export function createAuthRouter(config: AppConfig): Router {
  const router = Router();
  const controller = createAuthController(config);
  const registrationLimiter = createAuthRateLimiter(3, 60 * 60 * 1000);
  const loginLimiter = createAuthRateLimiter(10, 15 * 60 * 1000);
  const recoveryLimiter = createAuthRateLimiter(3, 60 * 60 * 1000);
  const mfaLimiter = createAuthRateLimiter(5, 15 * 60 * 1000);
  const authenticated = createAuthenticatedRouter(config);

  router.post("/register", registrationLimiter, validateBody(registrationSchema), controller.register);
  router.post("/login", loginLimiter, validateBody(loginSchema), controller.login);
  router.post("/recovery", recoveryLimiter, validateBody(recoveryInitiationSchema), controller.recoveryInitiation);
  authenticated.get("/csrf", controller.csrf);
  authenticated.get("/me", controller.currentUser);
  authenticated.post("/logout", controller.logout);
  authenticated.post("/session/rotate", controller.rotate);
  authenticated.get("/mfa/totp", controller.mfaStatus);
  authenticated.post("/mfa/totp/setup", mfaLimiter, controller.beginMfa);
  authenticated.post("/mfa/totp/confirm", mfaLimiter, validateBody(totpVerifySchema), controller.confirmMfa);
  router.use(authenticated);
  return router;
}
