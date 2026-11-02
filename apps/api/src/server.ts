import { createServer } from "node:http";
import type { Server } from "node:http";
import type { Express } from "express";
import { createApp } from "./app.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import type { AppConfig } from "./config/env.js";

export class ApiStartupError extends Error {
  constructor() {
    super("API startup failed.");
    this.name = "ApiStartupError";
  }
}

export class StartupInterruptedError extends Error {
  constructor() {
    super("API startup was interrupted.");
    this.name = "StartupInterruptedError";
  }
}

export type ServerDependencies = Readonly<{
  connectDatabase: (config: AppConfig) => Promise<void>;
  disconnectDatabase: () => Promise<void>;
  createApp: (config: AppConfig) => Express;
  listen: (app: Express, port: number) => Promise<Server>;
}>;

export type RunningApi = Readonly<{
  server: Server;
  stop: () => Promise<void>;
}>;

const defaultDependencies: ServerDependencies = {
  connectDatabase,
  disconnectDatabase,
  createApp,
  listen: listenHttpServer,
};

export async function startServer(
  config: AppConfig,
  options: Readonly<{ signal?: AbortSignal; dependencies?: ServerDependencies }> = {},
): Promise<RunningApi> {
  const dependencies = options.dependencies ?? defaultDependencies;
  let server: Server | undefined;
  let stopPromise: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    if (!stopPromise) {
      stopPromise = (async () => {
        try {
          if (server?.listening) {
            await closeHttpServer(server);
          }
        } finally {
          await dependencies.disconnectDatabase();
        }
      })();
    }
    return stopPromise;
  };

  const onAbort = () => {
    void stop().catch(() => undefined);
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    if (options.signal?.aborted) {
      throw new StartupInterruptedError();
    }

    await dependencies.connectDatabase(config);

    if (options.signal?.aborted) {
      throw new StartupInterruptedError();
    }

    const app = dependencies.createApp(config);
    server = await dependencies.listen(app, config.apiPort);

    if (options.signal?.aborted) {
      await stop();
      throw new StartupInterruptedError();
    }

    return {
      server,
      stop: async () => {
        options.signal?.removeEventListener("abort", onAbort);
        await stop();
      },
    };
  } catch (error) {
    options.signal?.removeEventListener("abort", onAbort);
    try {
      await stop();
    } catch {
      // Keep startup errors sanitized; shutdown is best effort on this path.
    }

    if (options.signal?.aborted || error instanceof StartupInterruptedError) {
      try {
        // A connection attempt may settle after the abort-triggered cleanup began.
        await dependencies.disconnectDatabase();
      } catch {
        // The process is already stopping; do not expose connection details.
      }
      throw new StartupInterruptedError();
    }
    throw new ApiStartupError();
  }
}

function listenHttpServer(app: Express, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    const onError = () => {
      server.off("listening", onListening);
      reject(new ApiStartupError());
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port);
  });
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections();
  });
}
