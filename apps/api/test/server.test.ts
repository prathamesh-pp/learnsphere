import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";
import { ApiStartupError, startServer, StartupInterruptedError } from "../src/server.js";

const config: AppConfig = {
  nodeEnv: "test",
  apiPort: 0,
  mongoUri: "mongodb://127.0.0.1:27017/lms_platform_test",
  mediaStorageProvider: "unconfigured",
  cloudinaryPrivateDeliveryVerified: false,
  mongoServerSelectionTimeoutMs: 100,
  webOrigin: "http://localhost:5173",
  sessionIdleTimeoutSeconds: 1800,
  sessionAbsoluteTimeoutSeconds: 1209600,
  platformAdminMfaMaxAgeSeconds: 43200,
  platformAdminSensitiveMfaMaxAgeSeconds: 300,
  mfaEncryptionKey: Buffer.alloc(32, 7),
};

test("database startup failure does not create an app or open an HTTP listener", async () => {
  let disconnectCalls = 0;
  let appCreated = false;
  let listenCalled = false;

  await assert.rejects(startServer(config, {
    dependencies: {
      connectDatabase: async () => { throw new Error("connection URI secret"); },
      disconnectDatabase: async () => { disconnectCalls += 1; },
      createApp: () => {
        appCreated = true;
        return createApp(config);
      },
      listen: async () => {
        listenCalled = true;
        throw new Error("not expected");
      },
    },
  }), (error: unknown) => {
    assert.ok(error instanceof ApiStartupError);
    assert.doesNotMatch(error.message, /secret|URI/);
    return true;
  });

  assert.equal(disconnectCalls, 1);
  assert.equal(appCreated, false);
  assert.equal(listenCalled, false);
});

test("shutdown closes HTTP before disconnecting MongoDB and is idempotent", async () => {
  const actions: string[] = [];
  const lifecycle = await startServer(config, {
    dependencies: {
      connectDatabase: async () => { actions.push("connect"); },
      disconnectDatabase: async () => { actions.push("disconnect"); },
      createApp: (appConfig) => createApp(appConfig, { checkDatabaseReady: async () => true }),
      listen: async (app, port) => {
        const server = app.listen(port);
        await new Promise<void>((resolve) => server.once("listening", resolve));
        actions.push("listen");
        return server;
      },
    },
  });

  assert.equal(lifecycle.server.listening, true);
  await Promise.all([lifecycle.stop(), lifecycle.stop()]);
  assert.equal(lifecycle.server.listening, false);
  assert.deepEqual(actions, ["connect", "listen", "disconnect"]);
});

test("an interrupted database startup does not leave the connection open", async () => {
  const controller = new AbortController();
  let resolveConnection: (() => void) | undefined;
  let disconnectCalls = 0;
  let listenCalled = false;

  const connecting = new Promise<void>((resolve) => { resolveConnection = resolve; });
  const startup = startServer(config, {
    signal: controller.signal,
    dependencies: {
      connectDatabase: async () => connecting,
      disconnectDatabase: async () => { disconnectCalls += 1; },
      createApp: (appConfig) => createApp(appConfig),
      listen: async () => {
        listenCalled = true;
        throw new Error("not expected");
      },
    },
  });

  controller.abort();
  resolveConnection?.();
  await assert.rejects(startup, StartupInterruptedError);
  assert.equal(listenCalled, false);
  assert.ok(disconnectCalls >= 1);
});
