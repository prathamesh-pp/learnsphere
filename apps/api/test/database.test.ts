import assert from "node:assert/strict";
import test from "node:test";
import { connectDatabase, disconnectDatabase, isDatabaseReady } from "../src/config/database.js";
import { loadConfig } from "../src/config/env.js";

test("MongoDB startup failure is sanitized and readiness stays false", async () => {
  const config = loadConfig({
    NODE_ENV: "test",
    MONGODB_URI: "mongodb://user:private-password@127.0.0.1:1/lms_platform_test",
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: "150",
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
  });

  await assert.rejects(connectDatabase(config), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "Unable to connect to MongoDB.");
    assert.doesNotMatch(error.message, /private-password|127\.0\.0\.1/);
    return true;
  });

  assert.equal(await isDatabaseReady(), false);
  await disconnectDatabase();
});
