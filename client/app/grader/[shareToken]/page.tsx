"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  LoaderCircle,
} from "lucide-react";
import { api, ApiError } from "../../../lib/api";
import type { GraderReportData, SubmitGraderResponse } from "../../../lib/types";
import { GraderReport } from "../../../components/grader-report";
import { GraderEmailModal } from "../../../components/grader-email-modal";

interface PageProps {
  params: Promise<{ shareToken: string }>;
}

export default function GraderReportDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { shareToken } = use(params);

  const [report, setReport] = useState<GraderReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  useEffect(() => {
    let active = true;
    let poller: NodeJS.Timeout | null = null;

    async function fetchReport() {
      try {
        const data = await api.request<GraderReportData>(
          `/v1/grader/reports/${shareToken}`,
          { auth: false },
        );

        if (!active) return;
        setReport(data);

        // If status is running or pending, poll until complete
        if (data.status === "pending" || data.status === "running") {
          poller = setTimeout(fetchReport, 2000);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (!active) return;
        setLoading(false);
        if (err instanceof ApiError) {
          setError(err.message);
        } else {
          setError("Failed to load audit report. The link may have expired or is invalid.");
        }
      }
    }

    void fetchReport();

    return () => {
      active = false;
      if (poller) clearTimeout(poller);
    };
  }, [shareToken]);

  const handleConvert = async () => {
    if (!report) return;
    setConverting(true);

    try {
      await api.request(`/v1/grader/reports/${shareToken}/convert`, {
        method: "POST",
      });
      // Converted successfully -> navigate to onboarding with pre-loaded draft
      router.push(`/onboarding?fromGrader=${shareToken}`);
    } catch (err) {
      setConverting(false);
      if (err instanceof ApiError && err.status === 401) {
        // User not logged in -> redirect to signup with return URL to onboarding
        const returnUrl = encodeURIComponent(`/onboarding?fromGrader=${shareToken}`);
        router.push(`/signup?redirect=${returnUrl}`);
      } else {
        // Fallback navigate to onboarding directly so user can register
        router.push(`/onboarding?fromGrader=${shareToken}`);
      }
    }
  };

  const handleRerun = async () => {
    if (!report || rerunning) return;
    setRerunning(true);

    try {
      const result = await api.request<SubmitGraderResponse>("/v1/grader/submit", {
        method: "POST",
        body: {
          brandName: report.brandName,
          domain: report.domain,
          category: report.category,
          country: report.country,
          competitors: report.competitors,
          forceRefresh: true,
        },
        auth: false,
      });

      if (result.shareToken && result.shareToken !== shareToken) {
        router.push(`/grader/${result.shareToken}`);
      } else {
        // Reload current report
        const refreshed = await api.request<GraderReportData>(
          `/v1/grader/reports/${shareToken}`,
          { auth: false },
        );
        setReport(refreshed);
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      }
    } finally {
      setRerunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
      {/* Top Navigation */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
              <span className="w-6 h-6 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-black text-xs">
                S
              </span>
              <span>savoir</span>
              <span className="text-primary font-bold">.</span>
            </Link>

            <span className="text-muted-foreground">•</span>

            <Link
              href="/grader"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>AI Search Grader</span>
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Sign In
            </Link>
            <Link
              href="/signup"
              className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-8 md:py-12">
        {loading ? (
          <div className="py-24 text-center space-y-4">
            <LoaderCircle className="w-8 h-8 text-primary animate-spin mx-auto" />
            <div className="space-y-1">
              <h2 className="text-lg font-bold text-foreground">Loading AI Search Audit...</h2>
              <p className="text-xs text-muted-foreground">
                Retrieving model responses, citations, and crawler health checks.
              </p>
            </div>
          </div>
        ) : error || !report ? (
          <div className="max-w-md mx-auto py-16 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-500/10 text-rose-600 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold text-foreground">Report Not Available</h2>
              <p className="text-xs text-muted-foreground">
                {error || "This audit report could not be found or has expired after 30 days."}
              </p>
            </div>
            <div className="pt-2">
              <Link
                href="/grader"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors"
              >
                <span>Run New Free Audit</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        ) : (
          <>
            <GraderReport
              report={report}
              onConvert={handleConvert}
              converting={converting}
              onOpenEmailModal={() => setEmailModalOpen(true)}
              onRerun={handleRerun}
              rerunning={rerunning}
            />

            <GraderEmailModal
              isOpen={emailModalOpen}
              onClose={() => setEmailModalOpen(false)}
              shareToken={shareToken}
              brandName={report.brandName}
            />
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">Savoir</span>
            <span>&bull; AI Visibility & Competitor Intelligence Platform</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/grader" className="hover:text-foreground transition-colors">
              AI Search Grader
            </Link>
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign In
            </Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">
              Create Account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
