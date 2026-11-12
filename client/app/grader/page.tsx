"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Globe,
  LoaderCircle,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
  AlertCircle,
} from "lucide-react";
import { api, ApiError } from "../../lib/api";
import type { SubmitGraderResponse, GraderReportData } from "../../lib/types";

interface CompetitorField {
  name: string;
  domain: string;
}

const STAGES = [
  { id: 1, name: "Domain Architecture & Extraction", pct: 15, desc: "Inspecting brand domain and normalized metadata" },
  { id: 2, name: "Prompt Generation & Intent Synthesis", pct: 35, desc: "Formulating 12-15 category, comparison & discovery prompts" },
  { id: 3, name: "Technical AEO Crawl & Directives", pct: 55, desc: "Checking robots.txt AI bots, llms.txt, and Schema.org" },
  { id: 4, name: "Multi-Engine Live Sampling", pct: 80, desc: "Executing 3 runs each across OpenAI ChatGPT & Google Gemini" },
  { id: 5, name: "Normative Scoring & Recommendations", pct: 100, desc: "Computing visibility rate, share of voice & prioritized actions" },
];

const ROTATING_TIPS = [
  "Did you know? AI Overviews cite sources in over 85% of commercial and comparison searches.",
  "ChatGPT with Web Search relies heavily on authoritative citations and clear schema markup.",
  "Blocking GPTBot or ClaudeBot in robots.txt prevents AI engines from referencing your real-time content.",
  "AI Search visibility is driven by factual clarity, entity co-occurrence, and competitor share of voice.",
  "Top-ranking brands in AI search maintain an average mention position under rank #2.5.",
];

