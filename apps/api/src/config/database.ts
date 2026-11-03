import mongoose from "mongoose";
import { AuthSessionModel } from "../models/auth-session.model.js";
import { PlatformGrantModel } from "../models/platform-grant.model.js";
import { UserCredentialModel } from "../models/user-credential.model.js";
import { UserModel } from "../models/user.model.js";
import { OrganizationModel } from "../models/organization.model.js";
import { OrganizationMembershipModel } from "../models/organization-membership.model.js";
import { OrganizationInvitationModel } from "../models/organization-invitation.model.js";
import { AuditEventModel } from "../models/audit-event.model.js";
import { CourseModel } from "../models/course.model.js";
import { LessonModel } from "../models/lesson.model.js";
import { EnrollmentModel } from "../models/enrollment.model.js";
import { LessonProgressModel } from "../models/lesson-progress.model.js";
import { MediaAssetModel, MediaUploadIntentModel } from "../models/media-asset.model.js";
import type { AppConfig } from "./env.js";

type IndexSpec = Readonly<{ collection: string; key: Readonly<Record<string, 1 | -1>>; unique?: boolean; expireAfterSeconds?: number; partialFilterExpression?: Readonly<Record<string, unknown>> }>;

export const REQUIRED_INDEXES: readonly IndexSpec[] = [
  { collection: "users", key: { emailNormalized: 1 }, unique: true },
  { collection: "usercredentials", key: { userId: 1 }, unique: true },
  { collection: "authsessions", key: { tokenHash: 1 }, unique: true },
  { collection: "authsessions", key: { expiresAt: 1 }, expireAfterSeconds: 0 },
  { collection: "platformgrants", key: { userId: 1, roleKey: 1, revokedAt: 1, startsAt: 1, expiresAt: 1 } },
  { collection: "organizations", key: { slug: 1 }, unique: true },
  { collection: "organizations", key: { status: 1, kind: 1 } },
  { collection: "organizationmemberships", key: { tenantId: 1, userId: 1 }, unique: true },
  { collection: "organizationmemberships", key: { userId: 1, status: 1 } },
  { collection: "organizationmemberships", key: { tenantId: 1, status: 1 } },
  { collection: "organizationinvitations", key: { tokenHash: 1 }, unique: true },
  { collection: "organizationinvitations", key: { tenantId: 1, emailNormalized: 1, status: 1 } },
  { collection: "auditevents", key: { tenantId: 1, occurredAt: -1 } },
  { collection: "auditevents", key: { actorId: 1, occurredAt: -1 } },
  { collection: "auditevents", key: { resourceType: 1, resourceId: 1, occurredAt: -1 } },
  { collection: "courses", key: { tenantId: 1, slug: 1 }, unique: true, partialFilterExpression: { ownerScope: "organization" } },
  { collection: "courses", key: { slug: 1 }, unique: true, partialFilterExpression: { ownerScope: "platform" } },
  { collection: "courses", key: { tenantId: 1, status: 1, createdAt: -1, _id: -1 } },
  { collection: "courses", key: { tenantId: 1, ownerId: 1, updatedAt: -1, _id: -1 } },
  { collection: "lessons", key: { courseId: 1, position: 1 }, unique: true },
  { collection: "lessons", key: { tenantId: 1, courseId: 1, status: 1, position: 1 } },
  { collection: "enrollments", key: { tenantId: 1, courseId: 1, studentId: 1 }, unique: true },
  { collection: "enrollments", key: { studentId: 1, status: 1, updatedAt: -1, _id: -1 } },
  { collection: "enrollments", key: { tenantId: 1, courseId: 1, status: 1 } },
  { collection: "lessonprogresses", key: { enrollmentId: 1, lessonId: 1 }, unique: true },
  { collection: "lessonprogresses", key: { tenantId: 1, courseId: 1, studentId: 1 } },
  { collection: "mediaassets", key: { providerAssetId: 1 }, unique: true },
  { collection: "mediaassets", key: { publicId: 1 }, unique: true },
  { collection: "mediaassets", key: { intentId: 1 }, unique: true },
  { collection: "mediaassets", key: { tenantId: 1, courseId: 1, lessonId: 1, state: 1 } },
  { collection: "mediauploadintents", key: { publicId: 1 }, unique: true },
  { collection: "mediauploadintents", key: { uploaderId: 1, state: 1, expiresAt: 1 } },
  { collection: "mediauploadintents", key: { expiresAt: 1 } },
];

