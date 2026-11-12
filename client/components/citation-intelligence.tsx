"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Layers,
  Link2Off,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  Download,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  Project,
  CitationOverviewResponse,
  DomainCitationItem,
  PageCitationItem,
  CitationGapItem,
  BrokenCitationItem,
  SourceDomainItem,
  SourceType,
} from "../lib/types";

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  news_media: "News & Media",
  review_comparison: "Review & Comparison",
  forum_ugc: "Forum / UGC",
  marketplace: "Marketplace / Directory",
  encyclopedia: "Encyclopedia / Wiki",
  academic: "Academic / Research",
  social: "Social Media",
  brand: "Brand Owned",
  other: "Other / Uncategorized",
};

const SOURCE_TYPE_COLORS: Record<SourceType, { bg: string; text: string; border: string }> = {
  brand: { bg: "rgba(16, 185, 129, 0.12)", text: "#10b981", border: "rgba(16, 185, 129, 0.4)" },
  review_comparison: { bg: "rgba(59, 130, 246, 0.12)", text: "#3b82f6", border: "rgba(59, 130, 246, 0.4)" },
  news_media: { bg: "rgba(139, 92, 246, 0.12)", text: "#8b5cf6", border: "rgba(139, 92, 246, 0.4)" },
  forum_ugc: { bg: "rgba(245, 158, 11, 0.12)", text: "#f59e0b", border: "rgba(245, 158, 11, 0.4)" },
  marketplace: { bg: "rgba(236, 72, 153, 0.12)", text: "#ec4899", border: "rgba(236, 72, 153, 0.4)" },
  encyclopedia: { bg: "rgba(20, 184, 166, 0.12)", text: "#14b8a6", border: "rgba(20, 184, 166, 0.4)" },
  academic: { bg: "rgba(99, 102, 241, 0.12)", text: "#6366f1", border: "rgba(99, 102, 241, 0.4)" },
  social: { bg: "rgba(244, 63, 94, 0.12)", text: "#f43f5e", border: "rgba(244, 63, 94, 0.4)" },
  other: { bg: "rgba(156, 163, 175, 0.12)", text: "#9ca3af", border: "rgba(156, 163, 175, 0.4)" },
};

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  Observed: { bg: "rgba(16, 185, 129, 0.15)", text: "#059669" },
  Modeled: { bg: "rgba(59, 130, 246, 0.15)", text: "#2563eb" },
  Estimated: { bg: "rgba(139, 92, 246, 0.15)", text: "#7c3aed" },
};

