import { Router } from "express";
import type { Queue } from "bullmq";
import type { AuthRouteOptions } from "./auth.routes.js";
import type { OnboardingService } from "../services/onboarding.service.js";
import { onboardingController } from "../controllers/onboarding.controller.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";

export function onboardingRoutes(
  auth: AuthRouteOptions,
  service: OnboardingService,
  monitoringQueue?: Queue,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.use(authenticate(auth.service));
  const csrf = createCsrf(auth.csrfSecret, auth.secureCookies);
  const controller = onboardingController(service, auth.limiter, monitoringQueue);

  router.get("/draft", controller.getDraft);
  router.put("/draft", csrf.verify, controller.saveDraft);
  router.delete("/draft", csrf.verify, controller.deleteDraft);

  router.post("/analyze-domain", csrf.verify, controller.analyzeDomain);
  router.post("/generate-seeds", csrf.verify, controller.generateSeeds);
  router.post("/estimate-costs", controller.estimateCosts);
  router.post("/activate", csrf.verify, controller.activate);

  return router;
}
