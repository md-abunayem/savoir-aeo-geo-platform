"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Award,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Download,
  Globe,
  Info,
  RefreshCw,
  Rocket,
  Search,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import type { GraderReportData, GradeLetter } from "../lib/types";

const GRADE_STYLES: Record<GradeLetter, { bg: string; text: string; border: string; desc: string }> = {
  A: { bg: "rgba(16, 185, 129, 0.12)", text: "#10b981", border: "rgba(16, 185, 129, 0.4)", desc: "Leader (85-100)" },
  B: { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.4)", desc: "Strong (70-84)" },
  C: { bg: "rgba(245, 158, 11, 0.12)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.4)", desc: "Moderate (55-69)" },
  D: { bg: "rgba(249, 115, 22, 0.12)", text: "#f97316", border: "rgba(249, 115, 22, 0.4)", desc: "At Risk (40-54)" },
  F: { bg: "rgba(239, 68, 68, 0.12)", text: "#ef4444", border: "rgba(239, 68, 68, 0.4)", desc: "Low Visibility (<40)" },
};

const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  Critical: { bg: "rgba(239, 68, 68, 0.1)", text: "#ef4444", border: "rgba(239, 68, 68, 0.3)" },
  High: { bg: "rgba(249, 115, 22, 0.1)", text: "#f97316", border: "rgba(249, 115, 22, 0.3)" },
  Medium: { bg: "rgba(59, 130, 246, 0.1)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.3)" },
};

export interface GraderReportProps {
  report: GraderReportData;
  shareUrl?: string;
  onConvert?: () => void;
  converting?: boolean;
  onOpenEmailModal?: () => void;
  onRerun?: () => void;
  rerunning?: boolean;
}

