import assert from "node:assert/strict";
import test from "node:test";
import { ConfigurationError, loadConfig } from "../src/config/env.js";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017/lms_platform_test",
  WEB_ORIGIN: "http://localhost:5173",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
};

test("loads safe defaults and validates the MongoDB URI and web origin", () => {
  const config = loadConfig(validEnvironment);

  assert.equal(config.nodeEnv, "test");
  assert.equal(config.apiPort, 4000);
  assert.equal(config.mongoServerSelectionTimeoutMs, 5000);
  assert.equal(config.mediaStorageProvider, "unconfigured");
  assert.equal(config.cloudinaryPrivateDeliveryVerified, false);
  assert.equal(config.webOrigin, "http://localhost:5173");
  assert.equal(config.sessionIdleTimeoutSeconds, 1800);
  assert.equal(config.platformAdminMfaMaxAgeSeconds, 43200);
  assert.equal(config.platformAdminSensitiveMfaMaxAgeSeconds, 300);
  assert.equal(config.mfaEncryptionKey.length, 32);
});

test("rejects malformed values without including secret values in the error", () => {
  const configValue = "mongodb://user:private-password@localhost:27017/lms";

  assert.throws(
    () => loadConfig({
      ...validEnvironment,
      API_PORT: "not-a-port",
      MONGODB_URI: configValue,
      WEB_ORIGIN: "http://localhost:5173/path",
    }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, /API_PORT/);
      assert.match(error.message, /WEB_ORIGIN/);
      assert.doesNotMatch(error.message, /private-password|localhost:27017/);
      return true;
    },
  );
});

test("requires HTTPS origins in production", () => {
  assert.throws(
    () => loadConfig({ ...validEnvironment, NODE_ENV: "production" }),
    (error: unknown) => error instanceof ConfigurationError && /WEB_ORIGIN/.test(error.message),
  );
});

test("does not accept unsupported media provider modes", () => {
  assert.throws(() => loadConfig({ ...validEnvironment, MEDIA_STORAGE_PROVIDER: "s3" }), (error: unknown) => error instanceof ConfigurationError && /MEDIA_STORAGE_PROVIDER/.test(error.message));
});

test("requires all server-side Cloudinary configuration when enabled and never reports values", () => {
  assert.throws(() => loadConfig({ ...validEnvironment, MEDIA_STORAGE_PROVIDER: "cloudinary", CLOUDINARY_CLOUD_NAME: "cloud", CLOUDINARY_API_KEY: "key" }), (error: unknown) => error instanceof ConfigurationError && /CLOUDINARY_API_SECRET/.test(error.message) && !/key|cloud/.test(error.message));
  const config = loadConfig({ ...validEnvironment, MEDIA_STORAGE_PROVIDER: "cloudinary", CLOUDINARY_CLOUD_NAME: "test-cloud", CLOUDINARY_API_KEY: "test-key", CLOUDINARY_API_SECRET: "secret-value" });
  assert.equal(config.mediaStorageProvider, "cloudinary");
  assert.equal(config.cloudinaryApiSecret, "secret-value");
  assert.equal(config.cloudinaryPrivateDeliveryVerified, false);
  assert.equal(loadConfig({ ...validEnvironment, MEDIA_STORAGE_PROVIDER: "cloudinary", CLOUDINARY_CLOUD_NAME: "cloud", CLOUDINARY_API_KEY: "key", CLOUDINARY_API_SECRET: "secret", CLOUDINARY_PRIVATE_DELIVERY_VERIFIED: "true" }).cloudinaryPrivateDeliveryVerified, true);
});
