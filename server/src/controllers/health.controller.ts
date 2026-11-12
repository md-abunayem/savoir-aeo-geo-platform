import type { RequestHandler } from "express";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import type { Readiness } from "../services/infrastructure.service.js";

export function healthController(check: () => Promise<Readiness>, draining: () => boolean) {
  const live: RequestHandler = (_req, res) => {
    res.json(new ApiResponse(200, "API is alive", { status: "alive" }));
  };
  const ready = asyncHandler(async (_req, res) => {
    const result = draining() ? { ready: false } : await check();
    const status = result.ready ? 200 : 503;
    // Dependency details remain private; readiness is commonly publicly reachable.
    res.status(status).json(
      new ApiResponse(status, result.ready ? "API is ready" : "API is not ready", {
        status: result.ready ? "ready" : "not_ready",
      }),
    );
  });
  return { live, ready };
}
