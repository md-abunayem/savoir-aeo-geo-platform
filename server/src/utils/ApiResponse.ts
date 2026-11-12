export class ApiResponse<T = unknown> {
  readonly success: boolean;

  constructor(
    readonly statusCode: number,
    readonly message: string,
    readonly data: T,
  ) {
    this.success = statusCode < 400;
  }
}
