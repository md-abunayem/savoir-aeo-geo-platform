import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { createEmailOutbox } from "../email/outbox.service.js";
export function createMonitoringNotifier(pool: Pool, key: string) {
  return {
    async drain() {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const alerts = await client.query<{
          event_id: string;
          user_id: string;
          email: string;
          kind: string;
          project_id: string;
        }>("SELECT * FROM savoir_monitoring_alerts()");
        const outbox = createEmailOutbox(client, key);
        for (const alert of alerts.rows) {
          const hex = createHash("sha256")
            .update(alert.event_id + ":" + alert.user_id)
            .digest("hex");
          const id =
            hex.slice(0, 8) +
            "-" +
            hex.slice(8, 12) +
            "-4" +
            hex.slice(13, 16) +
            "-8" +
            hex.slice(17, 20) +
            "-" +
            hex.slice(20, 32);
          await outbox.enqueue(
            id,
            alert.user_id,
            {
              to: alert.email,
              subject: "Savoir monitoring notification",
              text:
                "Monitoring event: " +
                alert.kind +
                "\nProject: " +
                alert.project_id +
                "\nCheck monitoring health and events for details. Quota-paused schedules require credits and an explicit resume.",
            },
            new Date(Date.now() + 23 * 60 * 60 * 1000),
          );
          await client.query("SELECT savoir_monitoring_alert_done($1)", [alert.event_id]);
        }
        await client.query("COMMIT");
        return alerts.rowCount ?? 0;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
