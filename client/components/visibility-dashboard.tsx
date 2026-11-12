"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Download,
  Layers,
  LoaderCircle,
  Sparkles,
  Target,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  Project,
  VisibilityOverviewResponse,
  TrendPointItem,
  TrendEventItem,
  AnomalyItem,
  GradeBand,
} from "../lib/types";

const GRADE_COLORS: Record<GradeBand, { bg: string; text: string; border: string; desc: string }> = {
  A: { bg: "var(--visibility-grade-a-bg)", text: "var(--visibility-grade-a-text)", border: "var(--visibility-grade-a-border)", desc: "Leader (85-100)" },
  B: { bg: "var(--visibility-grade-b-bg)", text: "var(--visibility-grade-b-text)", border: "var(--visibility-grade-b-border)", desc: "Strong (70-84)" },
  C: { bg: "var(--visibility-grade-c-bg)", text: "var(--visibility-grade-c-text)", border: "var(--visibility-grade-c-border)", desc: "Moderate (55-69)" },
  D: { bg: "var(--visibility-grade-d-bg)", text: "var(--visibility-grade-d-text)", border: "var(--visibility-grade-d-border)", desc: "At Risk (40-54)" },
  F: { bg: "var(--visibility-grade-f-bg)", text: "var(--visibility-grade-f-text)", border: "var(--visibility-grade-f-border)", desc: "Low Visibility (<40)" },
};

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  Observed: { bg: "var(--visibility-observed-bg)", text: "var(--visibility-observed-text)" },
  Modeled: { bg: "var(--visibility-modeled-bg)", text: "var(--visibility-modeled-text)" },
  Estimated: { bg: "var(--visibility-estimated-bg)", text: "var(--visibility-estimated-text)" },
};

