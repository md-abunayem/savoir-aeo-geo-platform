import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { RateLimiter } from "../rate-limit.service.js";
import { ApiError } from "../../utils/ApiError.js";

export class ApiKeyService {
  constructor(
    private pool: Pool,
    private limiter: RateLimiter,
  ) {}

  async authorize(
    authorization: string | undefined,
    projectId: string,
    scope: "read:traffic" | "read:actions",
    ip: string,
  ) {
    const consume = async (key: string, count: number) => {
      try {
        const result = await this.limiter.consume(key, count, 60);
        if (!result.allowed) throw new Error("rate limit");
      } catch {
        throw new ApiError(
          429,
          "Public API rate limit reached. Try again in one minute.",
          "RATE_LIMITED",
        );
      }
    };
    await consume("public-api-ip:" + ip, 180);
    const match = /^Bearer (sk_live_[a-f0-9]{48})$/.exec(authorization ?? "");
    if (!match) throw new ApiError(401, "A valid scoped API key is required", "INVALID_API_KEY");
    const result = await this.pool.query<{
      key_id: string;
      tenant_id: string;
      project_id: string;
      user_id: string;
      rate_limit_rpm: number;
    }>("SELECT * FROM public.savoir_public_api_identity($1,$2,$3)", [
      createHash("sha256").update(match[1]).digest("hex"),
      projectId,
      scope,
    ]);
    const identity = result.rows[0];
    if (!identity)
      throw new ApiError(
        401,
        "API key is invalid, revoked, expired, or lacks this scope",
        "INVALID_API_KEY",
      );
    await consume(
      "public-api-key:" + identity.key_id,
      Math.min(1000, Math.max(10, identity.rate_limit_rpm)),
    );
    return {
      tenantId: identity.tenant_id,
      projectId: identity.project_id,
      userId: identity.user_id,
    };
  }
}
