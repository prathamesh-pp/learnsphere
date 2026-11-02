import { z } from "zod";
import { ORGANIZATION_KINDS } from "../models/organization.model.js";
import { ORGANIZATION_ROLES } from "../models/organization-membership.model.js";
export const createOrganizationSchema = z.object({ name: z.string().trim().min(1).max(120), slug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80), kind: z.enum(ORGANIZATION_KINDS), settings: z.record(z.string(), z.unknown()).optional() }).strict();
export const invitationSchema = z.object({ email: z.string().trim().email().max(254), roles: z.array(z.enum(ORGANIZATION_ROLES)).min(1).max(6) }).strict();
export const acceptInvitationSchema = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict();
export const memberRolesSchema = z.object({ roles: z.array(z.enum(ORGANIZATION_ROLES)).min(1).max(6) }).strict();
export const memberQuerySchema = z.object({ cursor: z.string().regex(/^[a-f\d]{24}$/i).optional(), limit: z.coerce.number().int().min(1).max(100).default(25) }).strict();
export const updateOrganizationSchema = z.object({ name: z.string().trim().min(1).max(120).optional(), settings: z.record(z.string(), z.unknown()).optional() }).strict().refine((value) => Object.keys(value).length > 0);
