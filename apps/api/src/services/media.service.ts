import mongoose, { Types } from "mongoose";
import type { Readable } from "node:stream";
import { AuditEventModel } from "../models/audit-event.model.js";
import { CourseModel } from "../models/course.model.js";
import { LessonModel } from "../models/lesson.model.js";
import { MediaAssetModel, MediaUploadIntentModel } from "../models/media-asset.model.js";
import { OrganizationMembershipModel } from "../models/organization-membership.model.js";
import { OrganizationModel } from "../models/organization.model.js";
import { rolesAllow } from "./organization.service.js";
import { accessLesson, CourseError } from "./course.service.js";
import { getPrivateAssetStorage, newCloudinaryPublicId, type PrivateUploadRequest, type ProviderAsset } from "./private-asset-storage.service.js";
import { maxMediaBytes } from "../validators/media.validators.js";

const objectId = (value: string) => { if (!/^[a-f\d]{24}$/i.test(value)) throw new CourseError(404, "NOT_FOUND"); return new Types.ObjectId(value); };
const mimeByExtension: Record<string, string> = {
  ".pdf": "application/pdf", ".txt": "text/plain", ".csv": "text/csv", ".zip": "application/zip",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation", ".mp4": "video/mp4",
};
function safeAudit(tenantId: Types.ObjectId, actorId: Types.ObjectId, action: string, assetId: string, requestId: string, metadata: Record<string, unknown> = {}) {
  return { tenantId, actorId, action, resourceType: "mediaAsset", resourceId: assetId, requestId, occurredAt: new Date(), metadata };
}
async function authorizeManagedCourse(courseId: string, actorId: Types.ObjectId, session: mongoose.ClientSession) {
  const course = await CourseModel.findOne({ _id: objectId(courseId), ownerScope: "organization" }).session(session);
  if (!course?.tenantId) throw new CourseError(404, "NOT_FOUND");
  const tenantId = course.tenantId;
  const member = await OrganizationMembershipModel.findOneAndUpdate({ tenantId, userId: actorId, status: "active" }, { $inc: { authorizationVersion: 1 } }, { new: true, session }).select("roles").lean();
  const organization = await OrganizationModel.exists({ _id: tenantId, status: "active" }).session(session);
  if (!member || !organization || (!rolesAllow(member.roles, "course.manage") && !(course.ownerId.equals(actorId) && rolesAllow(member.roles, "course.manage.own")))) throw new CourseError(404, "NOT_FOUND");
  const locked = await CourseModel.updateOne({ _id: course._id, tenantId, status: "draft" }, { $inc: { mutationVersion: 1 } }, { session });
  if (locked.matchedCount !== 1) throw new CourseError(409, "COURSE_STATE_CONFLICT");
  return { course, tenantId };
}

export async function createLessonMediaUploadGrant(actorId: string, courseId: string, input: { lessonId: string; purpose: "video" | "document" | "resource"; fileName: string; contentType: string; sizeBytes: number }, requestId: string) {
  const actor = objectId(actorId); const courseObjectId = objectId(courseId); const lessonObjectId = objectId(input.lessonId);
  const extension = input.fileName.slice(input.fileName.lastIndexOf(".")).toLowerCase();
  const resourceType = input.purpose === "video" ? "video" as const : "raw" as const;
  const maxSizeBytes = maxMediaBytes[input.purpose];
  const intentId = new Types.ObjectId();
  let request!: PrivateUploadRequest;
  let grant!: Awaited<ReturnType<ReturnType<typeof getPrivateAssetStorage>["createUploadGrant"]>>;
  await mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await authorizeManagedCourse(courseId, actor, session);
    const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: courseObjectId, status: "draft" }).session(session);
    if (!lesson || lesson.contentType !== input.purpose) throw new CourseError(404, "NOT_FOUND");
    const expectedMimeType = mimeByExtension[extension];
    if (!expectedMimeType || expectedMimeType !== input.contentType || (input.purpose === "video" && extension !== ".mp4") || (input.purpose === "document" && extension !== ".pdf")) throw new CourseError(422, "INVALID_MEDIA_FORMAT");
    const fixedPublicId = newCloudinaryPublicId(tenantId.toString(), course._id.toString(), lesson._id.toString());
    await MediaUploadIntentModel.create([{ _id: intentId, tenantId, courseId: course._id, lessonId: lesson._id, uploaderId: actor, purpose: input.purpose, resourceType, deliveryType: "authenticated", fileName: input.fileName, expectedMimeType, expectedExtension: extension, expectedSizeBytes: input.sizeBytes, maxSizeBytes, publicId: fixedPublicId, expiresAt: new Date(Date.now() + 10 * 60_000), state: "pending" }], { session });
    request = { tenantId: tenantId.toString(), courseId: course._id.toString(), lessonId: lesson._id.toString(), actorId: actor.toString(), intentId: intentId.toString(), purpose: input.purpose, fileName: input.fileName, contentType: expectedMimeType, sizeBytes: input.sizeBytes, maxSizeBytes, publicId: fixedPublicId, resourceType };
    await AuditEventModel.create([{ tenantId, actorId: actor, action: "course.media.upload_granted", resourceType: "mediaUploadIntent", resourceId: intentId.toString(), requestId, occurredAt: new Date(), metadata: { courseId: course.id, lessonId: lesson.id, purpose: input.purpose } }], { session });
    grant = await getPrivateAssetStorage().createUploadGrant(request);
  });
  // Never return Cloudinary credentials. The file is streamed through the authenticated API and signed by the SDK server-side.
  return grant;
}

