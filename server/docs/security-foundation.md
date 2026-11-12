# Tenant isolation

Migration 0002 enables and forces RLS on users, tenants, memberships and projects. It creates a NOLOGIN capability role named savoir_runtime. It does not create or store a password, or change existing users, tenants or projects.

## Runtime connection

After migration, configure DATABASE_APP_URL with a distinct restricted login and a password of at least 24 characters. The host and database must match DATABASE_URL. Run npm run db:provision-runtime once to create the login and grant the capability role. DATABASE_URL must use a PostgreSQL administrator or a role with CREATEROLE and permission to grant membership in savoir_runtime. On managed PostgreSQL, use the provider's admin connection or provision the restricted role through its admin console if the migration connection lacks those permissions. The command only creates or updates the login named by DATABASE_APP_URL.

Migration access remains on DATABASE_URL. Production requires DATABASE_APP_URL. Do not give the runtime login superuser, BYPASSRLS, database-creation, role-creation or table-ownership privileges.

withTenant uses a transaction and transaction-local context, checks the runtime role, and verifies Owner membership before invoking the service operation. It rejects privileged database connections. The authenticated user ID must come from trusted server-side authentication, never a request body or query parameter.

## Current boundary

Verified-account session authentication is implemented; tenant CRUD and the full account lifecycle are not. The security migration and tests establish the prerequisite, not a finished identity system. Existing admin/analyst/viewer enum values remain for history compatibility, but they receive no access under the Owner-only launch policy.

Identity records are global and self-visible. Tenant and project rows require matching tenant context and Owner membership. Membership reads require the same user, tenant and Owner role. Runtime grants do not allow membership creation, role escalation or user credential changes. Session lookup uses scoped security-definer functions from migration 0003. Registration and tenant creation still require their own atomic identity workflows. Migration 0004 adds the protected encrypted email outbox.

## Testing and deployment

The isolation suite creates a randomly named database and restricted login, applies all migrations, tests real RLS and connection reuse, then drops only those generated test resources. It requires a local/CI administrator with permission to create test databases and roles. Never point integration tests at production.

The shared NOLOGIN capability role can remain after tests; it contains no password and provides access only where explicitly granted. No migration is automatically applied to the developer database by npm test or npm run check.
