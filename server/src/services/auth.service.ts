import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "../utils/ApiError.js";

export const ACCESS_SECONDS = 15 * 60;
export const SESSION_SECONDS = 7 * 24 * 60 * 60;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const invalidLogin = () =>
  new ApiError(401, "Invalid credentials or account unavailable", "INVALID_CREDENTIALS");
const invalidSession = () => new ApiError(401, "Session is invalid or expired", "INVALID_SESSION");
export interface AuthUser {
  id: string;
  name: string;
  email: string;
}
interface LoginUser extends AuthUser {
  password_hash: string | null;
  email_verified_at: Date | null;
}
interface SessionRow {
  session_id: string;
  user_id: string;
  expires_at: Date;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}
export interface AuthService {
  login(email: string, password: string): Promise<{ user: AuthUser; tokens: AuthTokens }>;
  refresh(refreshToken: string): Promise<AuthTokens>;
  logout(refreshToken: string): Promise<void>;
  authenticate(accessToken: string): Promise<AuthUser>;
}

export async function createAuthService(pool: Pool, secret: string): Promise<AuthService> {
  if (secret.length < 48) throw new Error("A strong authentication signing secret is required");
  const role = await pool.query<{
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcreaterole: boolean;
    rolcreatedb: boolean;
  }>(
    "SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user",
  );
  if (!role.rows[0] || Object.values(role.rows[0]).some(Boolean))
    throw new Error("Authentication requires a restricted runtime database role");
  const key = new TextEncoder().encode(secret);
  const dummyHash = await bcrypt.hash(randomBytes(32).toString("hex"), 12);
  async function issue(session: SessionRow, refreshToken: string): Promise<AuthTokens> {
    const accessToken = await new SignJWT({ sid: session.session_id })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuer("savoir")
      .setAudience("savoir-web")
      .setSubject(session.user_id)
      .setIssuedAt()
      .setExpirationTime(ACCESS_SECONDS + "s")
      .sign(key);
    return { accessToken, refreshToken, expiresAt: session.expires_at };
  }
  return {
    async login(email, password) {
      const result = await pool.query<LoginUser>("SELECT * FROM public.savoir_auth_find_user($1)", [
        email.toLowerCase(),
      ]);
      const user = result.rows.length === 1 ? result.rows[0] : undefined;
      const matches = await bcrypt.compare(password, user?.password_hash ?? dummyHash);
      if (!matches || !user?.password_hash || !user.email_verified_at) throw invalidLogin();
      const refreshToken = randomBytes(48).toString("base64url");
      const session = await pool.query<SessionRow>(
        "SELECT * FROM public.savoir_auth_create_session($1,$2,$3,$4)",
        [user.id, hashToken(refreshToken), randomUUID(), user.password_hash],
      );
      if (!session.rows[0]) throw invalidLogin();
      return {
        user: { id: user.id, name: user.name, email: user.email },
        tokens: await issue(session.rows[0], refreshToken),
      };
    },
    async refresh(refreshToken) {
      if (!/^[A-Za-z0-9_-]{64}$/.test(refreshToken)) throw invalidSession();
      const nextToken = randomBytes(48).toString("base64url");
      const result = await pool.query<SessionRow & { result: string }>(
        "SELECT * FROM public.savoir_auth_rotate_session($1,$2)",
        [hashToken(refreshToken), hashToken(nextToken)],
      );
      const session = result.rows[0];
      // Replay revocation has already committed before an HTTP error is returned.
      if (!session || session.result !== "ok") throw invalidSession();
      return issue(session, nextToken);
    },
    async logout(refreshToken) {
      if (/^[A-Za-z0-9_-]{64}$/.test(refreshToken))
        await pool.query("SELECT public.savoir_auth_revoke_session($1)", [hashToken(refreshToken)]);
    },
    async authenticate(accessToken) {
      let subject: string, sessionId: string;
      try {
        const { payload } = await jwtVerify(accessToken, key, {
          issuer: "savoir",
          audience: "savoir-web",
          algorithms: ["HS256"],
          requiredClaims: ["sub", "sid", "iat", "exp"],
        });
        subject = z.uuid().parse(payload.sub);
        sessionId = z.uuid().parse(payload.sid);
      } catch {
        throw invalidSession();
      }
      const result = await pool.query<AuthUser>(
        "SELECT * FROM public.savoir_auth_session_user($1,$2)",
        [sessionId, subject],
      );
      if (!result.rows[0]) throw invalidSession();
      return result.rows[0];
    },
  };
}
