import { STATUS_CODES } from "node:http";
import type { ErrorRequestHandler } from "express";
import type { Logger } from "pino";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError.js";

export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, _req, res, next) => {
    if (res.headersSent) return next(error);
    let problem =
      error instanceof ApiError ? error : new ApiError(500, "An unexpected error occurred");
    if (error instanceof ZodError)
      problem = new ApiError(400, "Request validation failed", "VALIDATION_ERROR");
    if (typeof error === "object" && error !== null && "type" in error) {
      if (error.type === "entity.parse.failed")
        problem = new ApiError(400, "Malformed JSON body", "INVALID_JSON");
      if (error.type === "entity.too.large")
        problem = new ApiError(413, "Request body is too large", "PAYLOAD_TOO_LARGE");
    }

    const requestId = res.locals.requestId as string;
    if (problem.statusCode >= 500) {
      logger.error(
        {
          requestId,
          statusCode: problem.statusCode,
          code: problem.code,
          message: problem.message,
          errorName: error instanceof Error ? error.name : typeof error,
          stack: error instanceof Error ? error.stack?.split("\n").slice(1).join("\n") : undefined,
        },
        "unhandled request error",
      );
    }

    res
      .status(problem.statusCode)
      .type("application/problem+json")
      .json({
        type: "about:blank",
        title: STATUS_CODES[problem.statusCode] ?? "Error",
        status: problem.statusCode,
        detail:
          problem.statusCode >= 500
            ? "An unexpected error occurred"
            : error instanceof Error
              ? error.message
              : problem.message,
        code: problem.code,
        requestId,
      });
  };
}
