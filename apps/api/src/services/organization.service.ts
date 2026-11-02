import { randomBytes } from "node:crypto";
import mongoose, { Types } from "mongoose";
import { OrganizationModel, ORGANIZATION_KINDS } from "../models/organization.model.js";
import { OrganizationMembershipModel, ORGANIZATION_ROLES, type OrganizationRole } from "../models/organization-membership.model.js";
import { OrganizationInvitationModel } from "../models/organization-invitation.model.js";
import { AuditEventModel } from "../models/audit-event.model.js";
import { UserModel } from "../models/user.model.js";
import { sha256 } from "./session.service.js";

export class OrganizationAccessError extends Error { constructor(readonly status: 403 | 404 | 409 | 422, readonly code: string) { super(code); } }
const rolePermissions: Record<OrganizationRole, readonly string[]> = {
  STUDENT: ["organization.read", "course.read"], INSTRUCTOR: ["organization.read", "course.read", "course.create", "course.manage.own"], RECRUITER: ["organization.read"], MENTOR: ["organization.read"],
  COMPANY_ADMIN: ["organization.read", "organization.manage", "member.manage", "member.invite", "course.read", "course.create", "course.manage"],
  ORGANIZATION_ADMIN: ["organization.read", "organization.manage", "member.manage", "member.invite", "course.read", "course.create", "course.manage"],
};
export const ALL_ORGANIZATION_ROLES = ORGANIZATION_ROLES;
export function rolesAllow(roles: readonly string[], permission: string): boolean {
  return roles.some((role) => Object.hasOwn(rolePermissions, role) && rolePermissions[role as OrganizationRole].includes(permission));
}
function objectId(value: string): Types.ObjectId { if (!Types.ObjectId.isValid(value)) throw new OrganizationAccessError(404, "NOT_FOUND"); return new Types.ObjectId(value); }
function audit(tenantId: Types.ObjectId, actorId: Types.ObjectId, action: string, resourceType: string, resourceId: string, requestId: string, metadata: Record<string, unknown> = {}) {
  return { tenantId, actorId, action, resourceType, resourceId, requestId, occurredAt: new Date(), metadata };
}
function safeSettings(input: unknown): Record<string, unknown> {
  if (input === undefined) return {};
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 20) throw new OrganizationAccessError(422, "VALIDATION_ERROR");
  const json = JSON.stringify(input);
  if (json.length > 4096 || /secret|token|password|credential|key/i.test(json)) throw new OrganizationAccessError(422, "VALIDATION_ERROR");
  return input as Record<string, unknown>;
}

export async function createOrganization(actorId: string, input: { name: string; slug: string; kind: typeof ORGANIZATION_KINDS[number]; settings?: unknown }, requestId: string) {
  const actor = objectId(actorId);
  const slug = input.slug.trim().toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 80 || !name || name.length > 120 || !ORGANIZATION_KINDS.includes(input.kind)) throw new OrganizationAccessError(422, "VALIDATION_ERROR");
  try {
    let result!: { organization: Record<string, unknown>; membership: Record<string, unknown> };
    await mongoose.connection.transaction(async (session) => {
      const [org] = await OrganizationModel.create([{ name, slug, kind: input.kind, settings: safeSettings(input.settings), createdBy: actor }], { session });
      if (!org) throw new Error("Organization was not created.");
      const ownerRole = input.kind === "company" ? "COMPANY_ADMIN" : "ORGANIZATION_ADMIN";
      const [member] = await OrganizationMembershipModel.create([{ tenantId: org._id, userId: actor, status: "active", roles: [ownerRole], joinedAt: new Date() }], { session });
      if (!member) throw new Error("Owner membership was not created.");
      await AuditEventModel.create([audit(org._id, actor, "organization.created", "organization", org.id, requestId, { kind: input.kind })], { session });
      result = { organization: { id: org.id, name: org.name, slug: org.slug, kind: org.kind, status: org.status, settings: org.settings, createdBy: org.createdBy, createdAt: org.createdAt, updatedAt: org.updatedAt }, membership: member.toObject() };
    });
    return result;
  } catch (error) { if (isDuplicate(error)) throw new OrganizationAccessError(409, "ORGANIZATION_SLUG_TAKEN"); throw error; }
}

