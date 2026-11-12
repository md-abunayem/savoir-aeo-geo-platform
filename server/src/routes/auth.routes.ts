import type { PasswordResetService } from "../services/password-reset.service.js";
import { passwordResetController } from "../controllers/password-reset.controller.js";
import type { RegistrationService } from "../services/registration.service.js";
import { registrationController } from "../controllers/registration.controller.js";
import { Router } from "express";
import type { AuthService } from "../services/auth.service.js";
import type { OAuthService } from "../services/oauth.service.js";
import type { RateLimiter } from "../services/rate-limit.service.js";
import { createCsrf } from "../middlewares/csrf.middleware.js";
import { authenticate } from "../middlewares/auth.middleware.js";
import { authController } from "../controllers/auth.controller.js";

export interface AuthRouteOptions {
  service: AuthService;
  oauth?: OAuthService;
  registration?: RegistrationService;
  passwordReset?: PasswordResetService;
  limiter: RateLimiter;
  csrfSecret: string;
  secureCookies: boolean;
  requireEmailVerification?: boolean;
}
export function authRoutes(options: AuthRouteOptions) {
  const router = Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const csrf = createCsrf(options.csrfSecret, options.secureCookies);
  const controller = authController(
    options.service,
    options.limiter,
    options.secureCookies,
    options.oauth,
  );
  router.get("/csrf", csrf.issue);
  if (options.registration) {
    const lifecycle = registrationController(options.registration, options.limiter, {
      requireEmailVerification: options.requireEmailVerification,
    });
    router.post("/register", csrf.verify, lifecycle.register);
    router.post("/verify-email", csrf.verify, lifecycle.verify);
    router.post("/resend-verification", csrf.verify, lifecycle.resend);
  }
  if (options.passwordReset) {
    const reset = passwordResetController(
      options.passwordReset,
      options.limiter,
      options.secureCookies,
    );
    router.post("/forgot-password", csrf.verify, reset.request);
    router.post("/reset-password", csrf.verify, reset.reset);
  }
  if (options.oauth) {
    router.get("/google/url", controller.googleUrl);
    router.post("/google/callback", controller.googleCallback);
    router.get("/google/callback", controller.googleCallbackRedirect);
  }
  router.post("/login", csrf.verify, controller.login);
  router.post("/refresh", csrf.verify, controller.refresh);
  router.post("/logout", csrf.verify, controller.logout);
  router.get("/me", authenticate(options.service), controller.me);
  return router;
}
