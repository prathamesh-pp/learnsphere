import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { OrganizationModel } from "../models/organization.model.js";
import { OrganizationMembershipModel } from "../models/organization-membership.model.js";
import { AuditEventModel } from "../models/audit-event.model.js";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { rolesAllow } from "../services/organization.service.js";
import type { AppConfig } from "../config/env.js";

export function requirePrivilegedMfa(config: AppConfig): RequestHandler {
  return async (request, response, next) => {
    const context = request.authContext;
    const now = Date.now();
    const verifiedAt = context?.mfaVerifiedAt?.getTime();
    if (!context || !context.mfaVerified || verifiedAt === undefined || verifiedAt > now || now - verifiedAt > config.platformAdminSensitiveMfaMaxAgeSeconds * 1000) {
      response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return;
    }
    try {
      const configured = await UserCredentialModel.exists({ userId: context.userId, mfaEnabled: true, totpSecretEncrypted: { $type: "string", $ne: "" } });
      if (!configured) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      next();
    } catch { response.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization is temporarily unavailable." } }); }
  };
}

export function requireOrganizationPermission(permission: string, config: AppConfig): RequestHandler {
  return async (request, response, next) => {
    const actor = request.authContext?.userId;
    const tenant = String(request.params.organizationId ?? "");
    if (!actor) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    if (!tenant || !Types.ObjectId.isValid(tenant)) { response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
    try {
      const org = await OrganizationModel.findOne({ _id: tenant, status: "active" }).select("_id").lean();
      const member = await OrganizationMembershipModel.findOne({ tenantId: new Types.ObjectId(tenant), userId: new Types.ObjectId(actor), status: "active" }).select("roles").lean();
      if (!org || !member) { await recordDenied(request, actor, tenant, permission); response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
      if (!rolesAllow(member.roles, permission)) { await recordDenied(request, actor, tenant, permission); response.status(403).json({ error: { code: "FORBIDDEN", message: "Access is not permitted." } }); return; }
      if (member.roles.includes("ORGANIZATION_ADMIN") || member.roles.includes("COMPANY_ADMIN")) {
        const context = request.authContext!;
        const now = Date.now(); const verifiedAt = context.mfaVerifiedAt?.getTime();
        const maxAge = permission === "organization.read" ? config.platformAdminMfaMaxAgeSeconds : config.platformAdminSensitiveMfaMaxAgeSeconds;
        if (!context.mfaVerified || verifiedAt === undefined || verifiedAt > now || now - verifiedAt > maxAge * 1000) {
          response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return;
        }
        const configured = await UserCredentialModel.exists({ userId: actor, mfaEnabled: true, totpSecretEncrypted: { $type: "string", $ne: "" } });
        if (!configured) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      }
      next();
    } catch { response.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization is temporarily unavailable." } }); }
  };
}

async function recordDenied(request: import("express").Request, actorId: string, tenantId: string, permission: string) {
  await AuditEventModel.create({
    ...(Types.ObjectId.isValid(tenantId) ? { tenantId: new Types.ObjectId(tenantId) } : {}),
    actorId: new Types.ObjectId(actorId), action: "authorization.denied", resourceType: "organization", resourceId: tenantId,
    requestId: request.auditRequestId ?? "unavailable", occurredAt: new Date(), metadata: { permission },
  });
}
