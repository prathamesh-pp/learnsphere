import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { OrganizationAccessError, createInvitation, createOrganization, acceptInvitation, changeMemberRoles, getOrganization, listMembers, listMyOrganizations, removeMember, updateOrganization } from "../services/organization.service.js";
function fail(error: unknown, response: Response, next: NextFunction) { if (error instanceof OrganizationAccessError) { response.status(error.status).json({ error: { code: error.code, message: error.status === 404 ? "The requested resource was not found." : error.status === 403 ? "Access is not permitted." : "The requested operation could not be completed." } }); return; } next(error); }
function requestId(request: Request) { return request.auditRequestId ?? randomUUID(); }
export const organizationController = {
  myOrganizations: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: { organizations: await listMyOrganizations(req.authContext!.userId) } }); } catch (e) { next(e); } },
  create: async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ data: await createOrganization(req.authContext!.userId, req.body, requestId(req)) }); } catch (e) { fail(e, res, next); } },
  get: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await getOrganization(req.authContext!.userId, String(req.params.organizationId)) }); } catch (e) { fail(e, res, next); } },
  update: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await updateOrganization(req.authContext!.userId, String(req.params.organizationId), req.body, requestId(req)) }); } catch (e) { fail(e, res, next); } },
  invite: async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ data: await createInvitation(req.authContext!.userId, String(req.params.organizationId), req.body, requestId(req)) }); } catch (e) { fail(e, res, next); } },
  accept: async (req: Request, res: Response, next: NextFunction) => { try { res.status(201).json({ data: await acceptInvitation(req.authContext!.userId, req.body.token, requestId(req)) }); } catch (e) { fail(e, res, next); } },
  members: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await listMembers(String(req.params.organizationId), req.query.cursor as string | undefined, Number(req.query.limit ?? 25)) }); } catch (e) { fail(e, res, next); } },
  changeRoles: async (req: Request, res: Response, next: NextFunction) => { try { res.json({ data: await changeMemberRoles(req.authContext!.userId, String(req.params.organizationId), String(req.params.userId), req.body.roles, requestId(req)) }); } catch (e) { fail(e, res, next); } },
  remove: async (req: Request, res: Response, next: NextFunction) => { try { await removeMember(req.authContext!.userId, String(req.params.organizationId), String(req.params.userId), requestId(req)); res.status(204).end(); } catch (e) { fail(e, res, next); } },
};
