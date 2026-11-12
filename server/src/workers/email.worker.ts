import "dotenv/config";
import { Queue, Worker } from "bullmq";
import { parseEnvironment } from "../config/env.js";
import { createLogger } from "../config/logger.js";
import { createDatabase } from "../db/index.js";
import { queueConnection } from "../jobs/connection.js";
import { createBrevoProvider } from "../services/email/brevo.adapter.js";
import { createEmailOutbox } from "../services/email/outbox.service.js";

async function main() {
  const env = parseEnvironment(process.env);
  if (!env.MAIL_ENABLED) throw new Error("Email delivery is disabled");
  const logger = createLogger(env.LOG_LEVEL);
  const { pool } = createDatabase(env.DATABASE_APP_URL ?? "");
  pool.on("error", () => logger.error("email database connection failed"));
  try {
    const role = await pool.query(
      "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
    );
    if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean))
      throw new Error("Restricted runtime role required");
  } catch (error) {
    await pool.end();
    throw error;
  }
  const provider = createBrevoProvider({
    apiKey: env.BREVO_API_KEY ?? "",
    senderEmail: env.BREVO_SENDER_EMAIL ?? "",
    senderName: env.BREVO_SENDER_NAME,
  });
  const outbox = createEmailOutbox(pool, env.EMAIL_PAYLOAD_KEY ?? "");
  const connection = queueConnection(env.REDIS_URL);
  const queue = new Queue("notification", {
    connection: { ...connection, maxRetriesPerRequest: 1 },
  });
  const worker = new Worker(
    "notification",
    async (job) => {
      if (job.name !== "drain-email-outbox") throw new Error("Unsupported notification job");
      for (let count = 0; count < 10; count++) {
        if (!(await outbox.processNext(provider))) break;
      }
    },
    { connection, concurrency: 1 },
  );
  queue.on("error", () => logger.error("notification queue error"));
  worker.on("error", () => logger.error("notification worker error"));
  worker.on("failed", (job) => logger.error({ jobId: job?.id }, "notification processing failed"));
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), env.SHUTDOWN_TIMEOUT_MS);
    deadline.unref();
    void worker
      .close()
      .then(() => queue.close())
      .then(() => pool.end())
      .then(() => clearTimeout(deadline))
      .catch(() => {
        process.exitCode = 1;
      });
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await queue.upsertJobScheduler(
      "email-outbox-poll",
      { every: 5000 },
      {
        name: "drain-email-outbox",
        data: {},
        opts: { removeOnComplete: { count: 20 }, removeOnFail: { count: 100 } },
      },
    );
    logger.info("Brevo outbox worker started");
  } catch {
    logger.error("notification scheduler startup failed");
    stop();
  }
}
main().catch(() => {
  console.error("Email worker cannot start; check mail configuration.");
  process.exitCode = 1;
});