function verifyMetadata(request: PrivateUploadRequest, actual: ProviderAsset) {
  const extension = request.fileName.slice(request.fileName.lastIndexOf(".")).toLowerCase();
  if (actual.publicId !== request.publicId || actual.resourceType !== request.resourceType || actual.deliveryType !== "authenticated" || actual.format.toLowerCase() !== extension.slice(1) || actual.sizeBytes !== request.sizeBytes || actual.sizeBytes > request.maxSizeBytes) throw new CourseError(422, "MEDIA_METADATA_MISMATCH");
  if (request.purpose === "video" && (!actual.durationSeconds || actual.durationSeconds < 1)) throw new CourseError(422, "MEDIA_METADATA_MISMATCH");
  if (mimeByExtension[extension] !== request.contentType) throw new CourseError(422, "MEDIA_METADATA_MISMATCH");
}

export async function uploadAndVerifyLessonMedia(actorId: string, courseId: string, lessonId: string, intentId: string, source: Readable, contentLength: number, contentType: string, requestId: string) {
  const actor = objectId(actorId); const courseObjectId = objectId(courseId); const lessonObjectId = objectId(lessonId); const intentObjectId = objectId(intentId);
  const prior = await MediaAssetModel.findOne({ intentId: intentObjectId, uploaderId: actor, tenantId: { $exists: true } }).lean();
  if (prior) { source.resume(); return { asset: { id: prior._id.toString(), format: prior.format, sizeBytes: prior.sizeBytes, state: prior.state } }; }
  const intent = await MediaUploadIntentModel.findOne({ _id: intentObjectId, uploaderId: actor, courseId: courseObjectId, lessonId: lessonObjectId, state: "pending", expiresAt: { $gt: new Date() } }).lean();
  if (!intent) throw new CourseError(409, "MEDIA_INTENT_EXPIRED_OR_USED");
  await mongoose.connection.transaction(async (session) => {
    const { tenantId } = await authorizeManagedCourse(courseId, actor, session);
    const stillValid = await MediaUploadIntentModel.exists({ _id: intent._id, tenantId, uploaderId: actor, state: "pending", expiresAt: { $gt: new Date() } }).session(session);
    if (!stillValid) throw new CourseError(409, "MEDIA_INTENT_EXPIRED_OR_USED");
  });
  const request: PrivateUploadRequest = { tenantId: intent.tenantId.toString(), courseId: intent.courseId.toString(), lessonId: intent.lessonId.toString(), actorId: actor.toString(), intentId: intent._id.toString(), purpose: intent.purpose, fileName: intent.fileName, contentType: intent.expectedMimeType, sizeBytes: intent.expectedSizeBytes, maxSizeBytes: intent.maxSizeBytes, publicId: intent.publicId, resourceType: intent.resourceType };
  if (contentLength !== intent.expectedSizeBytes || contentType !== intent.expectedMimeType) { source.resume(); throw new CourseError(422, "MEDIA_METADATA_MISMATCH"); }
  let uploaded: ProviderAsset | undefined;
  try {
    uploaded = await getPrivateAssetStorage().upload(request, source);
    const verified = await getPrivateAssetStorage().getVerifiedAsset(request, uploaded);
    verifyMetadata(request, verified);
    let asset!: { id: string; format: string; sizeBytes: number; state: string };
    await mongoose.connection.transaction(async (session) => {
      const { course, tenantId } = await authorizeManagedCourse(courseId, actor, session);
      const lockedIntent = await MediaUploadIntentModel.findOneAndUpdate({ _id: intent._id, uploaderId: actor, tenantId, courseId: course._id, lessonId: lessonObjectId, state: "pending", expiresAt: { $gt: new Date() } }, { $set: { state: "finalized", finalizedAt: new Date(), providerAssetId: verified.assetId } }, { new: true, session });
      const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: course._id, status: "draft", contentType: intent.purpose }).session(session);
      if (!lockedIntent || !lesson) throw new CourseError(409, "MEDIA_INTENT_EXPIRED_OR_USED");
      const [created] = await MediaAssetModel.create([{ provider: "cloudinary", providerAssetId: verified.assetId, publicId: verified.publicId, tenantId, courseId: course._id, lessonId: lesson._id, uploaderId: actor, intentId: intent._id, purpose: intent.purpose, resourceType: verified.resourceType, deliveryType: "authenticated", format: verified.format, mimeType: intent.expectedMimeType, sizeBytes: verified.sizeBytes, ...(verified.durationSeconds !== undefined ? { durationSeconds: verified.durationSeconds } : {}), ...(verified.width !== undefined ? { width: verified.width } : {}), ...(verified.height !== undefined ? { height: verified.height } : {}), version: verified.version, state: "ready", verifiedAt: new Date() }], { session });
      if (!created) throw new Error("Media asset was not recorded.");
      const assetId = created._id.toString();
      if (intent.purpose === "video") { lesson.contentData = { type: "video", source: "asset", assetId, durationSeconds: Math.max(1, Math.floor(verified.durationSeconds ?? 0)) }; lesson.estimatedDurationMinutes = Math.max(1, Math.ceil((verified.durationSeconds ?? 1) / 60)); }
      else if (intent.purpose === "document") lesson.contentData = { type: "document", assetId, fileName: intent.fileName, mimeType: "application/pdf", sizeBytes: verified.sizeBytes };
      else {
        const current = lesson.contentData?.type === "resource" ? lesson.contentData.files : [];
        lesson.contentData = { type: "resource", files: [...current, { assetId, title: intent.fileName, description: "", fileName: intent.fileName, mimeType: intent.expectedMimeType, sizeBytes: verified.sizeBytes }] };
      }
      lesson.$locals.verifiedMediaAttachment = true;
      await lesson.save({ session });
      delete lesson.$locals.verifiedMediaAttachment;
      if (intent.purpose === "video") {
        const durationRows = await LessonModel.aggregate([{ $match: { tenantId, courseId: course._id } }, { $group: { _id: null, minutes: { $sum: "$estimatedDurationMinutes" } } }]).session(session);
        course.estimatedDurationMinutes = durationRows[0]?.minutes ?? 0; await course.save({ session });
      }
      await AuditEventModel.create([safeAudit(tenantId, actor, "course.media.verified", assetId, requestId, { courseId: course.id, lessonId: lesson.id, purpose: intent.purpose, sizeBytes: verified.sizeBytes })], { session });
      asset = { id: assetId, format: verified.format, sizeBytes: verified.sizeBytes, state: "ready" };
    });
    return { asset };
  } catch (error) {
    if (uploaded) await getPrivateAssetStorage().deleteAsset({ publicId: uploaded.publicId, resourceType: uploaded.resourceType }).catch(() => undefined);
    await MediaUploadIntentModel.updateOne({ _id: intent._id, state: "pending" }, { $set: { state: "failed" } }).catch(() => undefined);
    throw error;
  }
}

