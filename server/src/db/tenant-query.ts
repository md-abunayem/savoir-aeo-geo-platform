import { AsyncLocalStorage } from "node:async_hooks";
import type { Pool } from "pg";
import { withTenantClient, type TenantContext } from "./tenant.js";
import { ApiError } from "../utils/ApiError.js";

const requestTenant = new AsyncLocalStorage<TenantContext>();

export function getRequestTenantContext(): TenantContext {
  const context = requestTenant.getStore();
  if (!context) throw new ApiError(401, "Authenticated tenant context required", "AUTH_REQUIRED");
  return context;
}

/** Context must come from the authenticated user, never from a request body. */
export function runWithTenantContext<T>(context: TenantContext, operation: () => T): T {
  return requestTenant.run({ userId: context.userId, tenantId: context.tenantId }, operation);
}

/** Adapt query-based services to the same owner checks and RLS used by monitoring. */
export function createTenantQueryPool(pool: Pool): Pool {
  return new Proxy(pool, {
    get(target, property) {
      if (property === "query") {
        return (...args: unknown[]) => {
          const context = requestTenant.getStore();
          if (!context)
            return Promise.reject(
              new ApiError(401, "Authenticated tenant context required", "AUTH_REQUIRED"),
            );
          return withTenantClient(target, context, (client) =>
            Reflect.apply(client.query, client, args),
          );
        };
      }
      // These services use standalone queries. Explicit transactions must use
      // withTenantClient rather than checking out an unscoped connection.
      if (property === "connect") {
        return () => Promise.reject(new Error("Use withTenantClient for tenant transactions"));
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
