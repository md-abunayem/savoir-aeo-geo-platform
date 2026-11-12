import type { Request, Response, NextFunction } from "express";
import { ApiError } from "../utils/ApiError.js";

export function createOperatorMiddleware(expectedKey = "savoir-operator-secret-2026") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const operatorKeyHeader = req.headers["x-operator-key"] as string | undefined;
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;

    const keyToTest = operatorKeyHeader || bearerToken;

    if (!keyToTest) {
      return next(new ApiError(401, "Operator credentials required", "OPERATOR_UNAUTHORIZED"));
    }

    if (keyToTest !== expectedKey) {
      return next(new ApiError(403, "Invalid operator secret key", "OPERATOR_FORBIDDEN"));
    }

    // Attach operator context
    (req as Request & { operatorId?: string }).operatorId = "sys-operator";
    next();
  };
}