export default function GraderLandingPage() {
  const router = useRouter();

  // Form State
  const [brandName, setBrandName] = useState("");
  const [domain, setDomain] = useState("");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("US");
  const [competitors, setCompetitors] = useState<CompetitorField[]>([]);
  const [newCompName, setNewCompName] = useState("");
  const [newCompDomain, setNewCompDomain] = useState("");

  // Execution State
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<{
    shareToken: string;
    progress: number;
    currentStage: string;
    startedAt: number;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [tipIndex, setTipIndex] = useState(0);

  // Timer for elapsed seconds and rotating tips during execution
  useEffect(() => {
    if (!activeJob) return;

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    const tipTimer = setInterval(() => {
      setTipIndex((prev) => (prev + 1) % ROTATING_TIPS.length);
    }, 4500);

    return () => {
      clearInterval(timer);
      clearInterval(tipTimer);
    };
  }, [activeJob]);

  const elapsedSeconds = activeJob
    ? Math.max(0, Math.floor((now - activeJob.startedAt) / 1000))
    : 0;

  // Poller effect when activeJob is set
  const pollingRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!activeJob) return;

    const poll = async () => {
      try {
        const report = await api.request<GraderReportData>(
          `/v1/grader/reports/${activeJob.shareToken}`,
          { auth: false },
        );

        if (report.status === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          router.push(`/grader/${report.shareToken}`);
          return;
        }

        if (report.status === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setError("Audit execution failed. Please check the domain and try again.");
          setActiveJob(null);
          setLoading(false);
          return;
        }

        // Update progress
        setActiveJob((prev) =>
          prev
            ? {
                ...prev,
                progress: Math.max(prev.progress, report.progress || 10),
                currentStage: report.currentStage || prev.currentStage,
              }
            : null,
        );
      } catch {
        // Polling error (transient)
      }
    };

    pollingRef.current = setInterval(poll, 2000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [activeJob, router]);

  const handleAddCompetitor = () => {
    if (!newCompName.trim() || !newCompDomain.trim()) return;
    if (competitors.length >= 3) return;

    setCompetitors([
      ...competitors,
      { name: newCompName.trim(), domain: newCompDomain.trim().toLowerCase() },
    ]);
    setNewCompName("");
    setNewCompDomain("");
  };

  const handleRemoveCompetitor = (idx: number) => {
    setCompetitors(competitors.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!brandName.trim()) {
      setError("Please enter your brand name.");
      return;
    }
    if (!domain.trim()) {
      setError("Please enter your website domain.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await api.request<SubmitGraderResponse>("/v1/grader/submit", {
        method: "POST",
        body: {
          brandName: brandName.trim(),
          domain: domain.trim(),
          category: category.trim() || undefined,
          country,
          competitors: competitors.slice(0, 3),
        },
        auth: false,
      });

      if (response.isCached || response.status === "completed") {
        // Cached report ready immediately
        router.push(`/grader/${response.shareToken}`);
      } else {
        // Live job initiated
        setActiveJob({
          shareToken: response.shareToken,
          progress: response.progress || 10,
          currentStage: response.currentStage || "Domain Architecture & Extraction",
          startedAt: Date.now(),
        });
      }
    } catch (err) {
      setLoading(false);
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Failed to start AI audit. Please check your domain and try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
      {/* Top Navigation */}
      <header className="border-b border-border/60 bg-background/80 backdrop-blur sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
            <span className="w-6 h-6 rounded-lg bg-primary text-primary-foreground flex items-center justify-center font-black text-xs">
              S
            </span>
            <span>savoir</span>
            <span className="text-primary font-bold">.</span>
          </Link>

          <div className="flex items-center gap-3">
            <span className="hidden sm:inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
              <Sparkles className="w-3.5 h-3.5" /> Free AI Search Grader
            </span>
            <Link
              href="/login"
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              Sign In
            </Link>
            <Link
              href="/onboarding"
              className="text-xs font-semibold px-3.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-sm"
            >
              Start Monitoring
            </Link>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 py-12 md:py-16">
        {activeJob ? (
          /* LIVE EXECUTION OVERLAY (HG-09, HG-FR-004) */
          <div className="p-8 md:p-12 rounded-3xl border border-border bg-card shadow-lg space-y-8 animate-in fade-in">
            <div className="text-center space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold border border-primary/20">
                <LoaderCircle className="w-3.5 h-3.5 animate-spin" />
                Live Multi-Engine Analysis
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight text-foreground">
                Auditing {brandName} in Real-Time
              </h2>
              <p className="text-xs md:text-sm text-muted-foreground max-w-lg mx-auto">
                Running 12–15 discovery and comparison queries across ChatGPT & Gemini. This takes 60–90 seconds.
              </p>
            </div>

            {/* Progress Bar & Percentage */}
            <div className="space-y-2 max-w-xl mx-auto">
              <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                <span className="text-foreground">{activeJob.currentStage}</span>
                <span>{Math.round(activeJob.progress)}% • {elapsedSeconds}s elapsed</span>
              </div>
              <div className="h-3 w-full rounded-full bg-muted overflow-hidden border border-border">
                <div
                  className="h-full bg-gradient-to-r from-primary to-blue-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(activeJob.progress, 5)}%` }}
                />
              </div>
            </div>

            {/* Stages checklist */}
            <div className="space-y-3 max-w-xl mx-auto pt-2">
              {STAGES.map((s) => {
                const isComplete = activeJob.progress > s.pct;
                const isCurrent = activeJob.progress <= s.pct && activeJob.progress > s.pct - 25;
                return (
                  <div
                    key={s.id}
                    className={`p-3 rounded-xl border flex items-start gap-3 transition-colors ${
                      isComplete
                        ? "border-emerald-500/20 bg-emerald-500/5"
                        : isCurrent
                        ? "border-primary/40 bg-primary/5 shadow-sm"
                        : "border-border/60 bg-muted/20 opacity-60"
                    }`}
                  >
                    <div className="mt-0.5">
                      {isComplete ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : isCurrent ? (
                        <LoaderCircle className="w-4 h-4 text-primary animate-spin shrink-0" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-border shrink-0" />
                      )}
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-foreground flex items-center gap-2">
                        <span>{s.name}</span>
                        {isCurrent && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-primary text-primary-foreground">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{s.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rotating Tips Box */}
            <div className="max-w-xl mx-auto p-4 rounded-xl bg-muted/40 border border-border text-center text-xs text-muted-foreground animate-in fade-in">
              <span className="font-semibold text-foreground">AI Search Insight: </span>
              {ROTATING_TIPS[tipIndex]}
            </div>
          </div>
        ) : (
          /* LANDING PAGE HERO & SUBMISSION FORM (HG-01 to HG-04) */
          <div className="space-y-10">
            {/* Hero Header */}
            <div className="text-center space-y-3">
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                <Sparkles className="w-3.5 h-3.5" /> Instant AI Search Visibility Report
              </div>
              <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight text-foreground">
                How does AI describe your brand?
              </h1>
              <p className="text-sm md:text-base text-muted-foreground max-w-2xl mx-auto">
                Get an instant, multi-engine audit of your brand&apos;s visibility, citations, crawler permissions, and competitor share of voice across ChatGPT and Google Gemini.
              </p>
            </div>

            {/* Audit Form Card */}
            <div className="p-6 md:p-8 rounded-3xl border border-border bg-card shadow-lg">
              {error && (
                <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  {/* Brand Name */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Brand Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={brandName}
                      onChange={(e) => setBrandName(e.target.value)}
                      placeholder="e.g. Acme Corp"
                      className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Domain */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Website Domain <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={domain}
                      onChange={(e) => setDomain(e.target.value)}
                      placeholder="e.g. acme.com"
                      className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Category */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">
                      Industry or Category (Optional)
                    </label>
                    <input
                      type="text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g. B2B Project Management, CRM, Fintech"
                      className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  {/* Country */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-foreground">Search Market / Country</label>
                    <select
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      <option value="US">United States (US)</option>
                      <option value="GB">United Kingdom (GB)</option>
                      <option value="CA">Canada (CA)</option>
                      <option value="AU">Australia (AU)</option>
                      <option value="DE">Germany (DE)</option>
                      <option value="FR">France (FR)</option>
                    </select>
                  </div>
                </div>

                {/* Optional Competitors Section */}
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold text-foreground">
                        Track Competitors (Optional, up to 3)
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Benchmark head-to-head mentions and share of voice against your key rivals.
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{competitors.length}/3 added</span>
                  </div>

                  {competitors.length > 0 && (
                    <div className="space-y-2">
                      {competitors.map((c, i) => (
                        <div
                          key={i}
                          className="p-2.5 rounded-xl border border-border bg-muted/30 flex items-center justify-between text-xs"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-foreground">{c.name}</span>
                            <span className="text-muted-foreground">({c.domain})</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveCompetitor(i)}
                            className="p-1 rounded text-muted-foreground hover:text-rose-500 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {competitors.length < 3 && (
                    <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                      <input
                        type="text"
                        value={newCompName}
                        onChange={(e) => setNewCompName(e.target.value)}
                        placeholder="Competitor Name (e.g. Asana)"
                        className="flex-1 w-full px-3.5 py-2 rounded-xl border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <input
                        type="text"
                        value={newCompDomain}
                        onChange={(e) => setNewCompDomain(e.target.value)}
                        placeholder="Domain (e.g. asana.com)"
                        className="flex-1 w-full px-3.5 py-2 rounded-xl border border-border bg-background text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                      />
                      <button
                        type="button"
                        onClick={handleAddCompetitor}
                        disabled={!newCompName.trim() || !newCompDomain.trim()}
                        className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-border bg-muted/60 hover:bg-muted text-xs font-semibold text-foreground transition-colors disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Add</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Submit CTA */}
                <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Free audit • No credit card required • Instant results</span>
                  </div>

                  <button
                    type="submit"
                    disabled={loading || !brandName.trim() || !domain.trim()}
                    className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-bold shadow-md transition-all disabled:opacity-50"
                  >
                    {loading ? (
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4 text-primary-foreground" />
                    )}
                    <span>Run Free AI Audit</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>

            {/* Feature Highlights Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-6">
              <div className="p-5 rounded-2xl border border-border bg-card/60 space-y-2">
                <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Bot className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Multi-Engine AI Testing</h3>
                <p className="text-xs text-muted-foreground">
                  Samples responses from OpenAI ChatGPT with web browsing and Google Gemini to evaluate real consumer query results.
                </p>
              </div>

              <div className="p-5 rounded-2xl border border-border bg-card/60 space-y-2">
                <div className="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                  <Globe className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Technical AEO Audit</h3>
                <p className="text-xs text-muted-foreground">
                  Validates crawler directives in robots.txt for GPTBot and ClaudeBot, checks llms.txt discovery files, and inspects Schema.org markup.
                </p>
              </div>

              <div className="p-5 rounded-2xl border border-border bg-card/60 space-y-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-foreground">Prioritized Action Plan</h3>
                <p className="text-xs text-muted-foreground">
                  Delivers actionable recommendations tagged by effort and business impact to maximize model recall and citation share.
                </p>
              </div>
            </div>
          </div>
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
            <Link href="/login" className="hover:text-foreground transition-colors">
              Sign In
            </Link>
            <Link href="/signup" className="hover:text-foreground transition-colors">
              Create Account
            </Link>
            <Link href="/onboarding" className="hover:text-foreground transition-colors">
              Continuous Monitoring
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
