export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly success = false;
  readonly data = null;

  constructor(statusCode: number, message = "Something went wrong", code = "INTERNAL_ERROR") {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}
