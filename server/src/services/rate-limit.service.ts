import { createHash } from "node:crypto";
import type { Redis } from "ioredis";

export interface RateLimiter {
  consume(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; retryAfter: number }>;
}
export function createRateLimiter(redis: Redis, prefix = "savoir:limit"): RateLimiter {
  return {
    async consume(key, limit, windowSeconds) {
      const storageKey = prefix + ":" + createHash("sha256").update(key).digest("hex");
      const result = (await redis.eval(
        "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return {n,redis.call('TTL',KEYS[1])}",
        1,
        storageKey,
        windowSeconds,
      )) as [number, number];
      return { allowed: result[0] <= limit, retryAfter: Math.max(1, result[1]) };
    },
  };
}
