import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js";
import type { GraderService } from "../services/grader/grader.service.js";
import type { AuthService } from "../services/auth.service.js";
import { ACCESS_COOKIE } from "../middlewares/auth.middleware.js";
import { submitGraderSchema, emailGraderReportSchema } from "../validations/grader.validation.js";

export interface GraderRouteOptions {
  authService?: AuthService;
}

export function graderRoutes(service: GraderService, options: GraderRouteOptions = {}): Router {
  const router = Router();

  // 1. Submit brand/domain for Grader analysis (HG-01, HG-02, HG-03)
  router.post(
    "/submit",
    asyncHandler(async (req, res) => {
      const parsed = submitGraderSchema.parse({ body: req.body });

      // Extract client IP address
      const forwarded = req.headers["x-forwarded-for"];
      const rawIp =
        (typeof forwarded === "string" ? forwarded.split(",")[0] : undefined) ||
        req.ip ||
        req.socket.remoteAddress ||
        "127.0.0.1";
      const cleanIp = rawIp.replace(/^::ffff:/, "").trim();

      const result = await service.submitGrader(
        parsed.body,
        cleanIp,
        parsed.body.deviceFingerprint,
      );

      res
        .status(result.isCached ? 200 : 202)
        .json(
          new ApiResponse(
            result.isCached ? 200 : 202,
            result.isCached ? "Cached grader report retrieved" : "Grader analysis initiated",
            result,
          ),
        );
    }),
  );

  // 2. Poll / Retrieve Grader Report by Share Token (HG-09, HG-21)
  router.get(
    "/reports/:shareToken",
    asyncHandler(async (req, res) => {
      const shareToken = String(req.params.shareToken);
      const report = await service.getReportByShareToken(shareToken);
      res.json(new ApiResponse(200, "Grader report retrieved successfully", report));
    }),
  );

  // 3. Email-Gated PDF / Save Report Link (HG-21, HG-22)
  router.post(
    "/reports/:shareToken/email",
    asyncHandler(async (req, res) => {
      const parsed = emailGraderReportSchema.parse({ body: req.body });
      const shareToken = String(req.params.shareToken);
      await service.saveEmailCapture(shareToken, parsed.body.email, parsed.body.consent);
      res.json(
        new ApiResponse(200, "Report delivery email registered successfully", {
          email: parsed.body.email,
        }),
      );
    }),
  );

  // 4. Convert Grader Report to M1 Onboarding Project (HG-24, ONB-FR-013)
  router.post(
    "/reports/:shareToken/convert",
    asyncHandler(async (req, res) => {
      // Authenticate user session
      const token: unknown = req.cookies?.[ACCESS_COOKIE];
      if (typeof token !== "string" || !options.authService) {
        throw new ApiError(
          401,
          "Please sign up or log in to convert your grader report into a continuous monitoring project.",
          "AUTH_REQUIRED",
        );
      }
      const user = await options.authService.authenticate(token);

      const shareToken = String(req.params.shareToken);
      const result = await service.convertToProject(user.id, shareToken);

      res.json(new ApiResponse(200, "Grader report converted to project onboarding draft", result));
    }),
  );

  // 5. Download / Print PDF Report (HG-21)
  router.get(
    "/reports/:shareToken/pdf",
    asyncHandler(async (req, res) => {
      const shareToken = String(req.params.shareToken);
      const pdfData = await service.getPdfData(shareToken);
      res.json(new ApiResponse(200, "PDF export data generated", pdfData));
    }),
  );

  return router;
}