export async function getOrganization(actorId: string, tenant: string) {
  const tenantId = objectId(tenant);
  const member = await OrganizationMembershipModel.findOne({ tenantId, userId: objectId(actorId), status: "active" }).select("_id").lean();
  if (!member) throw new OrganizationAccessError(404, "NOT_FOUND");
  const org = await OrganizationModel.findOne({ _id: tenantId, status: "active" }).lean();
  if (!org) throw new OrganizationAccessError(404, "NOT_FOUND");
  return org;
}

export async function updateOrganization(actorId: string, tenant: string, input: { name?: string; settings?: unknown }, requestId: string) {
  const tenantId = objectId(tenant); const actor = objectId(actorId);
  if (input.name !== undefined && (!input.name.trim() || input.name.trim().length > 120)) throw new OrganizationAccessError(422, "VALIDATION_ERROR");
  return mongoose.connection.transaction(async (session) => {
    const actorMember = await OrganizationMembershipModel.findOne({ tenantId, userId: actor, status: "active" }).select("roles").session(session).lean();
    if (!actorMember || !rolesAllow(actorMember.roles, "organization.manage")) throw new OrganizationAccessError(403, "FORBIDDEN");
    const org = await OrganizationModel.findOne({ _id: tenantId, status: "active" }).session(session);
    if (!org) throw new OrganizationAccessError(404, "NOT_FOUND");
    if (input.name !== undefined) org.name = input.name.trim();
    if (input.settings !== undefined) org.settings = safeSettings(input.settings);
    await org.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "organization.settings.changed", "organization", org.id, requestId, { changedFields: Object.keys(input) })], { session });
    return org.toObject();
  });
}

export async function listMembers(tenant: string, cursor?: string, limit = 25) {
  const tenantId = objectId(tenant);
  const filter = { tenantId, status: "active", ...(cursor ? { _id: { $gt: objectId(cursor) } } : {}) };
  const rows = await OrganizationMembershipModel.find(filter).sort({ _id: 1 }).limit(Math.min(limit, 100) + 1).select("userId status roles joinedAt createdAt").lean();
  const hasMore = rows.length > Math.min(limit, 100);
  const items = rows.slice(0, Math.min(limit, 100));
  return { items, nextCursor: hasMore ? items.at(-1)?._id.toString() : null, hasMore };
}

export async function listMyOrganizations(actorId: string) {
  const actor = objectId(actorId);
  const memberships = await OrganizationMembershipModel.find({ userId: actor, status: "active" }).select("tenantId roles joinedAt").lean();
  if (!memberships.length) return [];
  const organizations = await OrganizationModel.find({ _id: { $in: memberships.map((item) => item.tenantId) }, status: "active" }).select("name slug kind").sort({ name: 1 }).lean();
  const byId = new Map(memberships.map((item) => [item.tenantId.toString(), item]));
  return organizations.map((organization) => {
    const member = byId.get(organization._id.toString());
    return { id: organization._id.toString(), name: organization.name, slug: organization.slug, kind: organization.kind, roles: member?.roles ?? [], joinedAt: member?.joinedAt ?? null };
  });
}

