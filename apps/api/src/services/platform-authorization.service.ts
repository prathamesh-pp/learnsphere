import { PlatformGrantModel } from "../models/platform-grant.model.js";
import { Types } from "mongoose";

/** Canonical active grant condition. MongoDB null equality matches both null and absent fields. */
export function activePlatformGrantFilter(userId: string, now: Date, permission?: string) {
  return {
    userId: new Types.ObjectId(userId),
    roleKey: "PLATFORM_ADMIN",
    revokedAt: null,
    startsAt: { $lte: now },
    expiresAt: { $gt: now },
    ...(permission ? { permissions: permission } : {}),
  };
}

export async function findActivePlatformGrant(userId: string, now: Date, permission?: string) {
  return PlatformGrantModel.exists(activePlatformGrantFilter(userId, now, permission));
}
