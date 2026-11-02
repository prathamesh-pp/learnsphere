import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose, { Types } from "mongoose";
import test, { after, afterEach, before } from "node:test";
import { OrganizationModel } from "../../src/models/organization.model.js";
import { OrganizationMembershipModel } from "../../src/models/organization-membership.model.js";
import { OrganizationInvitationModel } from "../../src/models/organization-invitation.model.js";
import { AuditEventModel } from "../../src/models/audit-event.model.js";
import { UserModel } from "../../src/models/user.model.js";
import { createOrganization, createInvitation, acceptInvitation, changeMemberRoles, getOrganization, removeMember, updateOrganization, OrganizationAccessError } from "../../src/services/organization.service.js";
import { sha256 } from "../../src/services/session.service.js";

const uri = process.env.LMS_INTEGRATION_MONGODB_URI;
if (!uri) throw new Error("LMS_INTEGRATION_MONGODB_URI must explicitly point to the isolated test replica set.");
const parsed = new URL(uri);
if (!(parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") || parsed.pathname.replace(/^\//, "").split("/")[0] !== "learnsphere_phase2_test" || parsed.searchParams.get("replicaSet") !== "rs0") throw new Error("Integration tests only permit the local learnsphere_phase2_test replica set.");
const runId = randomUUID();
const users: Types.ObjectId[] = [];
const orgs: Types.ObjectId[] = [];
let counter = 0;
async function user() {
  const item = await UserModel.create({ emailNormalized: `org-${runId}-${++counter}@example.test`, displayName: "Org Test", status: "active" }); users.push(item._id); return item;
}
async function organization(ownerId: string) {
  const result = await createOrganization(ownerId, { name: "Test Org", slug: `org-${runId}-${++counter}`, kind: "institution" }, `req-${runId}`); const id = new Types.ObjectId(String(result.organization.id)); orgs.push(id); return { id, result };
}
before(async () => {
  await mongoose.connect(uri!, { autoIndex: false });
  await Promise.all([OrganizationModel.createIndexes(), OrganizationMembershipModel.createIndexes(), OrganizationInvitationModel.createIndexes(), AuditEventModel.createIndexes(), UserModel.createIndexes()]);
});
afterEach(async () => {
  if (orgs.length) await Promise.all([OrganizationMembershipModel.deleteMany({ tenantId: { $in: orgs } }), OrganizationInvitationModel.deleteMany({ tenantId: { $in: orgs } }), AuditEventModel.deleteMany({ tenantId: { $in: orgs } }), OrganizationModel.deleteMany({ _id: { $in: orgs } })]);
  if (users.length) await Promise.all([OrganizationMembershipModel.deleteMany({ userId: { $in: users } }), OrganizationInvitationModel.deleteMany({ invitedBy: { $in: users } }), AuditEventModel.deleteMany({ actorId: { $in: users } }), UserModel.deleteMany({ _id: { $in: users } })]);
  users.length = 0; orgs.length = 0;
});
after(async () => mongoose.disconnect());

test("creates canonical organization, initial owner, and transactional audit event", async () => {
  const owner = await user(); const { id, result } = await organization(owner.id);
  assert.equal((result.membership as { roles: string[] }).roles[0], "ORGANIZATION_ADMIN");
  assert.equal(await OrganizationMembershipModel.countDocuments({ tenantId: id, userId: owner._id, status: "active" }), 1);
  assert.equal(await AuditEventModel.countDocuments({ tenantId: id, action: "organization.created", actorId: owner._id }), 1);
});

test("users can belong to multiple organizations; another tenant is concealed", async () => {
  const owner = await user(); const { id: a } = await organization(owner.id); const { id: b } = await organization(owner.id);
  assert.equal((await getOrganization(owner.id, a.toString()))._id.toString(), a.toString());
  await assert.rejects(getOrganization(new Types.ObjectId().toString(), a.toString()), (e: unknown) => e instanceof OrganizationAccessError && e.status === 404);
  assert.equal(await OrganizationMembershipModel.countDocuments({ userId: owner._id, status: "active" }), 2);
  assert.notEqual(a.toString(), b.toString());
});

test("cross-organization writes are denied without changing the other tenant", async () => {
  const owner = await user(); const outsider = await user(); const { id } = await organization(owner.id);
  await assert.rejects(updateOrganization(outsider.id, id.toString(), { name: "Spoofed" }, `req-${runId}`), (e: unknown) => e instanceof OrganizationAccessError && e.status === 403);
  assert.equal((await OrganizationModel.findById(id).select("name").lean())?.name, "Test Org");
});

test("invitation stores only a hash, requires matching account, accepts once, and audits", async () => {
  const owner = await user(); const invitee = await user(); const { id } = await organization(owner.id);
  const invite = await createInvitation(owner.id, id.toString(), { email: invitee.emailNormalized, roles: ["STUDENT"] }, `req-${runId}`);
  assert.equal((await OrganizationInvitationModel.findById(invite.id).select("+tokenHash"))?.get("tokenHash"), sha256(invite.shareTokenOnce));
  assert.notEqual((await OrganizationInvitationModel.findById(invite.id).select("+tokenHash"))?.get("tokenHash"), invite.shareTokenOnce);
  const membership = await acceptInvitation(invitee.id, invite.shareTokenOnce, `req-${runId}`);
  assert.equal(membership.status, "active");
  await assert.rejects(acceptInvitation(invitee.id, invite.shareTokenOnce, `req-${runId}`), (e: unknown) => e instanceof OrganizationAccessError && e.status === 404);
  assert.equal(await AuditEventModel.countDocuments({ action: "organization.invitation.accepted", tenantId: id }), 1);
});

test("concurrent invitation acceptance has exactly one winner", async () => {
  const owner = await user(); const invitee = await user(); const { id } = await organization(owner.id);
  const invite = await createInvitation(owner.id, id.toString(), { email: invitee.emailNormalized, roles: ["STUDENT"] }, `req-${runId}`);
  const results = await Promise.allSettled([
    acceptInvitation(invitee.id, invite.shareTokenOnce, `req-${runId}`),
    acceptInvitation(invitee.id, invite.shareTokenOnce, `req-${runId}`),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(await OrganizationMembershipModel.countDocuments({ tenantId: id, userId: invitee._id, status: "active" }), 1);
  assert.equal(await OrganizationInvitationModel.countDocuments({ _id: invite.id, status: "accepted" }), 1);
});

test("expired invitations and account mismatch cannot create membership", async () => {
  const owner = await user(); const invitee = await user(); const other = await user(); const { id } = await organization(owner.id);
  const invite = await createInvitation(owner.id, id.toString(), { email: invitee.emailNormalized, roles: ["STUDENT"] }, `req-${runId}`);
  await OrganizationInvitationModel.updateOne({ _id: invite.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(acceptInvitation(invitee.id, invite.shareTokenOnce, `req-${runId}`), (e: unknown) => e instanceof OrganizationAccessError && e.status === 404);
  const otherInvite = await createInvitation(owner.id, id.toString(), { email: invitee.emailNormalized, roles: ["STUDENT"] }, `req-${runId}`);
  await assert.rejects(acceptInvitation(other.id, otherInvite.shareTokenOnce, `req-${runId}`), (e: unknown) => e instanceof OrganizationAccessError && e.status === 403);
  assert.equal(await OrganizationMembershipModel.countDocuments({ tenantId: id, userId: { $in: [invitee._id, other._id] } }), 0);
});

test("prevents role escalation and protects the last owner across concurrent changes", async () => {
  const owner = await user(); const second = await user(); const { id } = await organization(owner.id);
  await OrganizationMembershipModel.create({ tenantId: id, userId: second._id, status: "active", roles: ["ORGANIZATION_ADMIN"] });
  await assert.rejects(changeMemberRoles(second.id, id.toString(), owner.id, ["PLATFORM_ADMIN"] as never, `req-${runId}`), (e: unknown) => e instanceof OrganizationAccessError);
  const results = await Promise.allSettled([removeMember(owner.id, id.toString(), owner.id, `req-${runId}`), removeMember(second.id, id.toString(), second.id, `req-${runId}`)]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(await OrganizationMembershipModel.countDocuments({ tenantId: id, status: "active", roles: "ORGANIZATION_ADMIN" }), 1);
});

test("member removal revokes tenant access and duplicate membership is rejected by unique index", async () => {
  const owner = await user(); const member = await user(); const { id } = await organization(owner.id);
  await OrganizationMembershipModel.create({ tenantId: id, userId: member._id, status: "active", roles: ["STUDENT"] });
  await assert.rejects(OrganizationMembershipModel.create({ tenantId: id, userId: member._id, status: "active", roles: ["STUDENT"] }), { code: 11000 });
  await removeMember(owner.id, id.toString(), member.id, `req-${runId}`);
  await assert.rejects(getOrganization(member.id, id.toString()), (e: unknown) => e instanceof OrganizationAccessError && e.status === 404);
  assert.equal(await AuditEventModel.countDocuments({ action: "organization.member.removed", tenantId: id }), 1);
});
