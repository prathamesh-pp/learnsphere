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
