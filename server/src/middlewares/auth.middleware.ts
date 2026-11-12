import type { RequestHandler } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import type { AuthService } from "../services/auth.service.js";
import { runWithTenantContext } from "../db/tenant-query.js";

export const ACCESS_COOKIE = "savoir_access";
export const REFRESH_COOKIE = "savoir_refresh";
export function authenticate(auth: AuthService): RequestHandler {
  return asyncHandler(async (req, res, next) => {
    const token: unknown = req.cookies?.[ACCESS_COOKIE];
    if (typeof token !== "string")
      throw new ApiError(401, "Authentication required", "AUTH_REQUIRED");
    res.locals.user = await auth.authenticate(token);
    const tenantId = req.params.tenantId;
    if (typeof tenantId === "string") {
      runWithTenantContext({ userId: res.locals.user.id, tenantId }, next);
    } else next();
  });
}