export async function createInvitation(actorId: string, tenant: string, input: { email: string; roles: OrganizationRole[] }, requestId: string) {
  const tenantId = objectId(tenant); const actor = objectId(actorId);
  const emailNormalized = input.email.trim().toLowerCase();
  const roles = [...new Set(input.roles)];
  if (!emailNormalized || roles.length === 0 || roles.some((role) => !ORGANIZATION_ROLES.includes(role))) throw new OrganizationAccessError(422, "VALIDATION_ERROR");
  const invitedUser = await UserModel.findOne({ emailNormalized }).select("_id").lean();
  if (invitedUser && await OrganizationMembershipModel.exists({ tenantId, userId: invitedUser._id, status: "active" })) throw new OrganizationAccessError(409, "MEMBERSHIP_EXISTS");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  try {
    const invite = await mongoose.connection.transaction(async (session) => {
      // Serialize invite authorization with role changes/removal, then read the current grant in this transaction.
      const locked = await OrganizationModel.updateOne({ _id: tenantId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { session });
      if (locked.matchedCount !== 1) throw new OrganizationAccessError(404, "NOT_FOUND");
      const inviter = await OrganizationMembershipModel.findOne({ tenantId, userId: actor, status: "active" }).select("roles").session(session).lean();
      if (!inviter || !rolesAllow(inviter.roles, "member.invite") || roles.some((role) => role === "ORGANIZATION_ADMIN" && !inviter.roles.includes("ORGANIZATION_ADMIN") || role === "COMPANY_ADMIN" && !inviter.roles.includes("COMPANY_ADMIN"))) throw new OrganizationAccessError(403, "FORBIDDEN");
      const [created] = await OrganizationInvitationModel.create([{ tenantId, emailNormalized, tokenHash: sha256(token), roles, invitedBy: actor, expiresAt }], { session });
      if (!created) throw new Error("Invitation was not created.");
      await AuditEventModel.create([audit(tenantId, actor, "organization.invitation.created", "organizationInvitation", created.id, requestId, { roles, expiresAt: expiresAt.toISOString() })], { session });
      return created;
    });
    return { id: invite.id, email: emailNormalized, roles, status: "pending", expiresAt, delivery: "not_configured", shareTokenOnce: token };
  } catch (error) { if (isDuplicate(error)) throw new OrganizationAccessError(409, "INVITATION_EXISTS"); throw error; }
}

export async function acceptInvitation(actorId: string, token: string, requestId: string) {
  const actor = objectId(actorId); const tokenHash = sha256(token); const now = new Date();
  await OrganizationInvitationModel.updateOne({ tokenHash, status: "pending", expiresAt: { $lte: now } }, { $set: { status: "expired" } });
  return mongoose.connection.transaction(async (session) => {
    const invite = await OrganizationInvitationModel.findOneAndUpdate({ tokenHash, status: "pending", expiresAt: { $gt: now } }, { $set: { status: "accepted", acceptedAt: now } }, { new: true, session }).select("+tokenHash");
    if (!invite) throw new OrganizationAccessError(404, "INVITATION_INVALID");
    const tenantLock = await OrganizationModel.updateOne({ _id: invite.tenantId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { session });
    if (tenantLock.matchedCount !== 1) throw new OrganizationAccessError(404, "INVITATION_INVALID");
    const user = await UserModel.findOne({ _id: actor, status: "active", emailNormalized: invite.emailNormalized }).select("_id").session(session).lean();
    if (!user) throw new OrganizationAccessError(403, "INVITATION_ACCOUNT_MISMATCH");
    const prior = await OrganizationMembershipModel.findOne({ tenantId: invite.tenantId, userId: actor }).session(session);
    if (prior && prior.status !== "left") throw new OrganizationAccessError(409, "MEMBERSHIP_EXISTS");
    let member;
    if (prior) {
      prior.status = "active"; prior.roles = invite.roles; prior.joinedAt = now; prior.invitedBy = invite.invitedBy;
      member = await prior.save({ session });
    } else {
      [member] = await OrganizationMembershipModel.create([{ tenantId: invite.tenantId, userId: actor, status: "active", roles: invite.roles, joinedAt: now, invitedBy: invite.invitedBy }], { session });
    }
    if (!member) throw new Error("Membership was not created.");
    await AuditEventModel.create([audit(invite.tenantId, actor, "organization.invitation.accepted", "organizationInvitation", invite.id, requestId, { membershipId: member.id, roles: invite.roles })], { session });
    return member.toObject();
  }).catch((error: unknown) => { if (isDuplicate(error)) throw new OrganizationAccessError(409, "MEMBERSHIP_EXISTS"); throw error; });
}

export async function changeMemberRoles(actorId: string, tenant: string, target: string, roles: OrganizationRole[], requestId: string) {
  const tenantId = objectId(tenant); const actor = objectId(actorId); const userId = objectId(target); const normalized = [...new Set(roles)];
  if (!normalized.length || normalized.some((role) => !ORGANIZATION_ROLES.includes(role))) throw new OrganizationAccessError(403, "FORBIDDEN");
  return mongoose.connection.transaction(async (session) => {
    // Serialize authorization mutations for this tenant so concurrent last-owner operations cannot both pass a snapshot count.
    const locked = await OrganizationModel.updateOne({ _id: tenantId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { session });
    if (locked.matchedCount !== 1) throw new OrganizationAccessError(404, "NOT_FOUND");
    const member = await OrganizationMembershipModel.findOne({ tenantId, userId, status: "active" }).session(session);
    if (!member) throw new OrganizationAccessError(404, "NOT_FOUND");
    const actorMember = await OrganizationMembershipModel.findOne({ tenantId, userId: actor, status: "active" }).select("roles").session(session).lean();
    if (!actorMember || !rolesAllow(actorMember.roles, "member.manage") || normalized.some((role) => role === "ORGANIZATION_ADMIN" && !actorMember.roles.includes("ORGANIZATION_ADMIN") || role === "COMPANY_ADMIN" && !actorMember.roles.includes("COMPANY_ADMIN"))) throw new OrganizationAccessError(403, "FORBIDDEN");
    const previous = member.roles;
    const ownerRole = previous.includes("COMPANY_ADMIN") ? "COMPANY_ADMIN" : "ORGANIZATION_ADMIN";
    if (previous.includes(ownerRole) && !normalized.includes(ownerRole)) {
      const owners = await OrganizationMembershipModel.countDocuments({ tenantId, status: "active", roles: ownerRole, _id: { $ne: member._id } }).session(session);
      if (owners < 1) throw new OrganizationAccessError(409, "LAST_OWNER");
    }
    member.roles = normalized; await member.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "organization.member.roles_changed", "organizationMembership", member.id, requestId, { targetUserId: target, previousRoles: previous, roles: normalized })], { session });
    return member.toObject();
  });
}

