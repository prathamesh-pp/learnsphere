import "dotenv/config";
import { ConfigurationError, loadConfig } from "./config/env.js";
import { startServer, StartupInterruptedError } from "./server.js";
import { configurePrivateAssetStorage } from "./services/private-asset-storage.service.js";
import { reconcilePendingMediaCleanup } from "./services/media.service.js";

async function main(): Promise<void> {
  const shutdownController = new AbortController();
  let runningApi: Awaited<ReturnType<typeof startServer>> | undefined;
  let shutdownStarted = false;
  let mediaCleanupTimer: NodeJS.Timeout | undefined;

  const requestShutdown = () => {
    shutdownController.abort();
    if (mediaCleanupTimer) clearInterval(mediaCleanupTimer);
    if (runningApi && !shutdownStarted) {
      shutdownStarted = true;
      void runningApi.stop().then(() => {
        console.info("API shutdown complete.");
      }).catch(() => {
        console.error("API shutdown failed.");
        process.exitCode = 1;
      });
    }
  };

  process.once("SIGINT", requestShutdown);
  process.once("SIGTERM", requestShutdown);

  try {
    const config = loadConfig();
    configurePrivateAssetStorage(config);
    runningApi = await startServer(config, { signal: shutdownController.signal });
    if (config.mediaStorageProvider === "cloudinary") {
      mediaCleanupTimer = setInterval(() => { void reconcilePendingMediaCleanup().catch(() => console.error("Media cleanup could not complete.")); }, 15 * 60_000);
      mediaCleanupTimer.unref();
      void reconcilePendingMediaCleanup().catch(() => console.error("Media cleanup could not complete."));
    }

    if (shutdownController.signal.aborted) {
      await runningApi.stop();
      return;
    }

    console.info(`API listening on http://localhost:${config.apiPort}`);
  } catch (error) {
    if (error instanceof StartupInterruptedError || shutdownController.signal.aborted) {
      return;
    }

    if (error instanceof ConfigurationError) {
      console.error(error.message);
    } else {
      console.error("API startup failed. Check the API configuration and MongoDB availability.");
    }
    process.exitCode = 1;
  }
}

void main();
