import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response, RequestHandler } from "express";
import { AuthSessionModel } from "../models/auth-session.model.js";
import { UserModel } from "../models/user.model.js";
import { findActivePlatformGrant } from "../services/platform-authorization.service.js";
import { UserCredentialModel } from "../models/user-credential.model.js";
import type { AppConfig } from "../config/env.js";
import { PRODUCTION_SESSION_COOKIE, SESSION_COOKIE, sha256 } from "../services/session.service.js";

declare global {
  namespace Express {
    interface Request { authContext?: { userId: string; sessionId: string; csrfTokenHash: string; mfaVerified: boolean; mfaVerifiedAt?: Date }; }
  }
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) {
      const token = value.join("=");
      return /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : undefined;
    }
  }
  return undefined;
}

async function authenticateSession(request: Request, config: AppConfig, token: string): Promise<boolean> {
  const session = await AuthSessionModel.findOneAndUpdate({
    tokenHash: sha256(token), revokedAt: null,
    $expr: { $and: [{ $gt: ["$expiresAt", "$$NOW"] }, { $gt: ["$absoluteExpiresAt", "$$NOW"] }] },
  }, [{ $set: {
    lastSeenAt: "$$NOW",
    // Apply idle expiry using MongoDB server time and cap it in this same atomic write.
    expiresAt: { $min: [{ $add: ["$$NOW", config.sessionIdleTimeoutSeconds * 1000] }, "$absoluteExpiresAt"] },
  } }], { new: true }).select("userId expiresAt absoluteExpiresAt csrfTokenHash mfaVerifiedAt");
  if (!session) return false;
  const userExists = await UserModel.exists({ _id: session.userId, status: "active" });
  if (!userExists) return false;
  const mfaVerifiedAt = session.get("mfaVerifiedAt") as Date | undefined;
  request.authContext = {
    userId: session.userId.toString(),
    sessionId: session._id.toString(),
    csrfTokenHash: session.get("csrfTokenHash") as string,
    mfaVerified: Boolean(mfaVerifiedAt),
    ...(mfaVerifiedAt ? { mfaVerifiedAt } : {}),
  };
  return true;
}

/** Resolves an existing cookie session before the application-wide CSRF guard. */
export function resolveOptionalSession(config: AppConfig) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    const infrastructureProbe = ["/api/health", "/health/live", "/health/ready"].includes(request.path);
    if (infrastructureProbe && ["GET", "HEAD"].includes(request.method)) { next(); return; }
    const token = cookieValue(request.headers.cookie, sessionCookieName(config));
    if (!token) { next(); return; }
    try {
      await authenticateSession(request, config, token);
      next();
    } catch {
      response.status(503).json({ error: { code: "SESSION_VALIDATION_UNAVAILABLE", message: "Authentication is temporarily unavailable." } });
    }
  };
}

export function sessionCookieName(config: AppConfig): string {
  return config.nodeEnv === "production" ? PRODUCTION_SESSION_COOKIE : SESSION_COOKIE;
}

export function setSessionCookie(response: Response, config: AppConfig, token: string, expiresAt: Date): void {
  const maxAge = Math.max(0, expiresAt.getTime() - Date.now());
  response.append("Set-Cookie", `${sessionCookieName(config)}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAge / 1000)}${config.nodeEnv === "production" ? "; Secure" : ""}`);
}

export function clearSessionCookie(response: Response, config: AppConfig): void {
  response.append("Set-Cookie", `${sessionCookieName(config)}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.nodeEnv === "production" ? "; Secure" : ""}`);
}

export function requireSession(config: AppConfig) {
  return async (request: Request, response: Response, next: NextFunction): Promise<void> => {
    if (request.authContext) { next(); return; }
    try {
      const token = cookieValue(request.headers.cookie, sessionCookieName(config));
      if (!token) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
      if (!await authenticateSession(request, config, token)) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
      next();
    } catch {
      next(new Error("AUTHENTICATION_INTERNAL"));
    }
  };
}

export type PlatformAuthorizationOptions = Readonly<{ permission?: string; sensitive?: boolean }>;

/** Canonical query: revokedAt:null matches both null and an absent field in MongoDB. */
/** Compose after authentication; grant and MFA state are re-read from server-side state on every request. */
export function requirePlatformAdmin(config: AppConfig, options: PlatformAuthorizationOptions = {}) {
  const maxMfaAgeSeconds = options.sensitive
    ? config.platformAdminSensitiveMfaMaxAgeSeconds
    : config.platformAdminMfaMaxAgeSeconds;

  const authorize: RequestHandler = async (request, response, next) => {
    const context = request.authContext;
    if (!context) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    const verifiedAt = context.mfaVerifiedAt?.getTime();
    const now = Date.now();
    try {
      const grant = await findActivePlatformGrant(context.userId, new Date(now), options.permission);
      if (!grant) { response.status(403).json({ error: { code: "FORBIDDEN", message: "Access is not permitted." } }); return; }
      const mfaConfigured = await UserCredentialModel.exists({ userId: context.userId, mfaEnabled: true, totpSecretEncrypted: { $type: "string", $ne: "" } });
      if (!mfaConfigured) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      if (verifiedAt === undefined || verifiedAt > now || now - verifiedAt > maxMfaAgeSeconds * 1000) {
        response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return;
      }
      next();
    } catch {
      response.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization is temporarily unavailable." } });
    }
  };
  return [requireSession(config), authorize] as const;
}

export function originProtection(config: AppConfig) {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method)) { next(); return; }
    if (request.get("origin") !== config.webOrigin) {
      response.status(403).json({ error: { code: "ORIGIN_REJECTED", message: "Request origin is not allowed." } }); return;
    }
    next();
  };
}

export function csrfProtection() {
  return (request: Request, response: Response, next: NextFunction): void => {
    if (["GET", "HEAD", "OPTIONS"].includes(request.method) || !request.authContext) { next(); return; }
    const supplied = request.get("x-csrf-token");
    if (!supplied || !/^[A-Za-z0-9_-]{40,64}$/.test(supplied)) {
      response.status(403).json({ error: { code: "CSRF_REJECTED", message: "Request could not be verified." } }); return;
    }
    const expected = Buffer.from(request.authContext.csrfTokenHash);
    const actual = Buffer.from(sha256(supplied));
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      response.status(403).json({ error: { code: "CSRF_REJECTED", message: "Request could not be verified." } }); return;
    }
    next();
  };
}

export function parseSessionToken(request: Request, config: AppConfig): string | undefined {
  const match = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${sessionCookieName(config)}=`));
  const token = match?.slice(sessionCookieName(config).length + 1);
  return token && /^[A-Za-z0-9_-]{40,64}$/.test(token) ? token : undefined;
}
