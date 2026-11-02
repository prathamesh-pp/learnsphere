import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import type { Server } from "node:http";
import { Types } from "mongoose";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config/env.js";
import { AuthSessionModel } from "../src/models/auth-session.model.js";
import { sha256 } from "../src/services/session.service.js";

const config = loadConfig({
  NODE_ENV: "test",
  MONGODB_URI: "mongodb://127.0.0.1:27017/lms_platform_test",
  WEB_ORIGIN: "http://localhost:5173",
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
});

async function withHttpServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const app = createApp(config, { checkDatabaseReady: async () => true });
  const server = app.listen(0) as Server;
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
}

test("createApp is importable and liveness endpoints do not depend on MongoDB", async () => {
  let readinessChecks = 0;
  const app = createApp(config, {
    checkDatabaseReady: async () => {
      readinessChecks += 1;
      return false;
    },
  });
  const server = app.listen(0) as Server;
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    for (const path of ["/api/health", "/health/live"]) {
      const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { status: "ok" });
    }
    assert.equal(readinessChecks, 0);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
});

test("readiness returns 200 only when MongoDB is available", async () => {
  await withHttpServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health/ready`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ready",
      dependencies: { mongodb: "ready" },
    });
  });

  const unavailableApp = createApp(config, { checkDatabaseReady: async () => false });
  const server = unavailableApp.listen(0) as Server;
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      status: "not_ready",
      dependencies: { mongodb: "unavailable" },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
});

test("readiness hides dependency error details", async () => {
  const app = createApp(config, {
    checkDatabaseReady: async () => {
      throw new Error("mongodb://user:secret@internal-host");
    },
  });
  const server = app.listen(0) as Server;
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/health/ready`);
    const body = await response.text();
    assert.equal(response.status, 503);
    assert.doesNotMatch(body, /secret|internal-host/);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
  }
});

test("auth API rejects untrusted origins and role self-assignment before persistence", async () => {
  await withHttpServer(async (baseUrl) => {
    const originRejected = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173.attacker.test" },
      body: JSON.stringify({ email: "user@example.com", displayName: "User", password: "a-long-enough-password" }),
    });
    assert.equal(originRejected.status, 403);

    const roleRejected = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email: "user@example.com", displayName: "User", password: "a-long-enough-password", role: "PLATFORM_ADMIN" }),
    });
    assert.equal(roleRejected.status, 400);
    const body = await roleRejected.text();
    assert.doesNotMatch(body, /PLATFORM_ADMIN|password|secret/);
  });
});

test("recovery remains non-enumerating and unavailable without a real delivery provider", async () => {
  await withHttpServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/recovery`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: JSON.stringify({ email: "unknown@example.com" }),
    });
    assert.equal(response.status, 503);
    const body = await response.text();
    assert.match(body, /RECOVERY_UNAVAILABLE/);
    assert.doesNotMatch(body, /unknown@example.com|secret|token/);
  });
});

test("malformed JSON receives a sanitized client error", async () => {
  await withHttpServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:5173" },
      body: "{\"password\":\"sensitive-value\"",
    });
    assert.equal(response.status, 400);
    const body = await response.text();
    assert.match(body, /INVALID_JSON/);
    assert.doesNotMatch(body, /sensitive-value|stack|SyntaxError/);
  });
});

test("actual authenticated logout route enforces exact Origin and synchronizer CSRF", async () => {
  const csrfToken = "a".repeat(43);
  const cookieToken = "b".repeat(43);
  let revocationFilter: Record<string, unknown> | undefined;
  const original = Object.getOwnPropertyDescriptor(AuthSessionModel, "updateOne");
  Object.defineProperty(AuthSessionModel, "updateOne", {
    configurable: true,
    writable: true,
    value: async (filter: Record<string, unknown>) => { revocationFilter = filter; return { modifiedCount: 1 }; },
  });
  const resolver = (request: import("express").Request, _response: import("express").Response, next: import("express").NextFunction) => {
    if (request.headers.cookie?.includes(cookieToken)) {
      request.authContext = { userId: new Types.ObjectId().toString(), sessionId: new Types.ObjectId().toString(), csrfTokenHash: sha256(csrfToken), mfaVerified: false };
    }
    next();
  };
  const app = createApp(config, { checkDatabaseReady: async () => true, resolveSession: resolver });
  const server = app.listen(0) as Server;
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const cookieHeaders = { cookie: `learnsphere_session=${cookieToken}` };
  try {
    for (const origin of [undefined, "null", "http://localhost:5173/path", "http://evil.example"]) {
      const response = await fetch(`${baseUrl}/api/v1/auth/logout`, { method: "POST", headers: { ...cookieHeaders, ...(origin !== undefined ? { origin } : {}) } });
      assert.equal(response.status, 403);
    }
    for (const csrf of [undefined, "invalid-token"]) {
      const response = await fetch(`${baseUrl}/api/v1/auth/logout`, {
        method: "POST", headers: { ...cookieHeaders, origin: "http://localhost:5173", ...(csrf ? { "x-csrf-token": csrf } : {}) },
      });
      assert.equal(response.status, 403);
    }
    const valid = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: "POST", headers: { ...cookieHeaders, origin: "http://localhost:5173", "x-csrf-token": csrfToken },
    });
    assert.equal(valid.status, 204);
    assert.equal(revocationFilter?.tokenHash, sha256(cookieToken));

    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await fetch(`${baseUrl}/future/protected-mutation`, { method, headers: { ...cookieHeaders, origin: "http://localhost:5173" } });
      assert.equal(response.status, 403, `${method} must be rejected before future route dispatch without CSRF`);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    server.closeIdleConnections();
    if (original) Object.defineProperty(AuthSessionModel, "updateOne", original);
    else Reflect.deleteProperty(AuthSessionModel, "updateOne");
  }
});
