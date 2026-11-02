import { Router } from "express";
import { organizationController as controller } from "../controllers/organization.controller.js";
import { requireOrganizationPermission, requirePrivilegedMfa } from "../middleware/organization-authorization.middleware.js";
import { acceptInvitationSchema, createOrganizationSchema, invitationSchema, memberQuerySchema, memberRolesSchema, updateOrganizationSchema } from "../validators/organization.validators.js";
import { createAuthenticatedRouter } from "./authenticated.router.js";
import type { AppConfig } from "../config/env.js";
function body(schema: { safeParse: (input: unknown) => { success: true; data: unknown } | { success: false } }) { return (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => { const parsed = schema.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request input is invalid." } }); return; } req.body = parsed.data; next(); }; }
export function createOrganizationRouter(config: AppConfig) {
  const router = createAuthenticatedRouter(config);
  router.get("/users/me/organizations", controller.myOrganizations);
  router.post("/organizations", requirePrivilegedMfa(config), body(createOrganizationSchema), controller.create);
  router.post("/organization-invitations/accept", body(acceptInvitationSchema), controller.accept);
  router.get("/organizations/:organizationId", requireOrganizationPermission("organization.read", config), controller.get);
  router.patch("/organizations/:organizationId", requireOrganizationPermission("organization.manage", config), body(updateOrganizationSchema), controller.update);
  router.post("/organizations/:organizationId/invitations", requireOrganizationPermission("member.invite", config), body(invitationSchema), controller.invite);
  router.get("/organizations/:organizationId/members", requireOrganizationPermission("organization.read", config), (req, res, next) => { const parsed = memberQuerySchema.safeParse(req.query); if (!parsed.success) { res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Request input is invalid." } }); return; } req.query = parsed.data as unknown as typeof req.query; controller.members(req, res, next); });
  router.patch("/organizations/:organizationId/members/:userId", requireOrganizationPermission("member.manage", config), body(memberRolesSchema), controller.changeRoles);
  router.delete("/organizations/:organizationId/members/:userId", requireOrganizationPermission("member.manage", config), controller.remove);
  return router;
}
