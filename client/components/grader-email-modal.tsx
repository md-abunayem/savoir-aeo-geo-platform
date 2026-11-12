"use client";

import { useState } from "react";
import { api, ApiError } from "../lib/api";
import { Download, Mail, Check, X, LoaderCircle, AlertCircle } from "lucide-react";

export interface GraderEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  shareToken: string;
  brandName: string;
}

export function GraderEmailModal({
  isOpen,
  onClose,
  shareToken,
  brandName,
}: GraderEmailModalProps) {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) {
      setError("Please provide a valid email address.");
      return;
    }
    if (!consent) {
      setError("Please check the consent box to receive your audit report.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await api.request(`/v1/grader/reports/${shareToken}/email`, {
        method: "POST",
        body: { email: email.trim(), consent: true },
        auth: false,
      });
      setSuccess(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to register email. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const pdfDownloadUrl = `/v1/grader/reports/${shareToken}/pdf`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="space-y-4">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>

          <div>
            <h3 className="text-lg font-bold text-foreground">Save & Download Report</h3>
            <p className="text-xs text-muted-foreground mt-1">
              Receive a permanent PDF copy and direct shareable link for <strong>{brandName}</strong>.
            </p>
          </div>

          {success ? (
            <div className="space-y-4 pt-2">
              <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-700 dark:text-emerald-300 space-y-1">
                <div className="font-semibold flex items-center gap-1.5">
                  <Check className="w-4 h-4 text-emerald-600" />
                  Report link sent to {email}
                </div>
                <p>You can also download your PDF report directly right now.</p>
              </div>

              <div className="flex items-center gap-3">
                <a
                  href={pdfDownloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  <span>Download PDF</span>
                </a>
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 rounded-xl border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-1">
              {error && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Work Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 rounded border-border text-primary focus:ring-primary/30"
                />
                <span>
                  I agree to receive my AI Search Audit report and periodic insights on AI search visibility from Savoir.
                </span>
              </label>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl border border-border bg-background text-xs font-medium hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {loading && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
                  <span>Send PDF & Link</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