export function CitationIntelligence({ project }: { project: Project }) {
  const [overview, setOverview] = useState<CitationOverviewResponse | null>(null);
  const [domains, setDomains] = useState<DomainCitationItem[]>([]);
  const [pages, setPages] = useState<PageCitationItem[]>([]);
  const [gaps, setGaps] = useState<CitationGapItem[]>([]);
  const [broken, setBroken] = useState<BrokenCitationItem[]>([]);
  const [sourceDomains, setSourceDomains] = useState<SourceDomainItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<"domains" | "pages" | "gaps" | "broken" | "rules">("domains");
  const [days, setDays] = useState<number>(7);
  const [engine, setEngine] = useState<string>("all");
  const [search, setSearch] = useState<string>("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState<string>("all");
  const [onlyBrandPages, setOnlyBrandPages] = useState<boolean>(false);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [, startTransition] = useTransition();

  // Scanning & Mutation States
  const [scanningBroken, setScanningBroken] = useState<boolean>(false);
  const [showOverrideModal, setShowOverrideModal] = useState<boolean>(false);
  const [overrideDomain, setOverrideDomain] = useState<string>("");
  const [overrideType, setOverrideType] = useState<SourceType>("news_media");
  const [overrideAllowed, setOverrideAllowed] = useState<boolean>(true);
  const [overrideDenied, setOverrideDenied] = useState<boolean>(false);
  const [overrideNotes, setOverrideNotes] = useState<string>("");
  const [overrideSubmitting, setOverrideSubmitting] = useState<boolean>(false);

  useEffect(() => {
    let ignore = false;
    async function loadData() {
      setLoading(true);
      setError(null);
      try {
        const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
        const queryParams = new URLSearchParams({
          days: days.toString(),
          engine,
        });

        const [ovRes, domRes, pagRes, gapRes, brkRes, sdRes] = await Promise.all([
          api.request<CitationOverviewResponse>(`${basePath}/overview?${queryParams.toString()}`),
          api.request<{ items: DomainCitationItem[] }>(`${basePath}/domains?${queryParams.toString()}`),
          api.request<{ items: PageCitationItem[] }>(
            `${basePath}/pages?${queryParams.toString()}${onlyBrandPages ? "&onlyBrandPages=true" : ""}`,
          ),
          api.request<{ items: CitationGapItem[] }>(`${basePath}/gaps?${queryParams.toString()}`),
          api.request<{ items: BrokenCitationItem[] }>(`${basePath}/broken`),
          api.request<{ items: SourceDomainItem[] }>(`${basePath}/source-domains`),
        ]);

        if (!ignore) {
          setOverview(ovRes);
          setDomains(domRes.items || []);
          setPages(pagRes.items || []);
          setGaps(gapRes.items || []);
          setBroken(brkRes.items || []);
          setSourceDomains(sdRes.items || []);
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load citation intelligence");
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
  }, [project.id, project.tenantId, days, engine, onlyBrandPages, refreshTrigger]);

  // Broken link live scanner (CIT-FR-009)
  async function handleRunBrokenScan() {
    setScanningBroken(true);
    setNotice(null);
    try {
      const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
      const res = await api.request<{
        scannedCount: number;
        brokenFound: number;
        items: BrokenCitationItem[];
      }>(`${basePath}/broken-detection`, {
        method: "POST",
        body: { checkLive: true },
      });
      setBroken(res.items);
      setNotice(`Scan complete: checked ${res.scannedCount} brand cited URLs, found ${res.brokenFound} issues.`);
      if (overview) {
        setOverview({
          ...overview,
          kpis: {
            ...overview.kpis,
            brokenBrandCitationsCount: res.brokenFound,
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to execute live broken link scan");
    } finally {
      setScanningBroken(false);
    }
  }

  // Broken link status update
  async function handleUpdateBrokenStatus(id: string, status: "active" | "in_review" | "resolved" | "dismissed") {
    try {
      const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
      await api.request(`${basePath}/broken/${id}`, {
        method: "PATCH",
        body: { status },
      });
      setBroken((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update broken link status");
    }
  }

  // Gap status update
  async function handleUpdateGapStatus(id: string, status: "open" | "in_progress" | "resolved" | "dismissed") {
    try {
      const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
      await api.request(`${basePath}/gaps/${id}`, {
        method: "PATCH",
        body: { status },
      });
      setGaps((prev) => prev.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update citation gap status");
    }
  }

  // Save source domain override (CIT-FR-010)
  async function handleSaveOverride(e: React.FormEvent) {
    e.preventDefault();
    setOverrideSubmitting(true);
    try {
      const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
      const res = await api.request<{ item: SourceDomainItem }>(`${basePath}/source-domains`, {
        method: "POST",
        body: {
          domain: overrideDomain,
          sourceType: overrideType,
          isAllowed: overrideAllowed,
          isDenied: overrideDenied,
          notes: overrideNotes || undefined,
        },
      });
      setSourceDomains((prev) => {
        const filtered = prev.filter((d) => d.domain.toLowerCase() !== res.item.domain.toLowerCase());
        return [res.item, ...filtered];
      });
      setShowOverrideModal(false);
      setNotice(`Source override for ${res.item.domain} saved.`);
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save source override");
    } finally {
      setOverrideSubmitting(false);
    }
  }

  // Delete source override
  async function handleDeleteOverride(id: string) {
    try {
      const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/citations`;
      await api.request(`${basePath}/source-domains/${id}`, {
        method: "DELETE",
      });
      setSourceDomains((prev) => prev.filter((d) => d.id !== id));
      setNotice("Domain rule deleted.");
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete source rule");
    }
  }

  // CSV Export (CIT-FR-011)
  function handleExportCsv(type: "domains" | "pages" | "gaps" | "broken") {
    const url = `${process.env.NEXT_PUBLIC_API_URL || ""}/v1/tenants/${project.tenantId}/projects/${project.id}/citations/export?type=${type}&days=${days}&engine=${engine}`;
    window.open(url, "_blank");
  }

  // Filtered domains
  const filteredDomains = domains.filter((d) => {
    if (sourceTypeFilter !== "all" && d.sourceType !== sourceTypeFilter) return false;
    if (search.trim() && !d.domain.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Filtered pages
  const filteredPages = pages.filter((p) => {
    if (search.trim() && !p.url.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="citation-intelligence-container" style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* 1. Header Toolbar */}
      <div
        className="analytics-toolbar"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "1rem",
          background: "var(--surface)",
          padding: "1rem 1.25rem",
          borderRadius: "12px",
          border: "1px solid var(--border)",
        }}
      >
        {/* Date Window Pills */}
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
          {[
            { label: "Last 7 Days", val: 7 },
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
                border: "1px solid var(--border)",
                background: days === item.val ? "var(--accent)" : "transparent",
                color: days === item.val ? "#ffffff" : "var(--foreground)",
                fontWeight: 500,
                fontSize: "0.85rem",
                cursor: "pointer",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Engine Filter & CSV Export */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem" }}>
            <span style={{ color: "var(--muted)" }}>Engine:</span>
            <select
              value={engine}
              onChange={(e) => startTransition(() => setEngine(e.target.value))}
              style={{
                padding: "0.4rem 0.75rem",
                borderRadius: "8px",
                border: "1px solid var(--border)",
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
            onClick={() => handleExportCsv(activeTab === "rules" ? "domains" : activeTab)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.4rem 0.85rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "0.875rem",
            }}
          >
            <Download size={15} /> Export CSV
          </button>

          <button
            className="button"
            onClick={() => setRefreshTrigger((v) => v + 1)}
            disabled={loading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.4rem 0.75rem",
              borderRadius: "8px",
              border: "1px solid var(--border)",
              background: "transparent",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {notice && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            background: "rgba(16, 185, 129, 0.12)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            color: "#10b981",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            fontSize: "0.875rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            style={{ background: "transparent", border: "none", cursor: "pointer", color: "inherit" }}
          >
            <X size={15} />
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            background: "rgba(239, 68, 68, 0.12)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            color: "#ef4444",
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.875rem",
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* 2. Summary KPI Cards (CIT-FR-001, CIT-FR-002) */}
      <div
        className="kpi-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "1rem",
        }}
      >
        {/* Brand Citation Rate with Wilson CI */}
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Brand Citation Rate</span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
            {overview ? `${(overview.kpis.brandCitationRate.value * 100).toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            {overview ? (
              <>
                95% CI: [{(overview.kpis.brandCitationRate.ciLow * 100).toFixed(1)}% –{" "}
                {(overview.kpis.brandCitationRate.ciHigh * 100).toFixed(1)}%]
                <div style={{ marginTop: "0.2rem" }}>
                  <span
                    style={{
                      padding: "0.1rem 0.4rem",
                      borderRadius: "4px",
                      background: overview.kpis.brandCitationRate.isReliable
                        ? "rgba(16, 185, 129, 0.1)"
                        : "rgba(245, 158, 11, 0.1)",
                      color: overview.kpis.brandCitationRate.isReliable ? "#10b981" : "#f59e0b",
                      fontSize: "0.7rem",
                    }}
                  >
                    {overview.kpis.brandCitationRate.confidenceBadge}
                  </span>
                </div>
              </>
            ) : (
              "Calculating confidence interval…"
            )}
          </div>
        </section>

        {/* Total Citations */}
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Total Citations</span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
            {overview ? overview.kpis.totalCitations.toLocaleString() : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            {overview ? `${overview.kpis.brandCitations} brand citations` : "Loaded runs"}
          </div>
        </section>

        {/* Unique Sources */}
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Unique Sources</span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "var(--foreground)" }}>
            {overview ? overview.kpis.distinctDomains : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            {overview ? `Across ${overview.kpis.distinctPages} distinct pages` : "Normalized domains"}
          </div>
        </section>

        {/* Citation Gaps */}
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          onClick={() => setActiveTab("gaps")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Citation Gaps</span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Modeled.bg,
                color: LABEL_COLORS.Modeled.text,
              }}
            >
              Modeled
            </span>
          </div>
          <div style={{ fontSize: "1.75rem", fontWeight: 700, color: "#f59e0b" }}>
            {overview ? overview.kpis.citationGapsCount : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            Competitor citations missing your brand
          </div>
        </section>

        {/* Broken Citations */}
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            cursor: "pointer",
          }}
          onClick={() => setActiveTab("broken")}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <span style={{ fontSize: "0.8rem", color: "var(--muted)", fontWeight: 600 }}>Broken Brand Links</span>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Observed.bg,
                color: LABEL_COLORS.Observed.text,
              }}
            >
              Observed
            </span>
          </div>
          <div
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              color: overview && overview.kpis.brokenBrandCitationsCount > 0 ? "#ef4444" : "#10b981",
            }}
          >
            {overview ? overview.kpis.brokenBrandCitationsCount : "—"}
          </div>
          <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.35rem" }}>
            {overview && overview.kpis.brokenBrandCitationsCount > 0
              ? "Action required: 4xx/5xx or redirects"
              : "All brand cited URLs healthy"}
          </div>
        </section>
      </div>

      {/* 3. Source Type Distribution Bar (CIT-FR-004) */}
      {overview && (
        <section
          className="panel"
          style={{
            padding: "1.25rem",
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <Layers size={16} />
              <b style={{ fontSize: "0.9rem" }}>Source Type Distribution</b>
            </div>
            <span
              style={{
                fontSize: "0.65rem",
                fontWeight: 700,
                padding: "0.15rem 0.45rem",
                borderRadius: "4px",
                background: LABEL_COLORS.Estimated.bg,
                color: LABEL_COLORS.Estimated.text,
              }}
            >
              Estimated
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            {(Object.keys(SOURCE_TYPE_LABELS) as SourceType[]).map((type) => {
              const count = overview.sourceTypeDistribution[type] || 0;
              const share =
                overview.kpis.totalCitations > 0
                  ? ((count / overview.kpis.totalCitations) * 100).toFixed(1)
                  : "0.0";
              const col = SOURCE_TYPE_COLORS[type];
              return (
                <div
                  key={type}
                  style={{
                    padding: "0.4rem 0.75rem",
                    borderRadius: "8px",
                    background: col.bg,
                    border: `1px solid ${col.border}`,
                    color: col.text,
                    fontSize: "0.78rem",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{SOURCE_TYPE_LABELS[type]}</span>
                  <span style={{ opacity: 0.85 }}>{count} ({share}%)</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 4. Tab Navigation */}
      <div
        className="tab-bar"
        style={{
          display: "flex",
          gap: "0.5rem",
          borderBottom: "1px solid var(--border)",
          flexWrap: "wrap",
          paddingBottom: "0.5rem",
        }}
      >
        {[
          { key: "domains", label: `Top Domains (${domains.length})` },
          { key: "pages", label: `Top Pages (${pages.length})` },
          { key: "gaps", label: `Citation Gaps (${gaps.length})` },
          { key: "broken", label: `Broken Citations (${broken.length})` },
          { key: "rules", label: `Source Overrides (${sourceDomains.length})` },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as "domains" | "pages" | "gaps" | "broken" | "rules")}
            style={{
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              border: "none",
              background: activeTab === tab.key ? "var(--surface)" : "transparent",
              color: activeTab === tab.key ? "var(--foreground)" : "var(--muted)",
              fontWeight: activeTab === tab.key ? 600 : 400,
              cursor: "pointer",
              fontSize: "0.875rem",
              boxShadow: activeTab === tab.key ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {loading ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "var(--muted)" }}>
          <LoaderCircle className="spin" size={28} />
          <p style={{ marginTop: "0.75rem" }}>Aggregating citation intelligence…</p>
        </div>
      ) : activeTab === "domains" ? (
        /* DOMAINS TAB */
        <section
          className="panel"
          style={{
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          {/* Table Filters */}
          <div
            className="citation-domain-toolbar"
            style={{
              padding: "1rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div className="citation-domain-filters">
              <div
                className="citation-domain-search"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  padding: "0.35rem 0.75rem",
                  border: "1px solid var(--border)",
                  borderRadius: "8px",
                }}
              >
                <Search size={15} style={{ color: "var(--muted)" }} />
                <input
                  type="text"
                  placeholder="Filter domain…"
                  aria-label="Filter domains"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ border: "none", background: "transparent", fontSize: "0.85rem", padding: 0 }}
                />
              </div>

              <select
                aria-label="Source type"
                value={sourceTypeFilter}
                onChange={(e) => setSourceTypeFilter(e.target.value)}
                style={{
                  padding: "0.4rem 0.75rem",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  background: "transparent",
                  fontSize: "0.85rem",
                }}
              >
                <option value="all">All Source Types</option>
                {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="button"
              onClick={() => {
                setOverrideDomain("");
                setShowOverrideModal(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.85rem",
                borderRadius: "8px",
                background: "var(--accent)",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              <Plus size={14} /> Add Source Override
            </button>
          </div>

          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Domain</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Source Type</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Citations (Share)</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Distinct Pages</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Engines</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Trend</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Attribution</th>
                </tr>
              </thead>
              <tbody>
                {filteredDomains.length ? (
                  filteredDomains.map((dom) => {
                    const col = SOURCE_TYPE_COLORS[dom.sourceType] || SOURCE_TYPE_COLORS.other;
                    return (
                      <tr key={dom.domain} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <Globe2 size={15} style={{ color: "var(--muted)" }} />
                            <span>{dom.domain}</span>
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span
                            style={{
                              padding: "0.2rem 0.5rem",
                              borderRadius: "4px",
                              fontSize: "0.75rem",
                              background: col.bg,
                              color: col.text,
                              border: `1px solid ${col.border}`,
                            }}
                          >
                            {SOURCE_TYPE_LABELS[dom.sourceType] || dom.sourceType}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <b>{dom.citationCount}</b>{" "}
                          <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>
                            ({(dom.citationShare * 100).toFixed(1)}%)
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>{dom.distinctPagesCount}</td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                            {dom.engines.map((eng) => (
                              <span
                                key={eng}
                                style={{
                                  fontSize: "0.7rem",
                                  padding: "0.1rem 0.35rem",
                                  borderRadius: "4px",
                                  background: "var(--border)",
                                }}
                              >
                                {eng === "openai" ? "ChatGPT" : eng === "gemini" ? "Gemini" : eng}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "4px",
                              background:
                                dom.trendStatus === "new"
                                  ? "rgba(16, 185, 129, 0.12)"
                                  : dom.trendStatus === "lost"
                                    ? "rgba(239, 68, 68, 0.12)"
                                    : "rgba(156, 163, 175, 0.12)",
                              color:
                                dom.trendStatus === "new"
                                  ? "#10b981"
                                  : dom.trendStatus === "lost"
                                    ? "#ef4444"
                                    : "var(--muted)",
                            }}
                          >
                            {dom.trendStatus}
                          </span>
                        </td>
                        <td style={{ padding: "0.75rem 1rem" }}>
                          {dom.citesBrand && (
                            <span
                              style={{
                                fontSize: "0.7rem",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "4px",
                                background: "rgba(16, 185, 129, 0.1)",
                                color: "#10b981",
                                marginRight: "0.3rem",
                              }}
                            >
                              Brand
                            </span>
                          )}
                          {dom.citesCompetitors.map((c) => (
                            <span
                              key={c}
                              style={{
                                fontSize: "0.7rem",
                                padding: "0.15rem 0.4rem",
                                borderRadius: "4px",
                                background: "rgba(239, 68, 68, 0.1)",
                                color: "#ef4444",
                                marginRight: "0.3rem",
                              }}
                            >
                              {c}
                            </span>
                          ))}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={7} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                      No domain citations found matching filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : activeTab === "pages" ? (
        /* PAGES TAB */
        <section
          className="panel"
          style={{
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div className="citation-pages-toolbar">
            <div
              className="citation-pages-search"
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.35rem 0.75rem",
                border: "1px solid var(--border)",
                borderRadius: "8px",
              }}
            >
              <Search size={15} style={{ color: "var(--muted)" }} />
              <input
                type="text"
                placeholder="Search page URL…"
                aria-label="Search page URLs"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ border: "none", background: "transparent", fontSize: "0.85rem", padding: 0 }}
              />
            </div>

            <label className="citation-pages-brand-filter">
              <input
                type="checkbox"
                checked={onlyBrandPages}
                onChange={(e) => setOnlyBrandPages(e.target.checked)}
              />
              <span>Show Brand Owned Pages Only</span>
            </label>
          </div>

          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Page URL</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Domain</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Citations</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Prompts</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Engines</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Brand Page?</th>
                </tr>
              </thead>
              <tbody>
                {filteredPages.length ? (
                  filteredPages.map((page) => (
                    <tr key={page.normalizedUrl} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.75rem 1rem", maxWidth: "400px" }}>
                        <a
                          href={page.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            color: "var(--accent)",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "0.3rem",
                            wordBreak: "break-all",
                          }}
                        >
                          <span>{page.url}</span>
                          <ExternalLink size={12} />
                        </a>
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--muted)" }}>{page.domain}</td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{page.citationCount}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>{page.promptsCount}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <div style={{ display: "flex", gap: "0.25rem", flexWrap: "wrap" }}>
                          {page.engines.map((eng) => (
                            <span
                              key={eng}
                              style={{
                                fontSize: "0.7rem",
                                padding: "0.1rem 0.35rem",
                                borderRadius: "4px",
                                background: "var(--border)",
                              }}
                            >
                              {eng === "openai" ? "ChatGPT" : eng === "gemini" ? "Gemini" : eng}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {page.isBrandPage ? (
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "4px",
                              background: "rgba(16, 185, 129, 0.12)",
                              color: "#10b981",
                            }}
                          >
                            Brand Page
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Third-party</span>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                      No page citations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : activeTab === "gaps" ? (
        /* CITATION GAPS TAB (CIT-FR-005, CIT-FR-008) */
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div
            style={{
              padding: "1rem 1.25rem",
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              gap: "0.75rem",
              fontSize: "0.875rem",
              color: "var(--foreground)",
            }}
          >
            <div>
              <b>Opportunity Formula:</b> Gap runs identify instances where competitors are cited by AI models but your
              brand is missing. Ranked by Opportunity Score: <code>Frequency × AvgPriority × 10</code>.
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))",
              gap: "1rem",
            }}
          >
            {gaps.length ? (
              gaps.map((gap) => (
                <div
                  key={gap.id}
                  style={{
                    background: "var(--surface)",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                    padding: "1.25rem",
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <b style={{ fontSize: "1rem" }}>{gap.targetDomain}</b>
                      <div style={{ fontSize: "0.75rem", color: "var(--muted)", marginTop: "0.2rem" }}>
                        Source: {SOURCE_TYPE_LABELS[gap.sourceType] || gap.sourceType}
                      </div>
                    </div>
                    <div
                      style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "6px",
                        background: "rgba(245, 158, 11, 0.15)",
                        color: "#f59e0b",
                        fontWeight: 700,
                        fontSize: "0.85rem",
                      }}
                    >
                      Score: {gap.opportunityScore}
                    </div>
                  </div>

                  <div style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                    <div>
                      Competitors cited:{" "}
                      <span style={{ color: "#ef4444", fontWeight: 600 }}>
                        {gap.competitorsCited.join(", ") || "Direct Competitors"}
                      </span>
                    </div>
                    <div>Frequency: {gap.frequency} gap runs · Avg Priority: {gap.avgPriority.toFixed(1)}</div>
                  </div>

                  {gap.targetUrl && (
                    <div style={{ fontSize: "0.75rem", wordBreak: "break-all" }}>
                      <a
                        href={gap.targetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--accent)", textDecoration: "none" }}
                      >
                        {gap.targetUrl}
                      </a>
                    </div>
                  )}

                  <div
                    style={{
                      background: "rgba(37, 99, 235, 0.05)",
                      border: "1px solid rgba(37, 99, 235, 0.2)",
                      borderRadius: "8px",
                      padding: "0.6rem 0.8rem",
                      fontSize: "0.8rem",
                      color: "var(--foreground)",
                    }}
                  >
                    <b>Recommended Action:</b>
                    <p style={{ margin: "0.25rem 0 0 0", color: "var(--muted)" }}>{gap.recommendedAction}</p>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto" }}>
                    <span style={{ fontSize: "0.75rem", color: "var(--muted)" }}>Status:</span>
                    <select
                      value={gap.status}
                      onChange={(e) =>
                        handleUpdateGapStatus(
                          gap.id,
                          e.target.value as "open" | "in_progress" | "resolved" | "dismissed",
                        )
                      }
                      style={{
                        padding: "0.25rem 0.5rem",
                        borderRadius: "6px",
                        border: "1px solid var(--border)",
                        background: "transparent",
                        fontSize: "0.75rem",
                      }}
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </div>
                </div>
              ))
            ) : (
              <div
                style={{
                  gridColumn: "1 / -1",
                  padding: "3rem",
                  textAlign: "center",
                  background: "var(--surface)",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                  color: "var(--muted)",
                }}
              >
                No citation gaps detected for the selected period.
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "broken" ? (
        /* BROKEN BRAND CITATIONS TAB (CIT-FR-009) */
        <section
          className="panel"
          style={{
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "1rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "1rem",
            }}
          >
            <div>
              <b style={{ fontSize: "0.95rem" }}>Broken Brand Citations</b>
              <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                Detects 4xx/5xx errors or redirect chains on brand cited URLs.
              </p>
            </div>

            <button
              className="button"
              onClick={handleRunBrokenScan}
              disabled={scanningBroken}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.85rem",
                borderRadius: "8px",
                background: "var(--accent)",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              {scanningBroken ? <LoaderCircle className="spin" size={14} /> : <Link2Off size={14} />}
              Run Live URL Health Scan
            </button>
          </div>

          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Cited URL</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Issue Type</th>
                  <th style={{ padding: "0.75rem 1rem" }}>HTTP Status</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Redirect Target</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Citations</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {broken.length ? (
                  broken.map((item) => (
                    <tr key={item.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.75rem 1rem", wordBreak: "break-all", maxWidth: "350px" }}>
                        <span style={{ color: "#ef4444", fontWeight: 600 }}>{item.url}</span>
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <span
                          style={{
                            fontSize: "0.75rem",
                            padding: "0.15rem 0.45rem",
                            borderRadius: "4px",
                            background: "rgba(239, 68, 68, 0.12)",
                            color: "#ef4444",
                          }}
                        >
                          {item.issueType.replace("_", " ").toUpperCase()}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{item.httpStatus ?? "—"}</td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--muted)", maxWidth: "250px", wordBreak: "break-all" }}>
                        {item.redirectUrl ? (
                          <span style={{ color: "var(--accent)" }}>{item.redirectUrl}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>{item.citationCount}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <select
                          value={item.status}
                          onChange={(e) =>
                            handleUpdateBrokenStatus(
                              item.id,
                              e.target.value as "active" | "in_review" | "resolved" | "dismissed",
                            )
                          }
                          style={{
                            padding: "0.25rem 0.5rem",
                            borderRadius: "6px",
                            border: "1px solid var(--border)",
                            background: "transparent",
                            fontSize: "0.75rem",
                          }}
                        >
                          <option value="active">Active</option>
                          <option value="in_review">In Review</option>
                          <option value="resolved">Resolved</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} style={{ padding: "2.5rem", textAlign: "center", color: "var(--muted)" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
                        <CheckCircle2 size={24} style={{ color: "#10b981" }} />
                        <span>No broken brand citations detected. All cited brand links are operational.</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        /* SOURCE RULES TAB (CIT-FR-010) */
        <section
          className="panel"
          style={{
            background: "var(--surface)",
            borderRadius: "12px",
            border: "1px solid var(--border)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "1rem",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <b style={{ fontSize: "0.95rem" }}>Domain Classification & Governance Rules</b>
              <p style={{ margin: "0.2rem 0 0 0", fontSize: "0.75rem", color: "var(--muted)" }}>
                Custom overrides for domain source categories and allow/deny lists.
              </p>
            </div>

            <button
              className="button"
              onClick={() => {
                setOverrideDomain("");
                setShowOverrideModal(true);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.4rem 0.85rem",
                borderRadius: "8px",
                background: "var(--accent)",
                color: "#ffffff",
                border: "none",
                cursor: "pointer",
                fontSize: "0.85rem",
              }}
            >
              <Plus size={14} /> Add Rule
            </button>
          </div>

          <div className="table-wrap" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border)", color: "var(--muted)" }}>
                  <th style={{ padding: "0.75rem 1rem" }}>Domain</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Reclassified Source Type</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Governance Status</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Notes</th>
                  <th style={{ padding: "0.75rem 1rem" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sourceDomains.length ? (
                  sourceDomains.map((rule) => (
                    <tr key={rule.id} style={{ borderBottom: "1px solid var(--border)" }}>
                      <td style={{ padding: "0.75rem 1rem", fontWeight: 600 }}>{rule.domain}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <span
                          style={{
                            padding: "0.2rem 0.5rem",
                            borderRadius: "4px",
                            fontSize: "0.75rem",
                            background: "rgba(139, 92, 246, 0.12)",
                            color: "#8b5cf6",
                          }}
                        >
                          {SOURCE_TYPE_LABELS[rule.sourceType] || rule.sourceType}
                        </span>
                      </td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        {rule.isDenied ? (
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "4px",
                              background: "rgba(239, 68, 68, 0.12)",
                              color: "#ef4444",
                            }}
                          >
                            Denied
                          </span>
                        ) : rule.isAllowed ? (
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.15rem 0.45rem",
                              borderRadius: "4px",
                              background: "rgba(16, 185, 129, 0.12)",
                              color: "#10b981",
                            }}
                          >
                            Allowed
                          </span>
                        ) : (
                          <span style={{ color: "var(--muted)", fontSize: "0.75rem" }}>Neutral</span>
                        )}
                      </td>
                      <td style={{ padding: "0.75rem 1rem", color: "var(--muted)" }}>{rule.notes || "—"}</td>
                      <td style={{ padding: "0.75rem 1rem" }}>
                        <button
                          onClick={() => handleDeleteOverride(rule.id)}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: "#ef4444",
                            cursor: "pointer",
                            padding: "0.2rem",
                          }}
                          aria-label="Delete rule"
                        >
                          <Trash2 size={15} />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} style={{ padding: "2rem", textAlign: "center", color: "var(--muted)" }}>
                      No domain rules or overrides defined yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Modal: Add / Edit Source Domain Override */}
      {showOverrideModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "16px",
              padding: "1.75rem",
              width: "100%",
              maxWidth: "480px",
              border: "1px solid var(--border)",
              boxShadow: "0 20px 25px -5px rgba(0,0,0,0.2)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
              <b style={{ fontSize: "1.1rem" }}>Domain Classification Override</b>
              <button
                onClick={() => setShowOverrideModal(false)}
                style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)" }}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveOverride} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                  Domain (e.g. nytimes.com, trustpilot.com)
                </label>
                <input
                  type="text"
                  required
                  placeholder="domain.com"
                  value={overrideDomain}
                  onChange={(e) => setOverrideDomain(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                  Reclassified Source Type
                </label>
                <select
                  value={overrideType}
                  onChange={(e) => setOverrideType(e.target.value as SourceType)}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    fontSize: "0.875rem",
                  }}
                >
                  {Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>

              <div style={{ display: "flex", gap: "1.5rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={overrideAllowed}
                    onChange={(e) => {
                      setOverrideAllowed(e.target.checked);
                      if (e.target.checked) setOverrideDenied(false);
                    }}
                  />
                  <span>Allowlisted Source</span>
                </label>

                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.85rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={overrideDenied}
                    onChange={(e) => {
                      setOverrideDenied(e.target.checked);
                      if (e.target.checked) setOverrideAllowed(false);
                    }}
                  />
                  <span>Denylisted Source</span>
                </label>
              </div>

              <div>
                <label style={{ display: "block", fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.35rem" }}>
                  Notes (optional)
                </label>
                <textarea
                  placeholder="Reason for classification override…"
                  value={overrideNotes}
                  onChange={(e) => setOverrideNotes(e.target.value)}
                  rows={2}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    fontSize: "0.875rem",
                  }}
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "0.5rem" }}>
                <button
                  type="button"
                  className="button"
                  onClick={() => setShowOverrideModal(false)}
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "transparent",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={overrideSubmitting}
                  className="button primary"
                  style={{
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    background: "var(--accent)",
                    color: "#ffffff",
                    border: "none",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                  }}
                >
                  {overrideSubmitting && <LoaderCircle className="spin" size={14} />}
                  Save Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