export async function createStudentMediaAccess(actorId: string, courseId: string, lessonId: string, assetId: string, disposition: "inline" | "attachment" = "inline") {
  const lesson = await accessLesson(actorId, courseId, lessonId);
  const assetObjectId = objectId(assetId);
  const asset = await MediaAssetModel.findOne({ _id: assetObjectId, tenantId: lesson.tenantId, courseId: lesson.courseId, lessonId: lesson._id, state: "ready", deliveryType: "authenticated" }).lean();
  const content = lesson.contentData as { assetId?: string; files?: { assetId: string }[] } | undefined;
  const isAttached = content?.assetId === assetId || content?.files?.some((file: { assetId: string }) => file.assetId === assetId) === true;
  if (!asset || !isAttached) throw new CourseError(404, "NOT_FOUND");
  return getPrivateAssetStorage().createDownloadGrant({ publicId: asset.publicId, format: asset.format, resourceType: asset.resourceType, disposition });
}

export async function deleteLessonMediaAsset(actorId: string, courseId: string, lessonId: string, assetId: string, requestId: string) {
  const actor = objectId(actorId); const lessonObjectId = objectId(lessonId); const assetObjectId = objectId(assetId);
  const asset = await mongoose.connection.transaction(async (session) => {
    const { course, tenantId } = await authorizeManagedCourse(courseId, actor, session);
    const row = await MediaAssetModel.findOne({ _id: assetObjectId, tenantId, courseId: course._id, lessonId: lessonObjectId, state: { $in: ["ready", "deletion_requested"] } }).session(session);
    const lesson = await LessonModel.findOne({ _id: lessonObjectId, tenantId, courseId: course._id, status: "draft" }).session(session);
    if (!row || !lesson) throw new CourseError(404, "NOT_FOUND");
    row.state = "deletion_requested"; row.deletionRequestedAt ??= new Date(); await row.save({ session });
    if (lesson.contentData?.type === "resource") lesson.contentData = { type: "resource", files: lesson.contentData.files.filter((file: { assetId: string; title: string; description: string; fileName: string; mimeType: string; sizeBytes: number }) => file.assetId !== assetObjectId.toString()) };
    else lesson.contentData = undefined;
    if (lesson.contentData?.type === "resource" && lesson.contentData.files.length === 0) lesson.contentData = undefined;
    await lesson.save({ session });
    await AuditEventModel.create([safeAudit(tenantId, actor, "course.media.deletion_requested", row.id, requestId, { courseId: course.id, lessonId: lesson.id })], { session });
    return row.toObject();
  });
  await getPrivateAssetStorage().deleteAsset({ publicId: asset.publicId, resourceType: asset.resourceType });
  await mongoose.connection.transaction(async (session) => {
    const row = await MediaAssetModel.findOne({ _id: assetObjectId, tenantId: asset.tenantId, courseId: asset.courseId, lessonId: lessonObjectId, state: "deletion_requested" }).session(session);
    if (!row) throw new CourseError(404, "NOT_FOUND");
    row.state = "deleted"; row.deletedAt = new Date(); await row.save({ session });
    await AuditEventModel.create([safeAudit(asset.tenantId, actor, "course.media.deleted", row.id, requestId)], { session });
  });
}

