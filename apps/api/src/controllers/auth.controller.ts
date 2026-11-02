import type { NextFunction, Request, Response } from "express";
import { Types } from "mongoose";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { getCurrentUser, InvalidCredentialsError, login, register, beginTotpSetup, confirmTotpSetup } from "../services/auth.service.js";
import { deriveCsrfToken, sha256, revokeSession, rotateSession } from "../services/session.service.js";
import { clearSessionCookie, parseSessionToken, setSessionCookie } from "../middleware/auth.middleware.js";
import type { AppConfig } from "../config/env.js";

export function createAuthController(config: AppConfig) {
  return {
    register: async (request: Request, response: Response, next: NextFunction) => {
      try {
        await register(request.body as { email: string; displayName: string; password: string });
        response.status(202).json({ data: { message: "If the address is eligible, registration has been accepted." } });
      } catch (error) { next(error); }
    },
    login: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const result = await login(request.body as { email: string; password: string; totpCode?: string; recoveryCode?: string }, config);
        setSessionCookie(response, config, result.session.token, result.session.expiresAt);
        response.status(200).json({ data: { user: result.user } });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) {
          response.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } });
          return;
        }
        next(error);
      }
    },
    logout: async (request: Request, response: Response) => {
      const token = parseSessionToken(request, config);
      if (token) await revokeSession(token);
      clearSessionCookie(response, config);
      response.status(204).end();
    },
    rotate: async (request: Request, response: Response) => {
      const token = parseSessionToken(request, config);
      if (!token || !request.authContext) { clearSessionCookie(response, config); response.status(401).end(); return; }
      const session = await rotateSession(token, new Types.ObjectId(request.authContext.userId), config.sessionIdleTimeoutSeconds, config.mfaEncryptionKey);
      if (!session) { clearSessionCookie(response, config); response.status(401).end(); return; }
      setSessionCookie(response, config, session.token, session.expiresAt);
      response.status(204).end();
    },
    currentUser: async (request: Request, response: Response) => {
      const user = await getCurrentUser(request.authContext!.userId);
      if (!user) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
      response.status(200).json({ data: { user } });
    },
    csrf: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const sessionToken = parseSessionToken(request, config);
        if (!sessionToken) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
        const csrfToken = deriveCsrfToken(sessionToken, config.mfaEncryptionKey);
        if (sha256(csrfToken) !== request.authContext!.csrfTokenHash) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
        response.status(200).json({ data: { csrfToken } });
      } catch (error) { next(error); }
    },
    recoveryInitiation: (_request: Request, response: Response) => {
      // No delivery provider is configured. Always return the same response and never create a usable token.
      response.status(503).json({ error: { code: "RECOVERY_UNAVAILABLE", message: "Account recovery is not enabled yet." } });
    },
    beginMfa: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const verifiedAt = request.authContext!.mfaVerifiedAt?.getTime() ?? 0;
        const verifiedRecently = request.authContext!.mfaVerified && Date.now() - verifiedAt <= config.platformAdminSensitiveMfaMaxAgeSeconds * 1000;
        const setup = await beginTotpSetup(request.authContext!.userId, request.authContext!.sessionId, config.mfaEncryptionKey, verifiedRecently);
        response.status(200).json({ data: setup });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) { response.status(403).json({ error: { code: "MFA_REAUTH_REQUIRED", message: "Recent MFA verification is required to change the MFA factor." } }); return; }
        next(error);
      }
    },
    confirmMfa: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const codes = await confirmTotpSetup(request.authContext!.userId, request.authContext!.sessionId, (request.body as { code: string }).code, config.mfaEncryptionKey);
        clearSessionCookie(response, config);
        response.status(200).json({ data: { enabled: true, recoveryCodes: codes } });
      } catch (error) {
        if (error instanceof InvalidCredentialsError) { response.status(400).json({ error: { code: "MFA_SETUP_INVALID", message: "The MFA setup could not be confirmed." } }); return; }
        next(error);
      }
    },
    mfaStatus: async (request: Request, response: Response, next: NextFunction) => {
      try {
        const credential = await UserCredentialModel.findOne({ userId: request.authContext!.userId }).select("mfaEnabled").lean();
        response.status(200).json({ data: { enabled: Boolean(credential?.mfaEnabled) } });
      } catch (error) { next(error); }
    },
  };
}
