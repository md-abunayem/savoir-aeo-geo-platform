"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LoaderCircle, ShieldAlert } from "lucide-react";
import { api } from "../../../../lib/api";

function GoogleCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    async function handleExchange() {
      const code = searchParams.get("code");
      const state = searchParams.get("state");

      if (!code || !state) {
        setError("Missing authorization code or state from Google sign-in.");
        return;
      }

      try {
        const res = await api.request<{ user: { id: string; name: string }; returnTo?: string }>(
          "/v1/auth/google/callback",
          {
            method: "POST",
            auth: false,
            body: { code, state },
          },
        );

        const destination = res?.returnTo || "/dashboard";
        router.replace(destination);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Google authentication failed. Please try signing in again.",
        );
      }
    }

    void handleExchange();
  }, [router, searchParams]);

  return (
    <main className="login-page">
      <div className="login-card" style={{ maxWidth: "420px", margin: "auto", textAlign: "center" }}>
        {error ? (
          <>
            <span className="icon-tile" style={{ background: "#fef2f2", color: "#dc2626" }}>
              <ShieldAlert size={28} />
            </span>
            <h2>Sign-in failed</h2>
            <p className="error" role="alert" style={{ margin: "1rem 0" }}>
              {error}
            </p>
            <Link className="button primary wide" href="/login">
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <span className="icon-tile">
              <LoaderCircle className="spin" size={28} />
            </span>
            <h2>Signing you in…</h2>
            <p className="muted">Securing your session with Google. Please wait a moment.</p>
          </>
        )}
      </div>
    </main>
  );
}

export default function GoogleCallbackPage() {
  return (
    <Suspense
      fallback={
        <main className="login-page">
          <div className="login-card" style={{ maxWidth: "420px", margin: "auto", textAlign: "center" }}>
            <span className="icon-tile">
              <LoaderCircle className="spin" size={28} />
            </span>
            <h2>Signing you in…</h2>
            <p className="muted">Please wait a moment…</p>
          </div>
        </main>
      }
    >
      <GoogleCallbackContent />
    </Suspense>
  );
}
