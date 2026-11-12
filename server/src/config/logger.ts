import { pino } from "pino";

export function createLogger(level = "info") {
  return pino({
    level,
    redact: {
      paths: [
        "password",
        "passwordHash",
        "token",
        "accessToken",
        "refreshToken",
        "authorization",
        "cookie",
        "req.headers.authorization",
        "req.headers.cookie",
      ],
      censor: "[REDACTED]",
    },
    base: { service: "savoir-backend" },
  });
}
