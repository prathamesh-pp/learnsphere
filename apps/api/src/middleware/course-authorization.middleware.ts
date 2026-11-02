import type { RequestHandler } from "express";
import { Types } from "mongoose";
import { CourseModel } from "../models/course.model.js";
import { OrganizationMembershipModel } from "../models/organization-membership.model.js";
import { OrganizationModel } from "../models/organization.model.js";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { rolesAllow } from "../services/organization.service.js";
import type { AppConfig } from "../config/env.js";

export function requireManagedCourse(config: AppConfig, sensitive = false): RequestHandler {
  return async (request, response, next) => {
    const actor = request.authContext?.userId;
    const rawCourseId = String(request.params.courseId ?? "");
    if (!actor) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    if (!Types.ObjectId.isValid(rawCourseId)) { response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
    try {
      const course = await CourseModel.findOne({ _id: new Types.ObjectId(rawCourseId), ownerScope: "organization" }).select("tenantId ownerId").lean();
      if (!course?.tenantId) { response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
      const [organization, member] = await Promise.all([
        OrganizationModel.exists({ _id: course.tenantId, status: "active" }),
        OrganizationMembershipModel.findOne({ tenantId: course.tenantId, userId: new Types.ObjectId(actor), status: "active" }).select("roles").lean(),
      ]);
      if (!organization || !member) { response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
      const isAdmin = rolesAllow(member.roles, "course.manage");
      const ownsCourse = course.ownerId.equals(new Types.ObjectId(actor)) && rolesAllow(member.roles, "course.manage.own");
      if (!isAdmin && !ownsCourse) { response.status(404).json({ error: { code: "NOT_FOUND", message: "The requested resource was not found." } }); return; }
      if (isAdmin) {
        const context = request.authContext!; const now = Date.now(); const verifiedAt = context.mfaVerifiedAt?.getTime();
        const maxAge = sensitive ? config.platformAdminSensitiveMfaMaxAgeSeconds : config.platformAdminMfaMaxAgeSeconds;
        if (!context.mfaVerified || verifiedAt === undefined || verifiedAt > now || now - verifiedAt > maxAge * 1000) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
        const configured = await UserCredentialModel.exists({ userId: actor, mfaEnabled: true, totpSecretEncrypted: { $type: "string", $ne: "" } });
        if (!configured) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      }
      next();
    } catch { response.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization is temporarily unavailable." } }); }
  };
}

export function requireManagedCourseList(config: AppConfig): RequestHandler {
  return async (request, response, next) => {
    const actor = request.authContext?.userId;
    if (!actor) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Authentication is required." } }); return; }
    try {
      const memberships = await OrganizationMembershipModel.find({ userId: new Types.ObjectId(actor), status: "active", roles: { $in: ["ORGANIZATION_ADMIN", "COMPANY_ADMIN"] } }).select("roles").lean();
      if (!memberships.some((member) => rolesAllow(member.roles, "course.manage"))) { next(); return; }
      const context = request.authContext!; const now = Date.now(); const verifiedAt = context.mfaVerifiedAt?.getTime();
      if (!context.mfaVerified || verifiedAt === undefined || verifiedAt > now || now - verifiedAt > config.platformAdminMfaMaxAgeSeconds * 1000) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      const configured = await UserCredentialModel.exists({ userId: actor, mfaEnabled: true, totpSecretEncrypted: { $type: "string", $ne: "" } });
      if (!configured) { response.status(403).json({ error: { code: "MFA_REQUIRED", message: "Recent multi-factor verification is required." } }); return; }
      next();
    } catch { response.status(503).json({ error: { code: "AUTHORIZATION_UNAVAILABLE", message: "Authorization is temporarily unavailable." } }); }
  };
}
