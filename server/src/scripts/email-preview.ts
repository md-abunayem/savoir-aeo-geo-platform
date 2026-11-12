import "dotenv/config";
import { Pool } from "pg";
import { createPayloadCipher } from "../services/email/crypto.js";
const email = process.argv[2]?.trim().toLowerCase();
if (process.env.NODE_ENV === "production" || process.env.MAIL_ENABLED === "true")
  throw new Error("Email preview is only available in development with delivery disabled.");
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
  throw new Error("Usage: npm run email:preview -- <your-email>");
const key = process.env.EMAIL_PAYLOAD_KEY;
if (!key) throw new Error("EMAIL_PAYLOAD_KEY is required.");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const result = await pool.query(
    "SELECT encrypted_payload FROM public.email_outbox WHERE status='pending' AND expires_at>now() ORDER BY created_at DESC LIMIT 50",
  );
  for (const row of result.rows) {
    const m = createPayloadCipher(key).decrypt(row.encrypted_payload) as {
      to?: string;
      subject?: string;
      text?: string;
    };
    if (m.to?.toLowerCase() === email && m.subject === "Verify your Savoir email") {
      console.log(m.text);
      process.exitCode = 0;
      process.exit();
    }
  }
  console.log("No pending signup email found. Sign up again, then run this command promptly.");
} finally {
  await pool.end();
}