export async function removeMember(actorId: string, tenant: string, target: string, requestId: string) {
  const tenantId = objectId(tenant); const actor = objectId(actorId); const userId = objectId(target);
  return mongoose.connection.transaction(async (session) => {
    // The organization document is the shared write lock for all owner membership changes.
    const locked = await OrganizationModel.updateOne({ _id: tenantId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { session });
    if (locked.matchedCount !== 1) throw new OrganizationAccessError(404, "NOT_FOUND");
    const member = await OrganizationMembershipModel.findOne({ tenantId, userId, status: "active" }).session(session);
    if (!member) throw new OrganizationAccessError(404, "NOT_FOUND");
    const actorMember = await OrganizationMembershipModel.findOne({ tenantId, userId: actor, status: "active" }).select("roles").session(session).lean();
    if (!actorMember || !rolesAllow(actorMember.roles, "member.manage")) throw new OrganizationAccessError(403, "FORBIDDEN");
    if (member.roles.includes("ORGANIZATION_ADMIN") || member.roles.includes("COMPANY_ADMIN")) {
      const ownerRole = member.roles.includes("COMPANY_ADMIN") ? "COMPANY_ADMIN" : "ORGANIZATION_ADMIN";
      const owners = await OrganizationMembershipModel.countDocuments({ tenantId, status: "active", roles: ownerRole }).session(session);
      if (owners <= 1) throw new OrganizationAccessError(409, "LAST_OWNER");
    }
    member.status = "left"; await member.save({ session });
    await AuditEventModel.create([audit(tenantId, actor, "organization.member.removed", "organizationMembership", member.id, requestId, { targetUserId: target })], { session });
  });
}

function isDuplicate(error: unknown): boolean { return typeof error === "object" && error !== null && "code" in error && error.code === 11000; }
