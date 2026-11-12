"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ArrowLeft,
  KeyRound,
  MailCheck,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { passwordError } from "../lib/signup";
import { AuthLayout } from "./auth-layout";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.request("/v1/auth/forgot-password", {
        method: "POST",
        auth: false,
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The request could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <span className="icon-tile">
        {sent ? <MailCheck size={24} /> : <KeyRound size={24} />}
      </span>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h2>{sent ? "Check your inbox." : "Forgot your password?"}</h2>
      <p className="muted">
        Enter your account email. If it is eligible, we’ll send a reset code
        that expires in 30 minutes.
      </p>
      {sent ? (
        <>
          <p className="notice" role="status">
            If the account is eligible, a password reset email will be sent.
            Check your inbox and spam folder.
          </p>
          <Link className="button primary wide" href="/reset-password">
            I have a reset code <ArrowRight size={16} />
          </Link>
        </>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <label>
            Email address
            <input
              name="email"
              placeholder="you@company.com"
              type="email"
              autoComplete="email"
              required
              maxLength={255}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary wide" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} /> Please wait…
              </>
            ) : (
              <>
                Send reset code <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      )}
      <p className="login-note">
        <Link className="auth-back-link" href="/login">
          <ArrowLeft size={15} /> Back to sign in
        </Link>
      </p>
    </AuthLayout>
  );
}

export function ResetPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [token, setToken] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") ?? "");
    const validation = passwordError(password);
    if (validation) {
      setError(validation);
      return;
    }
    if (password !== data.get("confirmPassword")) {
      setError("Passwords do not match.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api.request("/v1/auth/reset-password", {
        method: "POST",
        auth: false,
        body: { token: token.trim(), password },
      });
      setComplete(true);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The request could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <span className="icon-tile">
        <ShieldCheck size={24} />
      </span>
      <p className="eyebrow">ACCOUNT RECOVERY</p>
      <h2>{complete ? "Password updated." : "Choose a new password."}</h2>
      <p className="muted">
        {complete
          ? "Your password has been reset and previous sessions have been signed out."
          : "Enter the 64-character code from your reset email and choose a new password."}
      </p>
      {complete ? (
        <>
          <p className="notice" role="status">
            Sign in with your new password to continue.
          </p>
          <Link className="button primary wide" href="/login">
            Continue to sign in <ArrowRight size={16} />
          </Link>
        </>
      ) : (
        <form onSubmit={submit} aria-busy={busy}>
          <label>
            Password reset code
            <input
              name="token"
              type="text"
              autoComplete="one-time-code"
              autoCapitalize="none"
              spellCheck={false}
              required
              minLength={64}
              maxLength={64}
              pattern="[a-f0-9]{64}"
              value={token}
              onChange={(event) =>
                setToken(event.target.value.trim().toLowerCase())
              }
              disabled={busy}
            />
          </label>
          <small className="muted">
            Codes expire after 30 minutes and can only be used once.
          </small>
          <label>
            New password
            <input
              name="password"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              aria-describedby="reset-password-help"
            />
          </label>
          <small id="reset-password-help" className="muted">
            Use at least 15 characters and no more than 72 UTF-8 bytes.
          </small>
          <label>
            Confirm new password
            <input
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary wide" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle className="spin" size={16} /> Please wait…
              </>
            ) : (
              <>
                Reset password <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      )}
      {!complete && (
        <p className="login-note">
          Need a code? <Link href="/forgot-password">Request a reset code</Link>
          .
          <br />
          <Link href="/login">Back to sign in</Link>
        </p>
      )}
    </AuthLayout>
  );
}