export function VisibilityDashboard({ project }: { project: Project }) {
  const [overview, setOverview] = useState<VisibilityOverviewResponse | null>(null);
  const [trendPoints, setTrendPoints] = useState<TrendPointItem[]>([]);
  const [trendEvents, setTrendEvents] = useState<TrendEventItem[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [days, setDays] = useState<number>(7);
  const [engine, setEngine] = useState<string>("all");
  const [smoothRolling, setSmoothRolling] = useState<boolean>(true);
  const [, startTransition] = useTransition();

  // Metric Goal modal
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [goalTarget, setGoalTarget] = useState("85");
  const [goalDeadline, setGoalDeadline] = useState("");
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [goalNotice, setGoalNotice] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/visibility`;
        const params = new URLSearchParams({
          days: days.toString(),
          engine,
        });

        const [overviewRes, trendRes, anomaliesRes] = await Promise.all([
          api.request<VisibilityOverviewResponse>(
            `${basePath}?${params.toString()}`,
          ),
          api.request<{ points: TrendPointItem[]; events: TrendEventItem[] }>(
            `${basePath}/trend?${params.toString()}`,
          ),
          api.request<{ anomalies: AnomalyItem[] }>(
            `${basePath}/anomalies?${params.toString()}`,
          ),
        ]);

        if (!ignore) {
          setOverview(overviewRes);
          setTrendPoints(trendRes.points || []);
          setTrendEvents(trendRes.events || []);
          setAnomalies(anomaliesRes.anomalies || []);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load visibility analytics");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    }

    loadData();
    return () => {
      ignore = true;
    };
  }, [project.id, project.tenantId, days, engine]);

  async function handleExportCsv() {
    try {
      const url = `${process.env.NEXT_PUBLIC_API_URL || ""}/v1/tenants/${project.tenantId}/projects/${project.id}/visibility/export?days=${days}&engine=${engine}`;
      window.open(url, "_blank");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export CSV");
    }
  }

  async function handleCreateGoal(e: React.FormEvent) {
    e.preventDefault();
    setGoalSubmitting(true);
    setGoalNotice(null);
    try {
      await api.request(
        `/v1/tenants/${project.tenantId}/projects/${project.id}/visibility/goals`,
        {
          method: "POST",
          body: {
            metricName: "composite_score",
            targetValue: parseFloat(goalTarget),
            deadline: goalDeadline || null,
          },
        },
      );
      setGoalNotice("Metric goal created successfully!");
      setTimeout(() => {
        setShowGoalModal(false);
        setGoalNotice(null);
      }, 1500);
    } catch (err) {
      setGoalNotice(err instanceof Error ? err.message : "Failed to create metric goal");
    } finally {
      setGoalSubmitting(false);
    }
  }

  if (loading && !overview) {
    return (
      <div className="loading-state" role="status" style={{ padding: "4rem 2rem", textAlign: "center" }}>
        <LoaderCircle className="spin" size={32} style={{ margin: "0 auto 1rem", color: "var(--accent)" }} />
        <h3>Computing AI Visibility Metrics</h3>
        <p className="muted">Aggregating prompts, mention positions, sentiment, and Wilson confidence intervals…</p>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="error-banner" role="alert" style={{ margin: "2rem 0" }}>
        <AlertCircle size={20} />
        <div>
          <strong>Analytics Unavailable</strong>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const compGrade = overview.composite.grade;
  const gradeStyle = GRADE_COLORS[compGrade] || GRADE_COLORS.C;

  return (
    <div className="visibility-dashboard" style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
      {/* 1. Header Toolbar & Filters */}
      <div
        className="filter-bar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          background: "var(--card-bg, #ffffff)",
          padding: "1rem 1.25rem",
          borderRadius: "12px",
          border: "1px solid var(--border, #e5e7eb)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--muted)", textTransform: "uppercase" }}>
            Time Window:
          </span>
          {[
            { label: "7 Days", val: 7 },
            { label: "14 Days", val: 14 },
            { label: "30 Days", val: 30 },
            { label: "90 Days", val: 90 },
          ].map((item) => (
            <button
              key={item.val}
              className={`pill-button ${days === item.val ? "active" : ""}`}
              onClick={() => startTransition(() => setDays(item.val))}
              style={{
                padding: "0.35rem 0.75rem",
                borderRadius: "20px",
                border: "1px solid var(--border, #d1d5db)",
                background: days === item.val ? "var(--accent, #2563eb)" : "transparent",
                color: days === item.val ? "var(--brand-text)" : "var(--foreground)",
                fontWeight: 500,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <span style={{ color: "var(--muted)" }}>Engine:</span>
            <select
              value={engine}
              onChange={(e) => startTransition(() => setEngine(e.target.value))}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid var(--border, #d1d5db)",
                background: "transparent",
                fontSize: "0.875rem",
              }}
            >
              <option value="all">All Engines</option>
              <option value="openai">ChatGPT (OpenAI)</option>
              <option value="gemini">Google Gemini</option>
              <option value="google_ai_overviews">Google AI Overviews</option>
              <option value="google_ai_mode">Google AI Mode</option>
              <option value="openrouter">OpenRouter / GPT-6 Luna (web search)</option>
            </select>
          </label>

          <button
            className="button"
            onClick={handleExportCsv}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.4rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid var(--border, #d1d5db)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            <Download size={15} /> Export CSV
          </button>

          <button
            className="button primary"
            onClick={() => setShowGoalModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.4rem 0.85rem",
              borderRadius: "8px",
              background: "var(--accent, #2563eb)",
              color: "var(--brand-text)",
              border: "none",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            <Target size={15} /> Set Target
          </button>
        </div>
      </div>

      {/* 2. Composite AI Visibility Hero Card (VIS-FR-007) */}
      <section
        className="composite-hero-card"
        style={{
          background: "linear-gradient(135deg, rgba(37, 99, 235, 0.05) 0%, rgba(139, 92, 246, 0.05) 100%)",
          border: `1px solid ${gradeStyle.border}`,
          borderRadius: "16px",
          padding: "2rem",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: "2rem",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.75rem" }}>
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                padding: "0.2rem 0.5rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Modeled.bg,
                color: LABEL_COLORS.Modeled.text,
              }}
            >
              Modeled Metric
            </span>
            <span style={{ fontSize: "0.875rem", color: "var(--muted)" }}>
              SRS Section 9 Normative AI Visibility Score
            </span>
          </div>

          <h2 style={{ fontSize: "1.25rem", margin: 0, fontWeight: 600 }}>Composite AI Visibility Score</h2>

          <div style={{ display: "flex", alignItems: "baseline", gap: "1rem", marginTop: "0.75rem" }}>
            <span style={{ fontSize: "3.5rem", fontWeight: 800, letterSpacing: "-1px" }}>
              {overview.composite.score}
            </span>
            <span style={{ fontSize: "1.25rem", color: "var(--muted)", fontWeight: 500 }}>/ 100</span>

            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "48px",
                height: "48px",
                borderRadius: "12px",
                backgroundColor: gradeStyle.bg,
                color: gradeStyle.text,
                border: `2px solid ${gradeStyle.border}`,
                fontSize: "1.75rem",
                fontWeight: 800,
                marginLeft: "0.5rem",
              }}
            >
              {compGrade}
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginTop: "1rem" }}>
            {overview.composite.delta !== undefined && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.25rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  color: overview.composite.delta >= 0 ? "#10b981" : "#ef4444",
                }}
              >
                {overview.composite.delta >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                {overview.composite.delta >= 0 ? "+" : ""}
                {overview.composite.delta} pts vs previous {days}d
              </span>
            )}
            <span style={{ fontSize: "0.85rem", color: "var(--muted)" }}>Grade Band: {gradeStyle.desc}</span>
          </div>
        </div>

        {/* Formula Weights & FairShare Breakdown */}
        <div
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
            fontSize: "0.875rem",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: "0.75rem", display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Layers size={16} color="var(--accent)" />
            Normative Weighting Composition
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Visibility Rate (45%):</span>
              <strong>{(overview.metrics.visibilityRate.value * 100).toFixed(1)}%</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>
                Share of Voice vs FairShare (20%):
              </span>
              <strong>
                {(overview.metrics.shareOfVoice.value * 100).toFixed(1)}% / {(overview.composite.fairShare * 100).toFixed(0)}%
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Mention Position Rank (15%):</span>
              <strong>{(overview.metrics.positionScore.value * 100).toFixed(1)}%</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Sentiment Score (10%):</span>
              <strong>{(overview.metrics.sentimentScore.value * 100).toFixed(1)}%</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Brand Citation Rate (10%):</span>
              <strong>{(overview.metrics.citationRate.value * 100).toFixed(1)}%</strong>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Anomalies Alerts (VIS-FR-008) */}
      {anomalies.length > 0 && (
        <section
          className="anomalies-banner"
          style={{
            background: "var(--visibility-warning-bg)",
            border: "1px solid var(--visibility-warning-border)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <AlertTriangle size={18} color="var(--visibility-warning-text)" />
            <strong style={{ color: "var(--visibility-warning-text)" }}>
              Statistically Significant Shifts Detected ({anomalies.length})
            </strong>
            <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              FDR Benjamini-Hochberg controlled (q &lt; 0.05, two-proportion z-test)
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.75rem" }}>
            {anomalies.map((a) => (
              <div
                key={a.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: "var(--card-bg, #ffffff)",
                  padding: "0.6rem 1rem",
                  borderRadius: "8px",
                  fontSize: "0.875rem",
                  border: "1px solid var(--border, #e5e7eb)",
                }}
              >
                <div>
                  <strong>{a.entityName}</strong> on engine <code>{a.engine}</code> shifted by{" "}
                  <span style={{ color: a.delta > 0 ? "#10b981" : "#ef4444", fontWeight: 600 }}>
                    {a.delta > 0 ? "+" : ""}
                    {(a.delta * 100).toFixed(1)}%
                  </span>
                </div>
                <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                  p = {a.pValue.toFixed(4)} · q = {a.qValue?.toFixed(4) || "—"}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 4. KPI Grid: 6 Core Metrics Cards */}
      <div
        className="kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
          gap: "1.25rem",
        }}
      >
        {/* Visibility Rate */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Visibility Rate (V)</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {overview.metrics.visibilityRate.displayable
              ? `${(overview.metrics.visibilityRate.value * 100).toFixed(1)}%`
              : "Insufficient Data"}
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {overview.metrics.visibilityRate.ciLow !== undefined && (
              <span>
                95% Wilson CI: [{(overview.metrics.visibilityRate.ciLow * 100).toFixed(1)}%,{" "}
                {(overview.metrics.visibilityRate.ciHigh! * 100).toFixed(1)}%]
              </span>
            )}
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Runs: {overview.metrics.visibilityRate.n}</span>
            <span
              style={{
                color:
                  overview.metrics.visibilityRate.confidenceTier === "adequate"
                    ? "#10b981"
                    : "#f59e0b",
                fontWeight: 600,
              }}
            >
              {overview.metrics.visibilityRate.confidenceLabel}
            </span>
          </div>
        </div>

        {/* Share of Voice */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Share of Voice (SoV)</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Modeled.bg,
                color: LABEL_COLORS.Modeled.text,
              }}
            >
              Modeled
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {(overview.metrics.shareOfVoice.value * 100).toFixed(1)}%
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            FairShare Target: {(overview.composite.fairShare * 100).toFixed(0)}% (1 /{" "}
            {overview.competitors.length + 1} entities)
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>
              Ratio: {(overview.composite.sovRatio * 100).toFixed(0)}% of FairShare
            </span>
          </div>
        </div>

        {/* Mention Position Score */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Mention Position</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {(overview.metrics.positionScore.value * 100).toFixed(1)}%
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Reciprocal Rank Mean · n={overview.metrics.positionScore.n} mentions
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Threshold: n &ge; 5 rule</span>
            <span
              style={{
                color: overview.metrics.positionScore.confidenceTier === "adequate" ? "#10b981" : "#f59e0b",
                fontWeight: 600,
              }}
            >
              {overview.metrics.positionScore.confidenceLabel}
            </span>
          </div>
        </div>

        {/* Sentiment Score */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Sentiment Score</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Estimated.bg,
                color: LABEL_COLORS.Estimated.text,
              }}
            >
              Estimated
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {(overview.metrics.sentimentScore.value * 100).toFixed(1)}%
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Net Sentiment:{" "}
            <span
              style={{
                fontWeight: 600,
                color: overview.metrics.netSentiment.value >= 0 ? "#10b981" : "#ef4444",
              }}
            >
              {overview.metrics.netSentiment.value > 0 ? "+" : ""}
              {overview.metrics.netSentiment.value}%
            </span>
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Confidence &ge; 0.60 filter</span>
            <span style={{ color: "#10b981", fontWeight: 600 }}>Active</span>
          </div>
        </div>

        {/* Brand Citation Rate */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Citation Rate (CR)</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {(overview.metrics.citationRate.value * 100).toFixed(1)}%
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            {overview.metrics.citationRate.ciLow !== undefined ? (
              <span>
                95% Wilson CI: [{(overview.metrics.citationRate.ciLow * 100).toFixed(1)}%,{" "}
                {(overview.metrics.citationRate.ciHigh! * 100).toFixed(1)}%]
              </span>
            ) : (
              "—"
            )}
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>
              {overview.sampleSummary.brandCitedRuns} / {overview.sampleSummary.runsWithCitations} citation runs
            </span>
            <Link
              href="/answers?hasCitations=true"
              style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}
            >
              Drill down &rarr;
            </Link>
          </div>
        </div>

        {/* Recommended Rate */}
        <div
          className="panel kpi-card"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.25rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.875rem", fontWeight: 600 }}>Recommended Rate (R)</span>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Modeled.bg,
                color: LABEL_COLORS.Modeled.text,
              }}
            >
              Modeled
            </span>
          </div>

          <div style={{ fontSize: "2rem", fontWeight: 700, margin: "0.5rem 0" }}>
            {(overview.metrics.recommendedRate.value * 100).toFixed(1)}%
          </div>

          <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
            Top pick rate (Rank = 1 and Positive Sentiment)
          </div>

          <div style={{ marginTop: "0.75rem", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--muted)" }}>Sample: {overview.metrics.recommendedRate.n}</span>
            <span style={{ color: "#10b981", fontWeight: 600 }}>Active</span>
          </div>
        </div>
      </div>

      {/* 5. Trend Chart with 7-Day Rolling Smoothing (VIS-FR-010) */}
      <section
        className="panel trend-chart-section"
        style={{
          background: "var(--card-bg, #ffffff)",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: "12px",
          padding: "1.5rem",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 600 }}>
              Chronological Visibility Trajectory
            </h3>
            <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--muted)" }}>
              Daily observations and rolling trend smoothing over {days} days
            </p>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={smoothRolling}
              onChange={(e) => setSmoothRolling(e.target.checked)}
            />
            <span>Smooth with 7-Day Rolling Average</span>
          </label>
        </div>

        {trendPoints.length > 0 ? (
          <div style={{ position: "relative", width: "100%", height: "220px", marginTop: "1.5rem" }}>
            {/* SVG Trend Line */}
            <svg
              viewBox="0 0 800 200"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="visGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Grid horizontal lines */}
              <line x1="0" y1="40" x2="800" y2="40" stroke="var(--border, #e5e7eb)" strokeDasharray="4" />
              <line x1="0" y1="100" x2="800" y2="100" stroke="var(--border, #e5e7eb)" strokeDasharray="4" />
              <line x1="0" y1="160" x2="800" y2="160" stroke="var(--border, #e5e7eb)" strokeDasharray="4" />

              {/* Points calculation */}
              {(() => {
                const count = trendPoints.length;
                if (count === 1) {
                  const p = trendPoints[0];
                  const y = 180 - (smoothRolling && p.rollingAvg !== undefined ? p.rollingAvg : p.visibilityRate) * 160;
                  return <circle cx={400} cy={y} r={6} fill="var(--accent)" />;
                }

                const pts = trendPoints.map((p, idx) => {
                  const x = (idx / (count - 1)) * 800;
                  const v = smoothRolling && p.rollingAvg !== undefined ? p.rollingAvg : p.visibilityRate;
                  const y = 180 - Math.max(0, Math.min(1, v)) * 160;
                  return { x, y, p };
                });

                const lineD = pts.reduce((acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`, "");
                const areaD = `${lineD} L 800 180 L 0 180 Z`;

                return (
                  <>
                    <path d={areaD} fill="url(#visGrad)" />
                    <path d={lineD} fill="none" stroke="var(--accent)" strokeWidth="3" />
                    {pts.map((pt, i) => (
                      <g key={i}>
                        <circle cx={pt.x} cy={pt.y} r={4} fill="var(--accent)" stroke="var(--panel)" strokeWidth="2" />
                        <text
                          x={pt.x}
                          y={195}
                          textAnchor="middle"
                          fontSize="10"
                          fill="var(--muted, #6b7280)"
                        >
                          {pt.p.date.slice(5)}
                        </text>
                      </g>
                    ))}
                  </>
                );
              })()}
            </svg>
          </div>
        ) : (
          <div style={{ textAlign: "center", padding: "2rem", color: "var(--muted)" }}>
            No trend points available for this time window.
          </div>
        )}

        {/* Milestone Events Overlay */}
        {trendEvents.length > 0 && (
          <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border, #e5e7eb)", paddingTop: "1rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--muted)" }}>
              PROJECT MILESTONES &amp; SYSTEM EVENTS:
            </span>
            <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
              {trendEvents.map((evt, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    fontSize: "0.8rem",
                    background: "var(--visibility-event-bg)",
                    padding: "0.3rem 0.6rem",
                    borderRadius: "6px",
                  }}
                >
                  <Sparkles size={12} color="var(--accent)" />
                  <strong>{evt.date}:</strong> {evt.title}
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 6. Competitor Share of Voice & Engine Breakdown (2-Column Grid) */}
      <div
        className="breakdown-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
          gap: "1.5rem",
        }}
      >
        {/* Competitor SoV Comparison */}
        <section
          className="panel"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Share of Voice Comparison</h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                Brand vs Tracked Competitors
              </p>
            </div>
            <span
              style={{
                fontSize: "0.7rem",
                fontWeight: 700,
                padding: "0.15rem 0.4rem",
                borderRadius: "4px",
                backgroundColor: LABEL_COLORS.Modeled.bg,
                color: LABEL_COLORS.Modeled.text,
              }}
            >
              Modeled
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            {/* Brand Row */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                <strong>{overview.project.brandName} (Your Brand)</strong>
                <span style={{ fontWeight: 700, color: "var(--accent)" }}>
                  {(overview.metrics.shareOfVoice.value * 100).toFixed(1)}% SoV
                </span>
              </div>
              <div style={{ width: "100%", height: "8px", background: "var(--border, #e5e7eb)", borderRadius: "4px" }}>
                <div
                  style={{
                    width: `${Math.min(100, overview.metrics.shareOfVoice.value * 100)}%`,
                    height: "100%",
                    background: "var(--accent, #2563eb)",
                    borderRadius: "4px",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                <span>Visibility: {(overview.metrics.visibilityRate.value * 100).toFixed(1)}%</span>
                <span>{overview.sampleSummary.brandMentionedRuns} mentions</span>
              </div>
            </div>

            {/* Competitors Rows */}
            {overview.competitors.map((comp) => (
              <div key={comp.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.875rem", marginBottom: "0.25rem" }}>
                  <span>{comp.name}</span>
                  <span style={{ fontWeight: 600 }}>{(comp.shareOfVoice * 100).toFixed(1)}% SoV</span>
                </div>
                <div style={{ width: "100%", height: "8px", background: "var(--border, #e5e7eb)", borderRadius: "4px" }}>
                  <div
                    style={{
                      width: `${Math.min(100, comp.shareOfVoice * 100)}%`,
                      height: "100%",
                      background: "#9ca3af",
                      borderRadius: "4px",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.25rem" }}>
                  <span>Visibility: {(comp.visibilityRate * 100).toFixed(1)}%</span>
                  <span>{comp.mentionCount} mentions</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Engine Breakdown Comparison */}
        <section
          className="panel"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Engine Performance Matrix</h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                Visibility &amp; Score by AI Provider
              </p>
            </div>
            <Link href="/answers" style={{ fontSize: "0.8rem", color: "var(--accent)", textDecoration: "none" }}>
              Explore Answers &rarr;
            </Link>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            {overview.engines.map((eng) => (
              <div
                key={eng.engine}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0.75rem 1rem",
                  borderRadius: "8px",
                  background: "var(--bg, #f9fafb)",
                  border: "1px solid var(--border, #e5e7eb)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{eng.name}</div>
                  <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                    Visibility: {(eng.visibilityRate * 100).toFixed(1)}% · Citations: {(eng.citationRate * 100).toFixed(0)}% · n={eng.n}
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 700, fontSize: "1rem" }}>{eng.compositeScore}</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--muted)" }}>Score</div>
                  </div>

                  <span
                    style={{
                      display: "inline-block",
                      padding: "0.2rem 0.5rem",
                      borderRadius: "6px",
                      fontSize: "0.85rem",
                      fontWeight: 800,
                      backgroundColor: GRADE_COLORS[eng.grade]?.bg || "var(--soft)",
                      color: GRADE_COLORS[eng.grade]?.text || "var(--foreground)",
                    }}
                  >
                    {eng.grade}
                  </span>

                  <Link
                    href={`/answers?engine=${eng.engine}&brandMentioned=true`}
                    className="icon-button"
                    title={`Drill down to ${eng.name} answers`}
                    style={{ color: "var(--muted)" }}
                  >
                    <ChevronRight size={16} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 7. Top Monitored Prompts Breakdown */}
      {overview.prompts.length > 0 && (
        <section
          className="panel"
          style={{
            background: "var(--card-bg, #ffffff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: "12px",
            padding: "1.5rem",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 600 }}>Prompt Visibility Breakdown</h3>
              <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
                Performance across monitored buyer prompts
              </p>
            </div>
            <Link href="/prompts" style={{ fontSize: "0.8rem", color: "var(--accent)", textDecoration: "none" }}>
              Manage Prompts &rarr;
            </Link>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border, #e5e7eb)", textAlign: "left" }}>
                  <th style={{ padding: "0.6rem 0.5rem" }}>Prompt</th>
                  <th style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>Priority</th>
                  <th style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>Runs</th>
                  <th style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>Visibility</th>
                  <th style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>Avg Rank</th>
                  <th style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {overview.prompts.map((p) => (
                  <tr key={p.promptId} style={{ borderBottom: "1px solid var(--border, #f3f4f6)" }}>
                    <td style={{ padding: "0.6rem 0.5rem", maxWidth: "340px", wordBreak: "break-word" }}>
                      {p.text}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>
                      <span className="pill" style={{ fontSize: "0.75rem" }}>
                        P{p.priority}
                      </span>
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", color: "var(--muted)" }}>
                      {p.mentionedRuns}/{p.totalRuns}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "center", fontWeight: 600 }}>
                      {(p.visibilityRate * 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "center" }}>
                      {p.averageRank !== null ? `#${p.averageRank}` : "—"}
                    </td>
                    <td style={{ padding: "0.6rem 0.5rem", textAlign: "right" }}>
                      <Link
                        href={`/answers?promptId=${p.promptId}`}
                        style={{ color: "var(--accent)", fontSize: "0.8rem", textDecoration: "none" }}
                      >
                        Inspect answers
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Metric Goal Modal (VIS-FR-011) */}
      {showGoalModal && (
        <div
          className="modal-backdrop"
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            className="modal-content"
            style={{
              background: "var(--card-bg, #ffffff)",
              borderRadius: "16px",
              padding: "2rem",
              width: "100%",
              maxWidth: "420px",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1)",
            }}
          >
            <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.2rem", fontWeight: 700 }}>
              Set Visibility Target Goal
            </h3>
            <p style={{ margin: "0 0 1.5rem", fontSize: "0.875rem", color: "var(--muted)" }}>
              Define a KPI milestone for {overview.project.brandName} to track in executive reports.
            </p>

            <form onSubmit={handleCreateGoal} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                <span>Target Score (0-100):</span>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={goalTarget}
                  onChange={(e) => setGoalTarget(e.target.value)}
                  required
                  style={{
                    padding: "0.5rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border, #d1d5db)",
                  }}
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "0.25rem", fontSize: "0.875rem" }}>
                <span>Target Deadline (Optional):</span>
                <input
                  type="date"
                  value={goalDeadline}
                  onChange={(e) => setGoalDeadline(e.target.value)}
                  style={{
                    padding: "0.5rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border, #d1d5db)",
                  }}
                />
              </label>

              {goalNotice && (
                <div style={{ fontSize: "0.85rem", color: goalNotice.includes("success") ? "#10b981" : "#ef4444" }}>
                  {goalNotice}
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setShowGoalModal(false)}
                  disabled={goalSubmitting}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border, #d1d5db)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button primary"
                  disabled={goalSubmitting}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    background: "var(--accent)",
                    color: "var(--brand-text)",
                    border: "none",
                    cursor: "pointer",
                  }}
                >
                  {goalSubmitting ? "Saving…" : "Save Goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