export function GraderReport({
  report,
  shareUrl,
  onConvert,
  converting = false,
  onOpenEmailModal,
  onRerun,
  rerunning = false,
}: GraderReportProps) {
  const [copied, setCopied] = useState(false);
  const [showFormula, setShowFormula] = useState(false);
  const [selectedIntentFilter, setSelectedIntentFilter] = useState<string>("all");
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  const gradeInfo = GRADE_STYLES[report.grade] || GRADE_STYLES.F;

  const handleCopyLink = async () => {
    try {
      const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
      if (url) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }
    } catch {
      // ignore clipboard error
    }
  };

  const filteredPrompts = report.prompts.filter((p) => {
    if (selectedIntentFilter === "all") return true;
    return p.intent === selectedIntentFilter;
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto pb-16">
      {/* 1. TOP HEADER BANNER */}
      <div className="rounded-2xl border border-border bg-card p-6 md:p-8 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div className="flex items-start gap-5">
            {/* Big Grade Badge */}
            <div
              className="flex flex-col items-center justify-center w-24 h-24 rounded-2xl border-2 shrink-0 shadow-inner"
              style={{
                backgroundColor: gradeInfo.bg,
                borderColor: gradeInfo.border,
                color: gradeInfo.text,
              }}
            >
              <span className="text-4xl font-extrabold tracking-tight">{report.grade}</span>
              <span className="text-xs font-semibold uppercase tracking-wider mt-0.5">
                {report.score}/100
              </span>
            </div>

            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20">
                  AI Search Audit
                </span>
                {report.isCached && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Cached (7d)
                  </span>
                )}
                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                  {report.country} • {report.language.toUpperCase()}
                </span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                  Observed
                </span>
              </div>

              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                {report.brandName}
                <span className="text-base font-normal text-muted-foreground">({report.normalizedDomain})</span>
              </h1>

              <p className="text-sm text-muted-foreground mt-1">
                Category: <strong className="text-foreground">{report.category}</strong>
                {report.competitors.length > 0 && (
                  <>
                    {" "}• Benchmarked against:{" "}
                    <span className="text-foreground font-medium">
                      {report.competitors.map((c) => c.name).join(", ")}
                    </span>
                  </>
                )}
              </p>

              <div className="flex items-center gap-4 text-xs text-muted-foreground mt-2">
                <span>Audited: {new Date(report.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}</span>
                <span>•</span>
                <span>Valid for 30 days</span>
              </div>
            </div>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-3">
            <button
              type="button"
              onClick={handleCopyLink}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors"
              title="Copy shareable link"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="text-emerald-600">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Share</span>
                </>
              )}
            </button>

            {onOpenEmailModal && (
              <button
                type="button"
                onClick={onOpenEmailModal}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors"
                title="Email or download report PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>PDF Report</span>
              </button>
            )}

            {onRerun && (
              <button
                type="button"
                onClick={onRerun}
                disabled={rerunning}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-background hover:bg-muted text-xs font-medium text-foreground transition-colors disabled:opacity-50"
                title="Force refresh analysis"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${rerunning ? "animate-spin" : ""}`} />
                <span>Rerun</span>
              </button>
            )}

            {onConvert && (
              <button
                type="button"
                onClick={onConvert}
                disabled={converting}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
              >
                {converting ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5 text-primary-foreground" />
                )}
                <span>Convert to Project</span>
              </button>
            )}
          </div>
        </div>

        {/* Formula disclosure button */}
        <div className="mt-5 pt-4 border-t border-border flex flex-col md:flex-row md:items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Award className="w-4 h-4 text-primary shrink-0" />
            <span>Grade band: <strong>{gradeInfo.desc}</strong> based on normative AI Visibility weights.</span>
          </div>
          <button
            type="button"
            onClick={() => setShowFormula(!showFormula)}
            className="inline-flex items-center gap-1 text-primary hover:underline font-medium text-xs self-start md:self-auto"
          >
            <span>{showFormula ? "Hide calculation formula" : "View calculation formula"}</span>
            {showFormula ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Formula drawer */}
        {showFormula && (
          <div className="mt-4 p-4 rounded-xl bg-muted/60 border border-border text-xs text-foreground space-y-2 animate-in fade-in duration-200">
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Info className="w-4 h-4 text-primary" />
              M3 / HG-FR-002 Normative AI Visibility Score Formula:
            </div>
            <code className="block p-3 rounded-lg bg-background border border-border font-mono text-xs text-primary overflow-x-auto">
              Grade = 100 × [ 0.45 × V + 0.20 × min(1, SoV / FairShare) + 0.15 × PositionScore + 0.10 × SentimentScore + 0.10 × CitationRate ]
            </code>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-muted-foreground pt-1">
              <li>• <strong>V (45%):</strong> AI Visibility Rate across all queries</li>
              <li>• <strong>SoV / FairShare (20%):</strong> Share of Voice vs fair competitive share</li>
              <li>• <strong>PositionScore (15%):</strong> Mean reciprocal rank (1/rank) for mentions</li>
              <li>• <strong>SentimentScore (10%):</strong> Positive vs negative mentions sentiment</li>
              <li>• <strong>CitationRate (10%):</strong> Proportion of answers citing your domain</li>
            </ul>
          </div>
        )}
      </div>

      {/* 2. 5 CORE METRIC KPI CARDS (HG-11 to HG-13) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Metric 1: Visibility Rate */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">AI Visibility Rate</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                Observed
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {Math.round(report.metrics.visibilityRate * 100)}%
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            {report.prompts.filter((p) => p.brandMentioned).length} of {report.prompts.length} queries mentioned {report.brandName}
          </div>
        </div>

        {/* Metric 2: Share of Voice */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">Share of Voice</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600">
                Observed
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {Math.round(report.metrics.shareOfVoice * 100)}%
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border flex items-center justify-between">
            <span>Fair Share: {Math.round(report.metrics.fairShare * 100)}%</span>
            {report.metrics.shareOfVoice >= report.metrics.fairShare ? (
              <span className="text-emerald-600 font-medium">Above Fair</span>
            ) : (
              <span className="text-amber-600 font-medium">Below Fair</span>
            )}
          </div>
        </div>

        {/* Metric 3: Mention Position */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">Avg Position Rank</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                Observed
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {report.metrics.avgPosition > 0 ? `#${report.metrics.avgPosition.toFixed(1)}` : "—"}
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            Position score: {Math.round(report.metrics.positionScore * 100)}% (1/rank)
          </div>
        </div>

        {/* Metric 4: Sentiment */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">Sentiment Score</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">
                Estimated
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {Math.round(report.metrics.sentimentScore * 100)}%
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            {report.metrics.sentimentScore >= 0.65 ? (
              <span className="text-emerald-600 font-medium">Net Positive</span>
            ) : report.metrics.sentimentScore >= 0.45 ? (
              <span className="text-foreground font-medium">Net Neutral</span>
            ) : (
              <span className="text-rose-600 font-medium">Net Negative</span>
            )}
          </div>
        </div>

        {/* Metric 5: Citation Score */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span className="font-medium">Domain Citation Rate</span>
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600">
                Observed
              </span>
            </div>
            <div className="text-2xl font-bold text-foreground">
              {Math.round(report.metrics.citationScore * 100)}%
            </div>
          </div>
          <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-border">
            {Math.round(report.metrics.citationScore * 100)}% of queries cite {report.normalizedDomain}
          </div>
        </div>
      </div>

      {/* Engine Breakdown Strip */}
      {report.metrics.engineScores && Object.keys(report.metrics.engineScores).length > 0 && (
        <div className="p-4 rounded-xl border border-border bg-card flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-foreground">
            <Bot className="w-4 h-4 text-primary" />
            <span>AI Search Engine Visibility Breakdown:</span>
          </div>
          <div className="flex items-center gap-6">
            {Object.entries(report.metrics.engineScores).map(([eng, score]) => (
              <div key={eng} className="flex items-center gap-2 text-xs">
                <span className="capitalize font-medium text-muted-foreground">
                  {eng === "openai" ? "ChatGPT (Web)" : eng === "gemini" ? "Google Gemini" : eng}:
                </span>
                <span className="font-bold text-foreground">{Math.round(score * 100)}%</span>
                <div className="w-16 h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.round(score * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. TWO COLUMN: BRAND PERCEPTION & TECHNICAL AUDIT */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Brand Perception Summary (HG-14, HG-15) */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">AI Brand Perception Summary</h2>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20">
              Estimated
            </span>
          </div>

          <p className="text-xs text-muted-foreground leading-relaxed">
            How leading AI engines perceive and summarize {report.brandName}&apos;s identity and market position:
          </p>

          {/* Positioning */}
          {report.brandPerception.positioning && (
            <div className="p-3 rounded-xl bg-muted/50 border border-border">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                Market Positioning Statement
              </div>
              <p className="text-xs text-foreground font-medium italic">
                &ldquo;{report.brandPerception.positioning}&rdquo;
              </p>
            </div>
          )}

          {/* Key Descriptors */}
          {report.brandPerception.descriptors.length > 0 && (
            <div>
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                Key Perceived Descriptors
              </div>
              <div className="flex flex-wrap gap-1.5">
                {report.brandPerception.descriptors.map((d, i) => (
                  <span
                    key={i}
                    className="text-xs px-2.5 py-1 rounded-lg bg-background border border-border text-foreground font-medium"
                  >
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Strengths Highlighted
              </div>
              <ul className="space-y-1.5">
                {report.brandPerception.strengths.slice(0, 4).map((s, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-emerald-500 font-bold shrink-0">•</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Gaps & Blindspots
              </div>
              <ul className="space-y-1.5">
                {report.brandPerception.weaknesses.slice(0, 4).map((w, i) => (
                  <li key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                    <span className="text-amber-500 font-bold shrink-0">•</span>
                    <span>{w}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Inaccuracies / Hallucinations flagged */}
          {report.brandPerception.inaccuracies.length > 0 && (
            <div className="mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-foreground space-y-1.5">
              <div className="font-semibold text-rose-600 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" /> Flagged Potential Inaccuracies in AI Answers
              </div>
              {report.brandPerception.inaccuracies.map((item, idx) => (
                <div key={idx} className="space-y-0.5">
                  <div className="font-medium text-foreground">&bull; &ldquo;{item.claim}&rdquo;</div>
                  <div className="text-muted-foreground pl-3 text-[11px]">{item.explanation}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right: Technical AEO Audit (HG-17) */}
        <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Technical AEO Readiness Audit</h2>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
              Observed
            </span>
          </div>

          <p className="text-xs text-muted-foreground">
            Direct inspection of {report.normalizedDomain}&apos;s crawler directives, machine-readable specifications, and schema:
          </p>

          {/* 3 Core indicators */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-xl bg-muted/40 border border-border">
              <div className="text-[11px] text-muted-foreground mb-1">Status Code</div>
              <div className="text-sm font-bold text-foreground">
                {report.technicalAudit.statusCode || 200} OK
              </div>
            </div>

            <div className="p-3 rounded-xl bg-muted/40 border border-border">
              <div className="text-[11px] text-muted-foreground mb-1">llms.txt File</div>
              <div className={`text-sm font-bold ${report.technicalAudit.llmsTxt ? "text-emerald-600" : "text-amber-600"}`}>
                {report.technicalAudit.llmsTxt ? "Present" : "Missing"}
              </div>
            </div>

            <div className="p-3 rounded-xl bg-muted/40 border border-border">
              <div className="text-[11px] text-muted-foreground mb-1">Schema.org</div>
              <div className={`text-sm font-bold ${report.technicalAudit.schemaOrg ? "text-emerald-600" : "text-amber-600"}`}>
                {report.technicalAudit.schemaOrg ? "Detected" : "Not Found"}
              </div>
            </div>
          </div>

          {/* AI Crawler Permissions in robots.txt */}
          <div className="pt-2">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Robots.txt AI Crawler Permissions
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              {report.technicalAudit.robotsTxt?.bots &&
                Object.entries(report.technicalAudit.robotsTxt.bots).map(([bot, status]) => {
                  const allowed = status === "allowed";
                  return (
                    <div
                      key={bot}
                      className="p-2.5 rounded-lg border border-border bg-background flex items-center justify-between"
                    >
                      <span className="font-medium text-foreground">{bot}</span>
                      <span
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                          allowed
                            ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                            : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                        }`}
                      >
                        {allowed ? "Allowed" : "Disallowed"}
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>

          {/* Audit Notes */}
          {report.technicalAudit.notes && report.technicalAudit.notes.length > 0 && (
            <div className="pt-2 space-y-1">
              <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Audit Notes & Observations
              </div>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {report.technicalAudit.notes.map((note, i) => (
                  <li key={i} className="flex items-start gap-1.5">
                    <span className="text-primary font-bold">&bull;</span>
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* 4. PRIORITIZED RECOMMENDATIONS (HG-18) */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Rocket className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-bold text-foreground">Prioritized Action Plan for {report.brandName}</h2>
          </div>
          <span className="text-xs text-muted-foreground">
            {report.recommendations.length} Actionable Recommendations
          </span>
        </div>

        <p className="text-xs text-muted-foreground">
          Key high-impact optimizations to maximize AI search citations, model recall, and brand positioning:
        </p>

        <div className="space-y-3 pt-2">
          {report.recommendations.map((rec, index) => {
            const impactStyle = IMPACT_COLORS[rec.impact] || IMPACT_COLORS.Medium;
            return (
              <div
                key={rec.id || index}
                className="p-4 rounded-xl border border-border bg-background hover:border-primary/40 transition-colors space-y-2"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-primary/10 text-primary font-bold text-xs flex items-center justify-center shrink-0">
                      {index + 1}
                    </span>
                    <h3 className="text-sm font-semibold text-foreground">{rec.title}</h3>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: impactStyle.bg,
                        borderColor: impactStyle.border,
                        color: impactStyle.text,
                      }}
                    >
                      Impact: {rec.impact}
                    </span>
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                      Effort: {rec.effort}
                    </span>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground pl-8">{rec.description}</p>

                {rec.actionableStep && (
                  <div className="ml-8 mt-2 p-2.5 rounded-lg bg-muted/60 border border-border text-xs text-foreground flex items-start gap-2">
                    <span className="font-semibold text-primary shrink-0">Action:</span>
                    <span>{rec.actionableStep}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5. SAMPLE AI ANSWERS EXPLORER (HG-19) */}
      <div className="p-6 rounded-2xl border border-border bg-card shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Sample AI Search Answers ({report.prompts.length} queries)</h2>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Explore prompt responses across consumer search intents:
            </p>
          </div>

          {/* Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { id: "all", label: "All Intents" },
              { id: "category_discovery", label: "Category Discovery" },
              { id: "best_of", label: "Best-Of Lists" },
              { id: "comparison", label: "Comparisons" },
              { id: "problem_solution", label: "Problem-Solution" },
              { id: "brand_specific", label: "Brand Specific" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setSelectedIntentFilter(f.id)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border font-medium transition-colors ${
                  selectedIntentFilter === f.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Prompt List */}
        <div className="space-y-3 pt-2">
          {filteredPrompts.map((p) => {
            const isExpanded = expandedPromptId === p.id;
            return (
              <div
                key={p.id}
                className="rounded-xl border border-border bg-background overflow-hidden transition-all"
              >
                <button
                  type="button"
                  onClick={() => setExpandedPromptId(isExpanded ? null : p.id)}
                  className="w-full text-left p-4 flex items-center justify-between gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                        {p.intent.replace(/_/g, " ")}
                      </span>
                      {p.brandMentioned ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          Rank #{p.brandRank || 1} Mentioned
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                          Not Mentioned
                        </span>
                      )}
                    </div>
                    <div className="text-sm font-medium text-foreground">&ldquo;{p.text}&rdquo;</div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                    <span>{p.sampleAnswers.length} samples</span>
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </div>
                </button>

                {/* Expanded Answer Snippets */}
                {isExpanded && (
                  <div className="p-4 pt-2 border-t border-border bg-muted/20 space-y-3">
                    {p.sampleAnswers.map((ans, aIdx) => (
                      <div
                        key={aIdx}
                        className="p-3 rounded-lg border border-border bg-card space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-primary capitalize">
                            Engine: {ans.engine === "openai" ? "ChatGPT" : ans.engine === "gemini" ? "Google Gemini" : ans.engine}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">
                              Rank: {ans.brandRank ? `#${ans.brandRank}` : "N/A"}
                            </span>
                            <span className="text-muted-foreground">
                              Sentiment: {ans.sentiment > 0 ? "Positive" : ans.sentiment < 0 ? "Negative" : "Neutral"}
                            </span>
                          </div>
                        </div>

                        <p className="text-foreground leading-relaxed italic bg-muted/40 p-2.5 rounded-lg border border-border/50">
                          &ldquo;{ans.textSnippet}&rdquo;
                        </p>

                        {ans.citations && ans.citations.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <span className="text-[10px] font-semibold text-muted-foreground">Cited:</span>
                            {ans.citations.map((cite, cIdx) => (
                              <span
                                key={cIdx}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border"
                              >
                                {cite}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. METHODOLOGY & LIMITATIONS (HG-20) */}
      <div className="p-5 rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground space-y-2">
        <div className="font-semibold text-foreground flex items-center gap-1.5">
          <Info className="w-4 h-4 text-primary" />
          Methodology & Audit Transparency
        </div>
        <p>
          This audit is generated by running controlled API queries across official developer surfaces of OpenAI ChatGPT (with real-time web search tool enabled) and Google Gemini in market <strong>{report.country}</strong>. Results reflect live retrieval and generation at audit time. Consumer web chat results may differ slightly due to user personalization, browser localization, and model iteration.
        </p>
      </div>

      {/* 7. BOTTOM CONVERSION CTA BANNER (HG-24) */}
      <div className="p-8 rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1 text-center md:text-left">
          <h3 className="text-xl font-bold text-foreground">
            Track {report.brandName} Daily Across AI Engines
          </h3>
          <p className="text-xs text-muted-foreground max-w-xl">
            Upgrade this one-time free snapshot into 24/7 continuous monitoring. Automatically import your seed prompts, competitors, and baseline score into Savoir.
          </p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {onConvert ? (
            <button
              type="button"
              onClick={onConvert}
              disabled={converting}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow transition-all disabled:opacity-50"
            >
              {converting ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4 text-primary-foreground" />
              )}
              <span>Convert to Monitored Project</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <Link
              href={`/onboarding?fromGrader=${report.shareToken}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold shadow transition-all"
            >
              <Sparkles className="w-4 h-4 text-primary-foreground" />
              <span>Convert to Monitored Project</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
