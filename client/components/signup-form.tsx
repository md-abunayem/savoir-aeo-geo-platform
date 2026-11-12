"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Eye,
  EyeOff,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { api } from "../lib/api";
import { passwordError } from "../lib/signup";
import { AuthLayout } from "./auth-layout";
import { GoogleAuthButton } from "./google-button";

export function SignupForm({
  verification = false,
}: {
  verification?: boolean;
}) {
  const [step, setStep] = useState(verification ? "verify" : "signup");
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [visible, setVisible] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const resend = data.get("action") === "resend";
    const password = String(data.get("password") ?? "");
    setError("");
    setNotice("");
    if (step === "signup") {
      const validation = passwordError(password);
      if (validation) {
        setError(validation);
        return;
      }
      if (password !== data.get("confirmPassword")) {
        setError("Passwords do not match.");
        return;
      }
    }
    pending.current = true;
    setBusy(true);
    try {
      if (step === "signup") {
        const res = await api.request<{ verified?: boolean }>(
          "/v1/auth/register",
          {
            method: "POST",
            auth: false,
            body: {
              name: String(data.get("name")).trim(),
              email: email.trim(),
              password,
            },
          },
        );
        form.reset();
        setVisible(false);
        if (res?.verified) {
          setStep("done");
          setNotice("Your account has been created. You can now sign in.");
        } else {
          setStep("verify");
          setNotice(
            "If your account is eligible, a verification email will be sent. Check your inbox and spam folder.",
          );
        }
      } else if (resend) {
        await api.request("/v1/auth/resend-verification", {
          method: "POST",
          auth: false,
          body: { email: email.trim() },
        });
        setNotice(
          "If your account is eligible, a new code will be sent. Allow at least 60 seconds between requests and use the newest code.",
        );
      } else {
        await api.request("/v1/auth/verify-email", {
          method: "POST",
          auth: false,
          body: { token: String(data.get("token")).trim(), password },
        });
        form.reset();
        setStep("done");
        setNotice("Your email is verified. You can now sign in.");
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "The request could not be completed. Please try again.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <span className="icon-tile">
        <ShieldCheck size={24} />
      </span>
      <p className="eyebrow">YOUR SAVOIR ACCOUNT</p>
      <h2>
        {step === "signup"
          ? "Start with clarity."
          : step === "verify"
            ? "Verify your email."
            : "You’re all set."}
      </h2>
      <p className="muted">
        {step === "signup"
          ? "Create your account to start exploring AI visibility."
          : step === "verify"
            ? "Enter the code from your email and the password you chose at signup. Codes expire after 30 minutes."
            : "Sign in to continue to your workspace."}
      </p>
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {step === "done" ? (
        <Link className="button primary wide" href="/login">
          Continue to sign in <ArrowRight size={16} />
        </Link>
      ) : (
        <>
          {step === "signup" && (
            <>
              <GoogleAuthButton
                label="Sign up with Google"
                returnTo="/onboarding"
              />
              <div className="auth-divider">
                <span>or sign up with email</span>
              </div>
            </>
          )}
          <form key={step} onSubmit={submit} aria-busy={busy}>
            {step === "signup" && (
              <>
                <label>
                  Full name
                  <input
                    name="name"
                    placeholder="Your full name"
                    autoComplete="name"
                    required
                    maxLength={150}
                    pattern={".*\\S.*"}
                    disabled={busy}
                  />
                </label>
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
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </>
            )}
            {step === "verify" && (
              <label>
                Verification code
                <input
                  name="token"
                  autoComplete="one-time-code"
                  required
                  pattern="[a-f0-9]{64}"
                  onChange={(e) => {
                    e.target.value = e.target.value.trim();
                  }}
                  aria-describedby="verification-help"
                  disabled={busy}
                />
              </label>
            )}
            <div>
              <label htmlFor="signup-password">
                {step === "signup" ? "Password" : "Registration password"}
              </label>
              <div className="password-field">
                <input
                  id="signup-password"
                  placeholder="Create a strong password"
                  name="password"
                  type={visible ? "text" : "password"}
                  autoComplete={
                    step === "signup" ? "new-password" : "current-password"
                  }
                  required
                  aria-describedby={
                    step === "signup" ? "password-help" : undefined
                  }
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setVisible(!visible)}
                  aria-label={visible ? "Hide password" : "Show password"}
                >
                  {visible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {step === "signup" ? (
              <>
                <small id="password-help" className="muted">
                  Use at least 15 characters, up to 72 UTF-8 bytes. Avoid common
                  or compromised passwords.
                </small>
                <label>
                  Confirm password
                  <input
                    name="confirmPassword"
                    placeholder="Enter your password again"
                    type={visible ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    disabled={busy}
                  />
                </label>
              </>
            ) : (
              <small id="verification-help" className="muted">
                Paste the full 64-character code. Only verify an account you
                created.
              </small>
            )}
            <button className="button primary wide" disabled={busy}>
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={16} /> Please wait…
                </>
              ) : (
                <>
                  {step === "signup" ? "Create account" : "Verify email"}
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </form>
          {step === "verify" && (
            <form
              className="verification-resend"
              onSubmit={submit}
              aria-busy={busy}
            >
              <input type="hidden" name="action" value="resend" />
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
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <button className="button wide" disabled={busy}>
                Resend verification code
              </button>
            </form>
          )}
        </>
      )}
      <p className="login-note">
        Already have an account? <Link href="/login">Sign in</Link>.
        {step === "signup" && (
          <>
            <br />
            Already have a code?{" "}
            <Link href="/verify-email">Verify your email</Link>.
          </>
        )}
        {step === "verify" && (
          <>
            <br />
            <Link href="/signup">Back to signup</Link>
          </>
        )}
      </p>
    </AuthLayout>
  );
}
