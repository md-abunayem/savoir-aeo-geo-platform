export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
type Options = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  timeoutMs?: number;
};
export function createApiClient(
  fetcher: typeof fetch = fetch,
  readCookie = () => (typeof document === "undefined" ? "" : document.cookie),
) {
  let csrfPending: Promise<string> | undefined;
  let refreshPending: Promise<void> | undefined;
  async function raw<T>(path: string, options: Options = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(path, {
        method: options.method ?? "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          ...(options.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
          ...options.headers,
        },
        ...(options.body !== undefined
          ? { body: JSON.stringify(options.body) }
          : {}),
        signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
      });
    } catch {
      throw new ApiError(
        0,
        "NETWORK_ERROR",
        "We could not reach the server. Check your connection and try again.",
      );
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        response.status,
        payload?.code ?? "API_ERROR",
        payload?.detail ?? (response.status >= 500 ? "The server is unavailable. Please try again shortly." : "The request could not be completed."),
        payload?.requestId,
      );
    if (!payload || payload.success !== true || !("data" in payload))
      throw new ApiError(
        502,
        "INVALID_RESPONSE",
        "The server returned an unexpected response.",
      );
    return payload.data as T;
  }
  function csrf(force = false): Promise<string> {
    const token = readCookie()
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("savoir_csrf="))
      ?.slice(12);
    if (token && !force) return Promise.resolve(decodeURIComponent(token));
    if (!csrfPending)
      csrfPending = raw<{ csrfToken: string }>("/v1/auth/csrf")
        .then((r) => r.csrfToken)
        .finally(() => {
          csrfPending = undefined;
        });
    return csrfPending;
  }
  async function write<T>(path: string, options: Options): Promise<T> {
    const send = async (force = false) =>
      raw<T>(path, {
        ...options,
        headers: { ...options.headers, "X-CSRF-Token": await csrf(force) },
      });
    try {
      return await send();
    } catch (error) {
      if (error instanceof ApiError && error.code === "INVALID_CSRF")
        return send(true);
      throw error;
    }
  }
  async function refresh() {
    if (!refreshPending) {
      const renew = async () => {
        // Another tab may have rotated the shared refresh cookie while we waited.
        try {
          await raw("/v1/auth/me");
          return;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
        }
        await write("/v1/auth/refresh", { method: "POST" });
      };
      refreshPending = (
        typeof navigator !== "undefined" && navigator.locks
          ? navigator.locks.request("savoir-session-refresh", renew)
          : renew()
      ).finally(() => {
        refreshPending = undefined;
      });
    }
    return refreshPending;
  }
  return {
    async request<T>(path: string, options: Options = {}): Promise<T> {
      if (!path.startsWith("/v1/"))
        throw new Error("API paths must start with /v1/");
      const send = () =>
        options.method && options.method !== "GET"
          ? write<T>(path, options)
          : raw<T>(path, options);
      try {
        return await send();
      } catch (error) {
        if (
          error instanceof ApiError &&
          error.status === 401 &&
          options.auth !== false
        ) {
          await refresh();
          return send();
        }
        throw error;
      }
    },
  };
}
export const api = createApiClient();