/** Idempotent orphan cleanup: expired intent public IDs and deletion-requested assets are never deliverable. */
export async function reconcilePendingMediaCleanup() {
  const now = new Date();
  const intents = await MediaUploadIntentModel.find({ state: { $in: ["pending", "failed"] }, expiresAt: { $lte: now } }).sort({ expiresAt: 1 }).limit(50).lean();
  for (const intent of intents) {
    try {
      await getPrivateAssetStorage().deleteAsset({ publicId: intent.publicId, resourceType: intent.resourceType });
      await mongoose.connection.transaction(async (session) => {
        const expired = await MediaUploadIntentModel.findOneAndUpdate({ _id: intent._id, state: intent.state, expiresAt: { $lte: now } }, { $set: { state: "expired" } }, { new: true, session });
        if (expired) await AuditEventModel.create([{ tenantId: intent.tenantId, actorId: intent.uploaderId, action: "course.media.orphan_cleaned", resourceType: "mediaUploadIntent", resourceId: intent._id.toString(), requestId: "media-reconciliation", occurredAt: now, metadata: { courseId: intent.courseId.toString(), lessonId: intent.lessonId.toString() } }], { session });
      });
    } catch { /* A provider outage leaves the durable intent for the next reconciliation pass. */ }
  }
  const assets = await MediaAssetModel.find({ state: "deletion_requested" }).sort({ deletionRequestedAt: 1 }).limit(50).lean();
  for (const asset of assets) {
    try {
      await getPrivateAssetStorage().deleteAsset({ publicId: asset.publicId, resourceType: asset.resourceType });
      await mongoose.connection.transaction(async (session) => {
        const deleted = await MediaAssetModel.findOneAndUpdate({ _id: asset._id, state: "deletion_requested" }, { $set: { state: "deleted", deletedAt: now } }, { new: true, session });
        if (deleted) await AuditEventModel.create([safeAudit(asset.tenantId, asset.uploaderId, "course.media.deleted", asset._id.toString(), "media-reconciliation", { courseId: asset.courseId.toString(), lessonId: asset.lessonId.toString() })], { session });
      });
    } catch { /* Keep the deletion request pending and retry without exposing the asset. */ }
  }
}
