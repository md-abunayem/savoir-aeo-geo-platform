import { Router } from "express";
import { healthController } from "../controllers/health.controller.js";
import type { Readiness } from "../services/infrastructure.service.js";

export function healthRoutes(check: () => Promise<Readiness>, draining: () => boolean) {
  const router = Router();
  const controller = healthController(check, draining);
  router.get("/live", controller.live);
  router.get("/ready", controller.ready);
  return router;
}