export function isTransactionCapableHello(hello: Readonly<Record<string, unknown>>): boolean {
  const topologySupportsTransactions = typeof hello.setName === "string" || hello.msg === "isdbgrid";
  const primaryAvailable = hello.isWritablePrimary === true || hello.ismaster === true;
  const pipelineAndTransactionWireVersion = typeof hello.maxWireVersion === "number" && hello.maxWireVersion >= 8;
  return topologySupportsTransactions && primaryAvailable && pipelineAndTransactionWireVersion && typeof hello.logicalSessionTimeoutMinutes === "number";
}

export function hasRequiredIndexes(specs: readonly IndexSpec[], indexesByCollection: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>): boolean {
  return specs.every((spec) => (indexesByCollection[spec.collection] ?? []).some((index) => {
    const key = index.key;
    if (typeof key !== "object" || key === null) return false;
    const entries = Object.entries(key);
    if (entries.length !== Object.keys(spec.key).length) return false;
    if (!Object.entries(spec.key).every(([field, direction]) => (key as Record<string, unknown>)[field] === direction)) return false;
    if (spec.unique !== undefined && index.unique !== spec.unique) return false;
    if (spec.partialFilterExpression !== undefined && JSON.stringify(index.partialFilterExpression) !== JSON.stringify(spec.partialFilterExpression)) return false;
    return spec.expireAfterSeconds === undefined || index.expireAfterSeconds === spec.expireAfterSeconds;
  }));
}

async function hasRequiredMongoIndexes(): Promise<boolean> {
  if (!mongoose.connection.db) return false;
  try {
    const collectionNames = [...new Set(REQUIRED_INDEXES.map((spec) => spec.collection))];
    const indexes = Object.fromEntries(await Promise.all(collectionNames.map(async (name) => [
      name,
      await mongoose.connection.db!.collection(name).listIndexes().toArray(),
    ])));
    return hasRequiredIndexes(REQUIRED_INDEXES, indexes);
  } catch {
    return false;
  }
}

async function createRequiredIndexes(): Promise<void> {
  // Create only declared indexes. Never call syncIndexes(), which can drop existing indexes.
  await Promise.all([UserModel.createIndexes(), UserCredentialModel.createIndexes(), AuthSessionModel.createIndexes(), PlatformGrantModel.createIndexes(), OrganizationModel.createIndexes(), OrganizationMembershipModel.createIndexes(), OrganizationInvitationModel.createIndexes(), AuditEventModel.createIndexes(), CourseModel.createIndexes(), LessonModel.createIndexes(), EnrollmentModel.createIndexes(), LessonProgressModel.createIndexes(), MediaAssetModel.createIndexes(), MediaUploadIntentModel.createIndexes()]);
  if (!await hasRequiredMongoIndexes()) throw new Error("Required MongoDB indexes are unavailable.");
}

async function transactionTopologyReady(): Promise<boolean> {
  if (!mongoose.connection.db) return false;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 }, { timeoutMS: 1000 });
    return isTransactionCapableHello(hello as Readonly<Record<string, unknown>>);
  } catch {
    return false;
  }
}

export class DatabaseConnectionError extends Error {
  constructor() {
    super("Unable to connect to MongoDB.");
    this.name = "DatabaseConnectionError";
  }
}

export async function connectDatabase(config: AppConfig): Promise<void> {
  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: config.mongoServerSelectionTimeoutMs,
      autoIndex: false,
    });
    if (!await transactionTopologyReady()) throw new Error("MongoDB topology does not support transactions.");
    await createRequiredIndexes();
  } catch {
    try {
      await disconnectDatabase();
    } catch {
      // Preserve the sanitized connection error if cleanup also fails.
    }
    throw new DatabaseConnectionError();
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export async function isDatabaseReady(): Promise<boolean> {
  const connection = mongoose.connection;
  if (connection.readyState !== 1 || !connection.db) {
    return false;
  }

  try {
    await connection.db.command({ ping: 1 }, { timeoutMS: 1000 });
    return await transactionTopologyReady() && await hasRequiredMongoIndexes();
  } catch {
    return false;
  }
}
