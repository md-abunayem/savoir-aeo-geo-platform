"use client";
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "../../lib/api";
import { AuthLayout } from "../../components/auth-layout";
import { GoogleAuthButton } from "../../components/google-button";
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api.request("/v1/auth/login", {
        method: "POST",
        auth: false,
        body: {
          email: String(data.get("email")).trim(),
          password: String(data.get("password")),
        },
      });
      router.replace("/dashboard");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not sign in.");
      setBusy(false);
    }
  }
  return (
    <AuthLayout>
      <span className="icon-tile">
        <ShieldCheck size={24} />
      </span>
      <p className="eyebrow">YOUR WORKSPACE</p>
      <h2>Welcome back.</h2>
      <p className="muted">Sign in to see what your next answer holds.</p>
      <GoogleAuthButton label="Continue with Google" returnTo="/dashboard" />
      <div className="auth-divider">
        <span>or continue with email</span>
      </div>
      <form onSubmit={submit} aria-busy={busy}>
        <label>
          Email address
          <input
            name="email"
            type="email"
            autoComplete="username"
            disabled={busy}
            placeholder="you@company.com"
            required
            maxLength={255}
          />
        </label>
        <label>
          Password
          <div className="password-field">
            <input
              name="password"
              type={visible ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              disabled={busy}
              required
            />
            <button
              type="button"
              onClick={() => setVisible(!visible)}
              aria-label={visible ? "Hide password" : "Show password"}
            >
              {visible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <div className="auth-recovery-link">
          <Link href="/forgot-password">Forgot your password?</Link>
        </div>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary wide" disabled={busy}>
          {busy ? (
            <>
              <LoaderCircle className="spin" size={16} /> Signing in...
            </>
          ) : (
            <>
              Sign in <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
      <p className="login-note">
        New to Savoir? <Link href="/signup">Create an account</Link>.<br />
        Already have a code? <Link href="/verify-email">Verify your email</Link>
        .
      </p>
    </AuthLayout>
  );
}
