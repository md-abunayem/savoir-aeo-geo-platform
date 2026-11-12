import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { ApiError } from "../utils/ApiError.js";

export const CSRF_COOKIE = "savoir_csrf";
function equal(a: string, b: string) {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function createCsrf(secret: string, secure: boolean) {
  if (secret.length < 48) throw new Error("A strong CSRF signing secret is required");
  const sign = (value: string) => createHmac("sha256", secret).update(value).digest("base64url");
  const issue: RequestHandler = (_req, res) => {
    const payload =
      randomBytes(32).toString("base64url") + "." + (Math.floor(Date.now() / 1000) + 7200);
    const token = payload + "." + sign(payload);
    res.setHeader("Cache-Control", "no-store");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure,
      sameSite: "strict",
      path: "/",
      maxAge: 7200000,
    });
    res.json({
      statusCode: 200,
      success: true,
      message: "CSRF token issued",
      data: { csrfToken: token },
    });
  };
  const verify: RequestHandler = (req, _res, next) => {
    const header = req.get("X-CSRF-Token");
    const cookie: unknown = req.cookies?.[CSRF_COOKIE];
    if (!header || typeof cookie !== "string" || header.length > 256 || !equal(header, cookie))
      return next(new ApiError(403, "CSRF verification failed", "INVALID_CSRF"));
    const [nonce, expires, signature, extra] = header.split(".");
    const expiry = Number(expires);
    if (
      !nonce ||
      !signature ||
      extra ||
      !Number.isInteger(expiry) ||
      expiry < Date.now() / 1000 ||
      !equal(sign(nonce + "." + expires), signature)
    ) {
      return next(new ApiError(403, "CSRF verification failed", "INVALID_CSRF"));
    }
    next();
  };
  return { issue, verify };
}
