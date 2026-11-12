import type { Server } from "node:http";
import type { Logger } from "pino";

export function registerShutdown(
  server: Server,
  close: () => Promise<void>,
  logger: Logger,
  timeoutMs: number,
  onDrain: () => void,
) {
  let stopping = false;
  const shutdown = () => {
    if (stopping) return;
    stopping = true;
    onDrain();
    logger.info("shutting down");
    const deadline = setTimeout(() => {
      server.closeAllConnections();
      logger.error("shutdown deadline exceeded");
      process.exit(1);
    }, timeoutMs);
    deadline.unref();
    server.close(() => {
      void close()
        .then(() => {
          clearTimeout(deadline);
          process.exitCode = 0;
        })
        .catch(() => {
          logger.error("dependency shutdown failed");
          process.exit(1);
        });
    });
    server.closeIdleConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
