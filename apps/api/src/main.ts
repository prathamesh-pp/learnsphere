import "dotenv/config";
import { ConfigurationError, loadConfig } from "./config/env.js";
import { startServer, StartupInterruptedError } from "./server.js";

async function main(): Promise<void> {
  const shutdownController = new AbortController();
  let runningApi: Awaited<ReturnType<typeof startServer>> | undefined;
  let shutdownStarted = false;

  const requestShutdown = () => {
    shutdownController.abort();
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
    runningApi = await startServer(config, { signal: shutdownController.signal });

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
