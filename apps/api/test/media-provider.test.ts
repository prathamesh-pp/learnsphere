import assert from "node:assert/strict";
import test from "node:test";
import { CloudinaryPrivateAssetStorage, MediaProviderError, normalizeProviderError } from "../src/services/private-asset-storage.service.js";

const cloud = { cloud_name: "test-cloud", api_key: "test-key", api_secret: "test-secret-never-return" };
const request = { tenantId: "a".repeat(24), courseId: "b".repeat(24), lessonId: "c".repeat(24), actorId: "d".repeat(24), intentId: "e".repeat(24), purpose: "document" as const, fileName: "lesson.pdf", contentType: "application/pdf", sizeBytes: 1024, maxSizeBytes: 10_000_000, publicId: `learnsphere/${"a".repeat(24)}/${"b".repeat(24)}/${"c".repeat(24)}/unpredictable`, resourceType: "raw" as const };

test("Cloudinary upload grants expose only the authenticated API proxy and never provider credentials", async () => {
  const provider = new CloudinaryPrivateAssetStorage(cloud);
  const grant = await provider.createUploadGrant(request);
  assert.equal(grant.intentId, request.intentId);
  assert.match(grant.uploadUrl, /media-upload-intents/);
  assert.equal(grant.maxSizeBytes, 10_000_000);
  assert.doesNotMatch(JSON.stringify(grant), /test-secret-never-return|test-key|test-cloud/);
});

test("private media delivery stays fail-closed until the account smoke test is explicitly verified", async () => {
  const unverified = new CloudinaryPrivateAssetStorage(cloud, false);
  await assert.rejects(unverified.createDownloadGrant({ publicId: request.publicId, format: "pdf", resourceType: "raw", disposition: "inline" }), (error: unknown) => error instanceof MediaProviderError && error.code === "MEDIA_DELIVERY_UNVERIFIED");
  const verified = new CloudinaryPrivateAssetStorage(cloud, true);
  const grant = await verified.createDownloadGrant({ publicId: request.publicId, format: "pdf", resourceType: "raw", disposition: "inline" });
  assert.match(grant.url, /\/raw\/download/);
  assert.match(grant.url, /expires_at=/);
  assert.doesNotMatch(grant.url, /test-secret-never-return/);
  assert.ok(Date.parse(grant.expiresAt) > Date.now());
});

test("provider errors normalize quota, timeout, invalid-auth and upload failures without forwarding messages", () => {
  assert.equal(normalizeProviderError({ http_code: 420, message: "plan quota" }).code, "MEDIA_QUOTA_EXHAUSTED");
  assert.equal(normalizeProviderError({ code: "ETIMEDOUT", message: "secret=do-not-forward" }).code, "MEDIA_PROVIDER_TIMEOUT");
  assert.equal(normalizeProviderError({ http_code: 401, message: "secret configuration" }).code, "MEDIA_CONFIGURATION_INVALID");
  assert.equal(normalizeProviderError({ http_code: 400, message: "bad upload secret" }).code, "MEDIA_UPLOAD_REJECTED");
});
