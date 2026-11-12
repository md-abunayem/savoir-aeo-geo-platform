"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import {
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Flame,
  Globe2,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Swords,
  Trash2,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import type {
  Project,
  CompetitorItem,
  LeaderboardItem,
  HeadToHeadResponse,
  CompetitiveGapItem,
  CompetitorCandidateItem,
  CompetitorType,
  CandidateEntityType,
  CandidateStatus,
} from "../lib/types";

const COMPETITOR_TYPE_BADGES: Record<
  CompetitorType,
  { label: string; bg: string; text: string; border: string }
> = {
  direct: {
    label: "Direct Competitor",
    bg: "rgba(59, 130, 246, 0.12)",
    text: "#3b82f6",
    border: "rgba(59, 130, 246, 0.35)",
  },
  indirect: {
    label: "Indirect Alternative",
    bg: "rgba(139, 92, 246, 0.12)",
    text: "#8b5cf6",
    border: "rgba(139, 92, 246, 0.35)",
  },
  aspirational: {
    label: "Aspirational Leader",
    bg: "rgba(245, 158, 11, 0.12)",
    text: "#f59e0b",
    border: "rgba(245, 158, 11, 0.35)",
  },
};

const ENTITY_TYPE_LABELS: Record<CandidateEntityType, string> = {
  competitor: "Competitor",
  marketplace: "Marketplace / Directory",
  publisher: "Publisher / News",
  tool: "Tool / Software",
  other: "Uncategorized Entity",
};

const LABEL_COLORS: Record<string, { bg: string; text: string }> = {
  Observed: { bg: "rgba(16, 185, 129, 0.15)", text: "#059669" },
  Modeled: { bg: "rgba(59, 130, 246, 0.15)", text: "#2563eb" },
  Estimated: { bg: "rgba(139, 92, 246, 0.15)", text: "#7c3aed" },
};

const AMBIGUOUS_NAMES = new Set([
  "apple",
  "target",
  "box",
  "square",
  "monday",
  "stripe",
  "amazon",
  "google",
  "notion",
  "base",
  "nest",
  "slate",
  "anchor",
  "compass",
  "canvas",
  "zoom",
]);

const COMPETITOR_REQUEST_TIMEOUT_MS = 70000;

function requestCompetitorApi<T>(
  path: string,
  options: Parameters<typeof api.request>[1] = {},
) {
  return api.request<T>(path, {
    ...options,
    timeoutMs: COMPETITOR_REQUEST_TIMEOUT_MS,
  });
}

export function CompetitorIntelligence({ project }: { project: Project }) {
  // State
  const [activeTab, setActiveTab] = useState<
    "leaderboard" | "head_to_head" | "gaps" | "trends" | "candidates" | "manage"
  >("leaderboard");

  const [leaderboard, setLeaderboard] = useState<LeaderboardItem[]>([]);
  const [competitors, setCompetitors] = useState<CompetitorItem[]>([]);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<string>("");
  const [headToHead, setHeadToHead] = useState<HeadToHeadResponse | null>(null);
  const [gaps, setGaps] = useState<CompetitiveGapItem[]>([]);
  const [candidates, setCandidates] = useState<CompetitorCandidateItem[]>([]);
  const [topics, setTopics] = useState<string[]>([]);
  const [previousLeaderboard, setPreviousLeaderboard] = useState<
    LeaderboardItem[]
  >([]);
  const [candidateStatusFilter, setCandidateStatusFilter] =
    useState<CandidateStatus>("suggested");

  // Filters
  const [days, setDays] = useState<number>(7);
  const [isCustomRange, setIsCustomRange] = useState<boolean>(false);
  const [customRange, setCustomRange] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [dateDraftFrom, setDateDraftFrom] = useState<string>("");
  const [dateDraftTo, setDateDraftTo] = useState<string>("");
  const [engine, setEngine] = useState<string>("all");
  const [topic, setTopic] = useState<string>("all");
  const [competitorTypeFilter, setCompetitorTypeFilter] = useState<
    "all" | CompetitorType
  >("all");
  const [nonBrandedOnly, setNonBrandedOnly] = useState<boolean>(false);
  const [comparePrevious, setComparePrevious] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);
  const [, startTransition] = useTransition();

  // Status & Feedback
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scanning, setScanning] = useState<boolean>(false);

  // Modals
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [addName, setAddName] = useState<string>("");
  const [addDomain, setAddDomain] = useState<string>("");
  const [addType, setAddType] = useState<CompetitorType>("direct");
  const [addAliases, setAddAliases] = useState<string>("");
  const [addRationale, setAddRationale] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Edit Competitor Modal
  const [editingCompetitor, setEditingCompetitor] =
    useState<CompetitorItem | null>(null);
  const [editType, setEditType] = useState<CompetitorType>("direct");
  const [editAliases, setEditAliases] = useState<string>("");
  const [editRationale, setEditRationale] = useState<string>("");

  const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/competitors`;

  const buildQueryParams = useCallback(
    (range?: { from: string; to: string }) => {
      const params = new URLSearchParams();
      const appliedRange = range || (isCustomRange ? customRange : null);
      if (appliedRange) {
        params.set("dateFrom", appliedRange.from);
        params.set("dateTo", appliedRange.to);
      } else {
        params.set("days", String(days));
      }
      params.set("engine", engine);
      if (topic !== "all") params.set("topic", topic);
      if (nonBrandedOnly) params.set("nonBrandedOnly", "true");
      return params;
    },
    [days, engine, topic, nonBrandedOnly, isCustomRange, customRange],
  );

  const previousPeriodRange = useCallback(() => {
    const currentRange = isCustomRange ? customRange : null;
    if (isCustomRange && !currentRange) return null;

    const currentFrom = currentRange
      ? new Date(`${currentRange.from}T00:00:00.000Z`)
      : new Date(Date.now() - days * 86400000);
    const durationDays = currentRange
      ? Math.max(
          1,
          Math.floor(
            (new Date(`${currentRange.to}T00:00:00.000Z`).getTime() -
              currentFrom.getTime()) /
              86400000,
          ) + 1,
        )
      : days;
    const previousTo = new Date(currentFrom.getTime() - 86400000);
    const previousFrom = new Date(
      previousTo.getTime() - (durationDays - 1) * 86400000,
    );
    return {
      from: previousFrom.toISOString().slice(0, 10),
      to: previousTo.toISOString().slice(0, 10),
    };
  }, [days, isCustomRange, customRange]);

  // 1. Initial Load of Competitors & Leaderboard
  useEffect(() => {
    if (isCustomRange && !customRange) return;
    let ignore = false;
    async function loadInitial() {
      setLoading(true);
      setError(null);
      try {
        const queryParams = buildQueryParams();
        const previousRange = comparePrevious ? previousPeriodRange() : null;
        const previousParams = previousRange
          ? buildQueryParams(previousRange)
          : null;

        const [compRes, leaderRes, gapsRes, candRes, topicRes, previousRes] =
          await Promise.all([
            requestCompetitorApi<{ items: CompetitorItem[] }>(
              `${basePath}?${queryParams}`,
            ),
            requestCompetitorApi<{ items: LeaderboardItem[] }>(
              `${basePath}/leaderboard?${queryParams}`,
            ),
            requestCompetitorApi<{ items: CompetitiveGapItem[] }>(
              `${basePath}/gaps?${queryParams}`,
            ),
            requestCompetitorApi<{ items: CompetitorCandidateItem[] }>(
              `${basePath}/candidates?status=${candidateStatusFilter}`,
            ),
            requestCompetitorApi<{ topics: string[] }>(`${basePath}/topics`),
            previousParams
              ? requestCompetitorApi<{ items: LeaderboardItem[] }>(
                  `${basePath}/leaderboard?${previousParams}`,
                )
              : Promise.resolve({ items: [] as LeaderboardItem[] }),
        ]);

        if (ignore) return;

        setCompetitors(compRes.items);
        setLeaderboard(leaderRes.items);
        setGaps(gapsRes.items);
        setCandidates(candRes.items);
        setTopics(topicRes.topics);
        setPreviousLeaderboard(previousRes.items);

        if (compRes.items.length > 0) {
          setSelectedCompetitorId((cur) => cur || compRes.items[0].id);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load competitor data",
          );
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadInitial();
    return () => {
      ignore = true;
    };
  }, [
    basePath,
    buildQueryParams,
    previousPeriodRange,
    isCustomRange,
    customRange,
    comparePrevious,
    refreshTrigger,
    candidateStatusFilter,
  ]);

  // 2. Load Head-to-Head when competitor or filters change
  useEffect(() => {
    if (!selectedCompetitorId || (isCustomRange && !customRange)) return;
    let ignore = false;

    async function loadH2H() {
      try {
        const queryParams = buildQueryParams();
        const res = await requestCompetitorApi<HeadToHeadResponse>(
          `${basePath}/${selectedCompetitorId}/head-to-head?${queryParams}`,
        );
        if (!ignore) {
          setHeadToHead(res);
        }
      } catch (err) {
        if (!ignore) {
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load head-to-head data",
          );
        }
      }
    }

    loadH2H();
    return () => {
      ignore = true;
    };
  }, [
    basePath,
    selectedCompetitorId,
    buildQueryParams,
    days,
    engine,
    topic,
    nonBrandedOnly,
    isCustomRange,
    customRange,
  ]);

  // Actions
  async function handleCreateCompetitor(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      const aliasesList = addAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await requestCompetitorApi<{ item: CompetitorItem }>(
        `${basePath}`,
        {
        method: "POST",
        body: {
          name: addName.trim(),
          domain: addDomain.trim(),
          competitorType: addType,
          aliases: aliasesList.length ? aliasesList : undefined,
          rationale: addRationale.trim() || undefined,
        },
        },
      );

      setCompetitors((prev) => [...prev, res.item]);
      setShowAddModal(false);
      setAddName("");
      setAddDomain("");
      setAddAliases("");
      setAddRationale("");
      setNotice(`Competitor "${res.item.name}" added successfully.`);
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create competitor",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleUpdateCompetitor(e: React.FormEvent) {
    e.preventDefault();
    if (!editingCompetitor) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const aliasesList = editAliases
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean);

      const res = await requestCompetitorApi<{ item: CompetitorItem }>(
        `${basePath}/${editingCompetitor.id}`,
        {
          method: "PATCH",
          body: {
            competitorType: editType,
            aliases: aliasesList,
            rationale: editRationale.trim() || null,
          },
        },
      );

      setCompetitors((prev) =>
        prev.map((c) => (c.id === res.item.id ? res.item : c)),
      );
      setEditingCompetitor(null);
      setNotice(`Competitor "${res.item.name}" updated.`);
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update competitor",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDeleteCompetitor(id: string, name: string) {
    if (
      !window.confirm(
        `Are you sure you want to stop tracking "${name}"? Historical runs will preserve mentions, but competitor benchmarks will stop.`,
      )
    ) {
      return;
    }
    try {
      await requestCompetitorApi(`${basePath}/${id}`, {
        method: "DELETE",
      });
      setCompetitors((prev) => prev.filter((c) => c.id !== id));
      if (selectedCompetitorId === id) {
        setSelectedCompetitorId(competitors.find((c) => c.id !== id)?.id || "");
      }
      setNotice(`Competitor "${name}" deleted.`);
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to delete competitor",
      );
    }
  }

  async function handleRunDiscovery() {
    setScanning(true);
    setError(null);
    try {
      const res = await requestCompetitorApi<{
        discoveredCount: number;
        items: CompetitorCandidateItem[];
      }>(`${basePath}/candidates/discover`, {
        method: "POST",
      });
      setCandidates(res.items);
      setNotice(
        `Scan complete! Discovered ${res.discoveredCount} new competitor candidates with ≥ 10% mention frequency.`,
      );
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Auto-discovery scan failed",
      );
    } finally {
      setScanning(false);
    }
  }

  async function handleAcceptCandidate(id: string, name: string) {
    try {
      const res = await requestCompetitorApi<{ item: CompetitorItem }>(
        `${basePath}/candidates/${id}/accept`,
        {
          method: "POST",
        },
      );
      setNotice(`Candidate "${name}" accepted into tracked competitors.`);
      setCompetitors((prev) => [...prev, res.item]);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to accept candidate",
      );
    }
  }

  async function handleRejectCandidate(id: string, name: string) {
    try {
      await requestCompetitorApi(`${basePath}/candidates/${id}/reject`, {
        method: "POST",
      });
      setNotice(`"${name}" rejected (90-day cooldown applied).`);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to reject candidate",
      );
    }
  }

  async function handleSnoozeCandidate(id: string, name: string) {
    try {
      await requestCompetitorApi(`${basePath}/candidates/${id}/snooze`, {
        method: "POST",
      });
      setNotice(`"${name}" snoozed for 30 days.`);
      setCandidates((prev) => prev.filter((c) => c.id !== id));
      setRefreshTrigger((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to snooze candidate",
      );
    }
  }

  function handleExportCsv(type: "leaderboard" | "head_to_head" | "gaps") {
    const compParam =
      type === "head_to_head" && selectedCompetitorId
        ? `&competitorId=${encodeURIComponent(selectedCompetitorId)}`
        : "";
    const url = `${process.env.NEXT_PUBLIC_API_URL || ""}${basePath}/export?type=${type}&${buildQueryParams()}${compParam}`;
    window.open(url, "_blank");
  }

  const selectedCompObj = competitors.find(
    (c) => c.id === selectedCompetitorId,
  );

  const matchesCompetitorFilters = (item: LeaderboardItem) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.domain.toLowerCase().includes(search.toLowerCase());
    const matchesType =
      competitorTypeFilter === "all" ||
      item.competitorType === competitorTypeFilter;
    return matchesSearch && matchesType;
  };
  const filteredCompetitors = competitors.filter((item) => {
    const matchesSearch =
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.domain.toLowerCase().includes(search.toLowerCase());
    const matchesType =
      competitorTypeFilter === "all" ||
      item.competitorType === competitorTypeFilter;
    return matchesSearch && matchesType;
  });
  const filteredLeaderboard = leaderboard.filter(matchesCompetitorFilters);
  const filteredPreviousLeaderboard = previousLeaderboard.filter(
    matchesCompetitorFilters,
  );
  const filteredGaps = gaps.filter((gap) => {
    const competitor = competitors.find((item) => item.id === gap.competitorId);
    const matchesSearch =
      !search ||
      gap.competitorName.toLowerCase().includes(search.toLowerCase()) ||
      gap.promptText.toLowerCase().includes(search.toLowerCase());
    const matchesType =
      competitorTypeFilter === "all" ||
      competitor?.competitorType === competitorTypeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div
      className="competitor-intelligence-container"
      style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}
    >
      <div className="page-heading citation-page-heading competitor-page-heading">
        <div>
          <p className="eyebrow">COMPETITOR INTELLIGENCE</p>
          <h1>Competitor Intelligence &amp; Gap Analysis</h1>
          <p className="subtitle">
            Compare competitor visibility, explore head-to-head performance, and
            uncover gaps across AI engines.
          </p>
        </div>
        <div className="actions">
          <button
            className="button"
            onClick={() => setRefreshTrigger((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            Refresh
          </button>
          <button
            className="button primary"
            onClick={() => setShowAddModal(true)}
            disabled={competitors.length >= 25}
          >
            <Plus size={16} />
            Add competitor
          </button>
        </div>
      </div>

      <div
        className="analytics-toolbar competitor-filter-toolbar"
        style={{
          display: "grid",
          gap: "0.85rem",
          background: "var(--surface)",
          padding: "1rem 1.25rem",
          borderRadius: "12px",
          border: "1px solid var(--border)",
        }}
      >
        <div className="competitor-filter-row">
          <div className="competitor-date-filters">
            <span className="competitor-filter-label">
              <CalendarDays size={15} /> Date range
            </span>
            {[
              { label: "7 days", val: 7 },
              { label: "14 days", val: 14 },
              { label: "30 days", val: 30 },
              { label: "90 days", val: 90 },
            ].map((item) => (
              <button
                type="button"
                key={item.val}
                className={`pill-button ${!isCustomRange && days === item.val ? "active" : ""}`}
                onClick={() => {
                  setIsCustomRange(false);
                  startTransition(() => setDays(item.val));
                }}
                style={{
                  padding: "0.4rem 0.7rem",
                  borderRadius: "20px",
                  border: "1px solid var(--border)",
                  background:
                    !isCustomRange && days === item.val
                      ? "var(--accent)"
                      : "transparent",
                  color:
                    !isCustomRange && days === item.val
                      ? "#ffffff"
                      : "var(--foreground)",
                  fontWeight: 500,
                  fontSize: "0.8rem",
                  cursor: "pointer",
                }}
              >
                {item.label}
              </button>
            ))}
            <button
              type="button"
              className={`pill-button ${isCustomRange ? "active" : ""}`}
              onClick={() => {
                const today = new Date();
                const from = new Date(today);
                from.setUTCDate(from.getUTCDate() - days + 1);
                setDateDraftFrom(from.toISOString().slice(0, 10));
                setDateDraftTo(today.toISOString().slice(0, 10));
                setCustomRange(null);
                setPreviousLeaderboard([]);
                setLoading(false);
                setIsCustomRange(true);
              }}
              style={{
                padding: "0.4rem 0.7rem",
                borderRadius: "20px",
                border: "1px solid var(--border)",
                background: isCustomRange ? "var(--accent)" : "transparent",
                color: isCustomRange ? "#ffffff" : "var(--foreground)",
                fontSize: "0.8rem",
                cursor: "pointer",
              }}
            >
              Custom
            </button>
          </div>
          <label className="competitor-compare-toggle">
            <input
              type="checkbox"
              checked={comparePrevious}
              onChange={(event) => setComparePrevious(event.target.checked)}
            />
            Compare to previous period
          </label>
        </div>

        {isCustomRange && (
          <div className="competitor-custom-date-range">
            <label>
              From
              <input
                type="date"
                aria-label="Custom date range start"
                value={dateDraftFrom}
                max={dateDraftTo || undefined}
                onChange={(event) => setDateDraftFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                aria-label="Custom date range end"
                value={dateDraftTo}
                min={dateDraftFrom || undefined}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDateDraftTo(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="button primary"
              disabled={
                !dateDraftFrom || !dateDraftTo || dateDraftFrom > dateDraftTo
              }
              onClick={() =>
                setCustomRange({ from: dateDraftFrom, to: dateDraftTo })
              }
            >
              Apply dates
            </button>
          </div>
        )}

        <div className="competitor-filter-controls">
          <label>
            <span>Engine</span>
            <select
              aria-label="Filter by engine"
              value={engine}
              onChange={(event) =>
                startTransition(() => setEngine(event.target.value))
              }
            >
              <option value="all">All engines</option>
              <option value="openai">ChatGPT</option>
              <option value="gemini">Gemini</option>
              <option value="google_ai_overviews">AI Overviews</option>
              <option value="google_ai_mode">AI Mode</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label>
            <span>Topic</span>
            <select
              aria-label="Filter by topic"
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
            >
              <option value="all">All topics</option>
              {topics.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Competitor type</span>
            <select
              aria-label="Filter by competitor type"
              value={competitorTypeFilter}
              onChange={(event) =>
                setCompetitorTypeFilter(
                  event.target.value as "all" | CompetitorType,
                )
              }
            >
              <option value="all">All types</option>
              <option value="direct">Direct</option>
              <option value="indirect">Indirect</option>
              <option value="aspirational">Aspirational</option>
            </select>
          </label>
          <label className="competitor-nonbranded-toggle">
            <input
              type="checkbox"
              checked={nonBrandedOnly}
              onChange={(event) => setNonBrandedOnly(event.target.checked)}
            />
            Non-branded prompts only
          </label>
          <div className="competitor-toolbar-search">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search competitors"
              aria-label="Search competitors"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div style={{ position: "relative" }}>
            <button
              className="button"
              onClick={() =>
                handleExportCsv(
                  activeTab === "head_to_head"
                    ? "head_to_head"
                    : activeTab === "gaps"
                      ? "gaps"
                      : "leaderboard",
                )
              }
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
              <Download size={15} /> Export
            </button>
          </div>
        </div>
      </div>

      {/* Notices & Alerts */}
      {notice && (
        <div
          style={{
            padding: "0.75rem 1rem",
            borderRadius: "8px",
            background: "rgba(16, 185, 129, 0.12)",
            border: "1px solid rgba(16, 185, 129, 0.3)",
            color: "#10b981",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.9rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <CheckCircle2 size={16} />
            <span>{notice}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <X size={16} />
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
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: "0.9rem",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* 2. Main Navigation Tabs */}
      <div
        role="tablist"
        aria-label="Competitor intelligence views"
        style={{
          display: "flex",
          flexWrap: "wrap",
          borderBottom: "1px solid var(--border)",
          gap: "1.5rem",
        }}
      >
        {[
          {
            id: "leaderboard",
            label: "Competitor Leaderboard",
            icon: Trophy,
            badge: leaderboard.length,
          },
          {
            id: "head_to_head",
            label: "Head-to-Head",
            icon: Swords,
            badge: competitors.length,
          },
          {
            id: "gaps",
            label: "Competitive Gaps",
            icon: Flame,
            badge: gaps.length,
          },
          {
            id: "trends",
            label: "Trends & Reports",
            icon: TrendingUp,
          },
          {
            id: "candidates",
            label: "Auto-Discovery",
            icon: Sparkles,
            badge: candidates.length,
          },
          {
            id: "manage",
            label: "Manage Competitors",
            icon: Globe2,
            badge: `${competitors.length}/25`,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => {
                setActiveTab(tab.id as typeof activeTab);
                setError(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                padding: "0.75rem 0.25rem",
                background: "transparent",
                border: "none",
                borderBottom: isActive
                  ? "2px solid var(--accent)"
                  : "2px solid transparent",
                color: isActive ? "var(--foreground)" : "var(--muted)",
                fontWeight: isActive ? 600 : 500,
                fontSize: "0.95rem",
                cursor: "pointer",
                marginBottom: "-1px",
              }}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              {tab.badge !== undefined && (
                <span
                  style={{
                    padding: "0.15rem 0.45rem",
                    borderRadius: "10px",
                    fontSize: "0.75rem",
                    background: isActive
                      ? "var(--accent)"
                      : "rgba(255, 255, 255, 0.08)",
                    color: isActive ? "#ffffff" : "var(--muted)",
                  }}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Loading Indicator */}
      {loading ? (
        <div
          style={{
            padding: "4rem 0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: "0.75rem",
            color: "var(--muted)",
          }}
        >
          <LoaderCircle size={22} className="spin" />
          <span>Crunching competitor metrics...</span>
        </div>
      ) : (
        <>
          {/* TAB 1: COMPETITOR LEADERBOARD (CMP-FR-004, CMP-FR-002) */}
          {activeTab === "leaderboard" && (
            <section
              className="panel"
              style={{
                background: "var(--surface)",
                padding: "1.25rem",
                borderRadius: "12px",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    AI Visibility Leaderboard
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "4px",
                        background: LABEL_COLORS.Observed.bg,
                        color: LABEL_COLORS.Observed.text,
                        fontWeight: 600,
                      }}
                    >
                      Observed
                    </span>
                  </h3>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                      margin: "0.25rem 0 0 0",
                    }}
                  >
                    Ranking your brand and tracked competitors by visibility
                    rate, share of voice, and mention authority across AI
                    engines.
                  </p>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    className="button"
                    onClick={() => setRefreshTrigger((v) => v + 1)}
                    style={{
                      padding: "0.4rem 0.75rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: "0.85rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>
              </div>

              {filteredLeaderboard.length === 0 ? (
                <div
                  style={{
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  <Trophy
                    size={36}
                    style={{ opacity: 0.4, marginBottom: "0.5rem" }}
                  />
                  <p>
                    No competitor observations available for this time window.
                  </p>
                  <p style={{ fontSize: "0.85rem" }}>
                    Run monitoring batches or add competitors to see the
                    leaderboard.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                      fontSize: "0.875rem",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border)",
                          color: "var(--muted)",
                          fontSize: "0.8rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        <th
                          style={{ padding: "0.75rem 0.5rem", width: "60px" }}
                        >
                          Rank
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Entity</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Type</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Visibility Rate (V)
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Share of Voice (SoV)
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Avg Position
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Sentiment</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          H2H vs Brand
                        </th>
                        <th
                          style={{
                            padding: "0.75rem 0.5rem",
                            textAlign: "right",
                          }}
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLeaderboard.map((item) => {
                        const isBrand = item.isBrand;
                        const compTypeInfo = item.competitorType
                          ? COMPETITOR_TYPE_BADGES[item.competitorType]
                          : null;

                        return (
                          <tr
                            key={item.entityId}
                            style={{
                              borderBottom: "1px solid var(--border)",
                              background: isBrand
                                ? "rgba(16, 185, 129, 0.05)"
                                : "transparent",
                            }}
                          >
                            <td
                              style={{
                                padding: "0.85rem 0.5rem",
                                fontWeight: 700,
                              }}
                            >
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "0.35rem",
                                }}
                              >
                                {item.rank === 1 ? (
                                  <span
                                    style={{
                                      color: "#fbbf24",
                                      fontWeight: 800,
                                    }}
                                  >
                                    #1
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>
                                    #{item.rank}
                                  </span>
                                )}
                                {item.rankDelta > 0 && (
                                  <span
                                    style={{
                                      color: "#10b981",
                                      fontSize: "0.75rem",
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                  >
                                    <TrendingUp size={12} />
                                  </span>
                                )}
                                {item.rankDelta < 0 && (
                                  <span
                                    style={{
                                      color: "#ef4444",
                                      fontSize: "0.75rem",
                                      display: "flex",
                                      alignItems: "center",
                                    }}
                                  >
                                    <TrendingDown size={12} />
                                  </span>
                                )}
                              </div>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color: isBrand
                                      ? "#10b981"
                                      : "var(--foreground)",
                                  }}
                                >
                                  {item.name}
                                  {isBrand && (
                                    <span
                                      style={{
                                        marginLeft: "0.5rem",
                                        fontSize: "0.7rem",
                                        padding: "0.1rem 0.4rem",
                                        borderRadius: "4px",
                                        background: "rgba(16, 185, 129, 0.2)",
                                        color: "#10b981",
                                      }}
                                    >
                                      YOUR BRAND
                                    </span>
                                  )}
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {item.domain}
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              {isBrand ? (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    fontWeight: 600,
                                    color: "#10b981",
                                  }}
                                >
                                  Brand Core
                                </span>
                              ) : compTypeInfo ? (
                                <span
                                  style={{
                                    fontSize: "0.75rem",
                                    padding: "0.2rem 0.5rem",
                                    borderRadius: "12px",
                                    background: compTypeInfo.bg,
                                    color: compTypeInfo.text,
                                    border: `1px solid ${compTypeInfo.border}`,
                                    fontWeight: 500,
                                  }}
                                >
                                  {compTypeInfo.label}
                                </span>
                              ) : (
                                <span style={{ color: "var(--muted)" }}>—</span>
                              )}
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>
                                  {(item.visibilityRate * 100).toFixed(1)}%
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    color: "var(--muted)",
                                  }}
                                >
                                  CI: {(item.ciLow * 100).toFixed(0)}%–
                                  {(item.ciHigh * 100).toFixed(0)}%
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              <div
                                style={{
                                  display: "flex",
                                  flexDirection: "column",
                                }}
                              >
                                <span style={{ fontWeight: 600 }}>
                                  {item.shareOfVoice.toFixed(1)}%
                                </span>
                                <span
                                  style={{
                                    fontSize: "0.7rem",
                                    color:
                                      item.shareOfVoice >= item.fairShare
                                        ? "#10b981"
                                        : "var(--muted)",
                                  }}
                                >
                                  Fair: {item.fairShare.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              <span style={{ fontWeight: 500 }}>
                                {item.avgPosition > 0
                                  ? `#${item.avgPosition.toFixed(1)}`
                                  : "—"}
                              </span>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              <span
                                style={{
                                  fontWeight: 500,
                                  color:
                                    item.sentimentScore > 0.6
                                      ? "#10b981"
                                      : item.sentimentScore < 0.4
                                        ? "#ef4444"
                                        : "inherit",
                                }}
                              >
                                {(item.sentimentScore * 100).toFixed(0)}%
                              </span>
                            </td>
                            <td style={{ padding: "0.85rem 0.5rem" }}>
                              {isBrand ? (
                                <span style={{ color: "var(--muted)" }}>—</span>
                              ) : (
                                <span
                                  style={{
                                    fontWeight: 600,
                                    color:
                                      item.headToHeadWinRate >= 50
                                        ? "#10b981"
                                        : "#ef4444",
                                  }}
                                >
                                  {item.headToHeadWinRate.toFixed(1)}% win
                                </span>
                              )}
                            </td>
                            <td
                              style={{
                                padding: "0.85rem 0.5rem",
                                textAlign: "right",
                              }}
                            >
                              {!isBrand && (
                                <button
                                  className="button"
                                  onClick={() => {
                                    setSelectedCompetitorId(item.entityId);
                                    setActiveTab("head_to_head");
                                  }}
                                  style={{
                                    padding: "0.3rem 0.6rem",
                                    borderRadius: "6px",
                                    border: "1px solid var(--border)",
                                    background: "transparent",
                                    fontSize: "0.75rem",
                                    cursor: "pointer",
                                  }}
                                >
                                  Matchup <ChevronRight size={12} />
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* TAB 2: HEAD-TO-HEAD MATCHUP (CMP-FR-003) */}
          {activeTab === "head_to_head" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              {/* Competitor Selector Toolbar */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: "1rem",
                  background: "var(--surface)",
                  padding: "1rem",
                  borderRadius: "10px",
                  border: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.75rem",
                    flexWrap: "wrap",
                  }}
                >
                  <label
                    style={{
                      fontSize: "0.875rem",
                      fontWeight: 600,
                      color: "var(--foreground)",
                    }}
                  >
                    Select Competitor:
                  </label>
                  <select
                    value={selectedCompetitorId}
                    onChange={(e) => setSelectedCompetitorId(e.target.value)}
                    style={{
                      padding: "0.45rem 0.85rem",
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      background: "var(--surface)",
                      fontSize: "0.9rem",
                      fontWeight: 600,
                    }}
                  >
                    {competitors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.domain})
                      </option>
                    ))}
                  </select>
                </div>

                {selectedCompObj && (
                  <span
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--muted)",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}
                  >
                    Comparing {project.brandName} vs {selectedCompObj.name}
                  </span>
                )}
              </div>

              {/* Head-to-Head KPI Cards */}
              {headToHead ? (
                <>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns:
                        "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: "1rem",
                    }}
                  >
                    <div
                      className="metric-card"
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.8rem",
                          color: "var(--muted)",
                          display: "flex",
                          justifyContent: "space-between",
                        }}
                      >
                        Brand Win Rate
                        <span
                          style={{
                            fontSize: "0.65rem",
                            padding: "0.1rem 0.35rem",
                            borderRadius: "4px",
                            background: LABEL_COLORS.Observed.bg,
                            color: LABEL_COLORS.Observed.text,
                            fontWeight: 600,
                          }}
                        >
                          Observed
                        </span>
                      </span>
                      <div
                        style={{
                          fontSize: "1.75rem",
                          fontWeight: 700,
                          margin: "0.35rem 0",
                          color:
                            headToHead.summary.winRate >= 50
                              ? "#10b981"
                              : "#ef4444",
                        }}
                      >
                        {headToHead.summary.winRate.toFixed(1)}%
                      </div>
                      <span
                        style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                      >
                        {headToHead.summary.wins} wins /{" "}
                        {headToHead.summary.totalPrompts} prompts
                      </span>
                    </div>

                    <div
                      className="metric-card"
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{ fontSize: "0.8rem", color: "var(--muted)" }}
                      >
                        Prompt Record
                      </span>
                      <div
                        style={{
                          fontSize: "1.75rem",
                          fontWeight: 700,
                          margin: "0.35rem 0",
                          display: "flex",
                          gap: "0.5rem",
                          alignItems: "baseline",
                        }}
                      >
                        <span style={{ color: "#10b981" }}>
                          {headToHead.summary.wins}W
                        </span>
                        <span style={{ color: "#ef4444" }}>
                          {headToHead.summary.losses}L
                        </span>
                        <span style={{ color: "var(--muted)" }}>
                          {headToHead.summary.ties}T
                        </span>
                      </div>
                      <span
                        style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                      >
                        Wins, Losses, and Ties
                      </span>
                    </div>

                    <div
                      className="metric-card"
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{ fontSize: "0.8rem", color: "var(--muted)" }}
                      >
                        Brand Visibility
                      </span>
                      <div
                        style={{
                          fontSize: "1.75rem",
                          fontWeight: 700,
                          margin: "0.35rem 0",
                          color: "#10b981",
                        }}
                      >
                        {(headToHead.summary.brandVisibilityRate * 100).toFixed(
                          1,
                        )}
                        %
                      </div>
                      <span
                        style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                      >
                        Runs with {project.brandName} mention
                      </span>
                    </div>

                    <div
                      className="metric-card"
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                      }}
                    >
                      <span
                        style={{ fontSize: "0.8rem", color: "var(--muted)" }}
                      >
                        Competitor Visibility
                      </span>
                      <div
                        style={{
                          fontSize: "1.75rem",
                          fontWeight: 700,
                          margin: "0.35rem 0",
                          color: "#3b82f6",
                        }}
                      >
                        {(
                          headToHead.summary.competitorVisibilityRate * 100
                        ).toFixed(1)}
                        %
                      </div>
                      <span
                        style={{ fontSize: "0.75rem", color: "var(--muted)" }}
                      >
                        Runs with {headToHead.competitor.name} mention
                      </span>
                    </div>
                  </div>

                  {/* Prompt Breakdown Table */}
                  <section
                    className="panel"
                    style={{
                      background: "var(--surface)",
                      padding: "1.25rem",
                      borderRadius: "12px",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "1rem",
                      }}
                    >
                      <h4
                        style={{
                          margin: 0,
                          fontSize: "1rem",
                          fontWeight: 600,
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                        }}
                      >
                        Prompt Matchup Details
                        <span
                          style={{
                            fontSize: "0.75rem",
                            color: "var(--muted)",
                            fontWeight: 400,
                          }}
                        >
                          ({headToHead.prompts.length} prompts evaluated)
                        </span>
                      </h4>
                    </div>

                    <div style={{ overflowX: "auto" }}>
                      <table
                        style={{
                          width: "100%",
                          borderCollapse: "collapse",
                          textAlign: "left",
                          fontSize: "0.875rem",
                        }}
                      >
                        <thead>
                          <tr
                            style={{
                              borderBottom: "1px solid var(--border)",
                              color: "var(--muted)",
                              fontSize: "0.8rem",
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Prompt
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Priority
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Outcome
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              {project.brandName} Rank
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              {headToHead.competitor.name} Rank
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Brand Vis
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Comp Vis
                            </th>
                            <th style={{ padding: "0.75rem 0.5rem" }}>
                              Engines
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {headToHead.prompts.map((p) => {
                            const isWin = p.outcome === "win";
                            const isLoss = p.outcome === "loss";

                            return (
                              <tr
                                key={p.promptId}
                                style={{
                                  borderBottom: "1px solid var(--border)",
                                }}
                              >
                                <td
                                  style={{
                                    padding: "0.85rem 0.5rem",
                                    maxWidth: "360px",
                                  }}
                                >
                                  <span
                                    style={{
                                      fontWeight: 500,
                                      display: "-webkit-box",
                                      WebkitLineClamp: 2,
                                      WebkitBoxOrient: "vertical",
                                      overflow: "hidden",
                                    }}
                                  >
                                    {p.promptText}
                                  </span>
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  <span
                                    style={{
                                      fontSize: "0.75rem",
                                      padding: "0.15rem 0.45rem",
                                      borderRadius: "4px",
                                      background: "rgba(255, 255, 255, 0.08)",
                                    }}
                                  >
                                    P{p.priority}
                                  </span>
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  <span
                                    style={{
                                      fontSize: "0.75rem",
                                      fontWeight: 700,
                                      padding: "0.2rem 0.55rem",
                                      borderRadius: "4px",
                                      background: isWin
                                        ? "rgba(16, 185, 129, 0.15)"
                                        : isLoss
                                          ? "rgba(239, 68, 68, 0.15)"
                                          : "rgba(156, 163, 175, 0.15)",
                                      color: isWin
                                        ? "#10b981"
                                        : isLoss
                                          ? "#ef4444"
                                          : "#9ca3af",
                                    }}
                                  >
                                    {p.outcome.toUpperCase()}
                                  </span>
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color:
                                        p.brandRank !== null
                                          ? "#10b981"
                                          : "var(--muted)",
                                    }}
                                  >
                                    {p.brandRank !== null
                                      ? `#${p.brandRank}`
                                      : "Not mentioned"}
                                  </span>
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  <span
                                    style={{
                                      fontWeight: 600,
                                      color:
                                        p.competitorRank !== null
                                          ? "#3b82f6"
                                          : "var(--muted)",
                                    }}
                                  >
                                    {p.competitorRank !== null
                                      ? `#${p.competitorRank}`
                                      : "Not mentioned"}
                                  </span>
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  {(p.brandVis * 100).toFixed(0)}%
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  {(p.competitorVis * 100).toFixed(0)}%
                                </td>
                                <td style={{ padding: "0.85rem 0.5rem" }}>
                                  <div
                                    style={{
                                      display: "flex",
                                      gap: "0.25rem",
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    {p.engines.map((eng) => (
                                      <span
                                        key={eng}
                                        style={{
                                          fontSize: "0.7rem",
                                          padding: "0.1rem 0.35rem",
                                          borderRadius: "3px",
                                          background:
                                            "rgba(255, 255, 255, 0.06)",
                                          color: "var(--muted)",
                                        }}
                                      >
                                        {eng}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : (
                <div
                  style={{
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  <Swords
                    size={36}
                    style={{ opacity: 0.4, marginBottom: "0.5rem" }}
                  />
                  <p>
                    Please select a competitor above to view the head-to-head
                    matchup.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: COMPETITIVE GAPS (CMP-FR-005, CMP-FR-012) */}
          {activeTab === "gaps" && (
            <section
              className="panel"
              style={{
                background: "var(--surface)",
                padding: "1.25rem",
                borderRadius: "12px",
                border: "1px solid var(--border)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "1rem",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 600,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    Competitive Visibility Gaps
                    <span
                      style={{
                        fontSize: "0.7rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "4px",
                        background: LABEL_COLORS.Modeled.bg,
                        color: LABEL_COLORS.Modeled.text,
                        fontWeight: 600,
                      }}
                    >
                      Modeled
                    </span>
                  </h3>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                      margin: "0.25rem 0 0 0",
                    }}
                  >
                    High-priority prompts where competitors are recommended by
                    AI engines while your brand is absent or trailing.
                  </p>
                </div>
              </div>

              {filteredGaps.length === 0 ? (
                <div
                  style={{
                    padding: "3rem",
                    textAlign: "center",
                    color: "var(--muted)",
                  }}
                >
                  <CheckCircle2
                    size={36}
                    style={{
                      color: "#10b981",
                      opacity: 0.8,
                      marginBottom: "0.5rem",
                    }}
                  />
                  <p style={{ fontWeight: 600, color: "var(--foreground)" }}>
                    No significant competitive gaps detected!
                  </p>
                  <p style={{ fontSize: "0.85rem" }}>
                    Your brand holds equal or superior visibility across
                    evaluated monitoring prompts.
                  </p>
                </div>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table
                    style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      textAlign: "left",
                      fontSize: "0.875rem",
                    }}
                  >
                    <thead>
                      <tr
                        style={{
                          borderBottom: "1px solid var(--border)",
                          color: "var(--muted)",
                          fontSize: "0.8rem",
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                        }}
                      >
                        <th style={{ padding: "0.75rem 0.5rem" }}>Prompt</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Priority</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Competitor Exploiting Gap
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Gap Score (0–100)
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Competitor Vis
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Brand Vis</th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>
                          Diagnostic Reason
                        </th>
                        <th style={{ padding: "0.75rem 0.5rem" }}>Engines</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGaps.map((gap, idx) => (
                        <tr
                          key={`${gap.promptId}-${gap.competitorId}-${idx}`}
                          style={{ borderBottom: "1px solid var(--border)" }}
                        >
                          <td
                            style={{
                              padding: "0.85rem 0.5rem",
                              maxWidth: "340px",
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 500,
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                              }}
                            >
                              {gap.promptText}
                            </span>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <span
                              style={{
                                fontSize: "0.75rem",
                                padding: "0.15rem 0.45rem",
                                borderRadius: "4px",
                                background: "rgba(255, 255, 255, 0.08)",
                              }}
                            >
                              P{gap.priority}
                            </span>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <span style={{ fontWeight: 600, color: "#3b82f6" }}>
                              {gap.competitorName}
                            </span>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "0.5rem",
                              }}
                            >
                              <div
                                style={{
                                  width: "50px",
                                  height: "6px",
                                  borderRadius: "3px",
                                  background: "rgba(255, 255, 255, 0.1)",
                                  overflow: "hidden",
                                }}
                              >
                                <div
                                  style={{
                                    width: `${Math.min(100, gap.gapScore)}%`,
                                    height: "100%",
                                    background:
                                      gap.gapScore > 50 ? "#ef4444" : "#f59e0b",
                                  }}
                                />
                              </div>
                              <span
                                style={{
                                  fontWeight: 700,
                                  color:
                                    gap.gapScore > 50 ? "#ef4444" : "#f59e0b",
                                }}
                              >
                                {gap.gapScore.toFixed(0)}
                              </span>
                            </div>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <span style={{ fontWeight: 600, color: "#3b82f6" }}>
                              {(gap.competitorVis * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <span
                              style={{
                                fontWeight: 600,
                                color:
                                  gap.brandVis === 0
                                    ? "#ef4444"
                                    : "var(--foreground)",
                              }}
                            >
                              {(gap.brandVis * 100).toFixed(0)}%
                            </span>
                          </td>
                          <td
                            style={{
                              padding: "0.85rem 0.5rem",
                              maxWidth: "240px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--muted)",
                              }}
                            >
                              {gap.reasons.join("; ") || "Competitive deficit"}
                            </span>
                          </td>
                          <td style={{ padding: "0.85rem 0.5rem" }}>
                            <div
                              style={{
                                display: "flex",
                                gap: "0.25rem",
                                flexWrap: "wrap",
                              }}
                            >
                              {gap.engines.map((eng) => (
                                <span
                                  key={eng}
                                  style={{
                                    fontSize: "0.7rem",
                                    padding: "0.1rem 0.35rem",
                                    borderRadius: "3px",
                                    background: "rgba(255, 255, 255, 0.06)",
                                    color: "var(--muted)",
                                  }}
                                >
                                  {eng}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {activeTab === "trends" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              <section
                className="panel"
                style={{
                  background: "var(--surface)",
                  padding: "1.25rem",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                }}
              >
                <div style={{ marginBottom: "1rem" }}>
                  <h3
                    style={{ margin: 0, fontSize: "1.1rem", fontWeight: 650 }}
                  >
                    Visibility Trends &amp; Reports
                  </h3>
                  <p
                    style={{
                      margin: "0.35rem 0 0",
                      color: "var(--muted)",
                      fontSize: "0.875rem",
                    }}
                  >
                    Compare visibility and share of voice with the preceding
                    period using the active filters.
                  </p>
                </div>

                {!comparePrevious ? (
                  <div className="competitor-trends-empty">
                    <TrendingUp size={28} />
                    <p>
                      Enable period comparison to see how visibility changed.
                    </p>
                    <button
                      className="button primary"
                      onClick={() => setComparePrevious(true)}
                    >
                      Compare to previous period
                    </button>
                  </div>
                ) : previousLeaderboard.length === 0 ? (
                  <div className="competitor-trends-empty">
                    <p>
                      No observations were available in the previous period for
                      these filters.
                    </p>
                  </div>
                ) : (
                  <>
                    {(() => {
                      const brandNow = leaderboard.find((item) => item.isBrand);
                      const brandBefore = previousLeaderboard.find(
                        (item) => item.isBrand,
                      );
                      const visibilityDelta =
                        brandNow && brandBefore
                          ? (brandNow.visibilityRate -
                              brandBefore.visibilityRate) *
                            100
                          : null;
                      const shareDelta =
                        brandNow && brandBefore
                          ? brandNow.shareOfVoice - brandBefore.shareOfVoice
                          : null;
                      return (
                        <div className="competitor-trend-metrics">
                          <article className="competitor-trend-metric">
                            <span>Brand visibility</span>
                            <strong>
                              {brandNow
                                ? `${(brandNow.visibilityRate * 100).toFixed(1)}%`
                                : "—"}
                            </strong>
                            <small>
                              {visibilityDelta === null
                                ? "No previous value"
                                : `${visibilityDelta >= 0 ? "+" : ""}${visibilityDelta.toFixed(1)} percentage points`}
                            </small>
                          </article>
                          <article className="competitor-trend-metric">
                            <span>Share of voice</span>
                            <strong>
                              {brandNow
                                ? `${brandNow.shareOfVoice.toFixed(1)}%`
                                : "—"}
                            </strong>
                            <small>
                              {shareDelta === null
                                ? "No previous value"
                                : `${shareDelta >= 0 ? "+" : ""}${shareDelta.toFixed(1)} points vs previous`}
                            </small>
                          </article>
                          <article className="competitor-trend-metric">
                            <span>Comparison period</span>
                            <strong>
                              {isCustomRange && customRange
                                ? "Custom"
                                : `${days} days`}
                            </strong>
                            <small>Current period vs preceding period</small>
                          </article>
                        </div>
                      );
                    })()}
                    <div className="competitor-trends-list">
                      <h4>Competitor visibility comparison</h4>
                      {filteredLeaderboard.filter((item) => !item.isBrand).length === 0 ? (
                        <p className="competitor-trends-empty">
                          No competitors match the active filters.
                        </p>
                      ) : (
                        <>
                          <div className="competitor-trend-legend">
                            <span>
                              <i className="previous" /> Previous period
                            </span>
                            <span>
                              <i className="current" /> Current period
                            </span>
                          </div>
                          {filteredLeaderboard
                            .filter((item) => !item.isBrand)
                            .map((item) => {
                              const previous = filteredPreviousLeaderboard.find(
                                (entry) => entry.entityId === item.entityId,
                              );
                              const delta = previous
                                ? (item.visibilityRate -
                                    previous.visibilityRate) *
                                  100
                                : null;
                              return (
                                <div
                                  className="competitor-trend-row"
                                  key={item.entityId}
                                >
                                  <div className="competitor-trend-name">
                                    <strong>{item.name}</strong>
                                    <span>
                                      {previous
                                        ? `${(previous.visibilityRate * 100).toFixed(1)}% previous`
                                        : "No previous observation"}
                                    </span>
                                  </div>
                                  <div
                                    className="competitor-trend-bars"
                                    aria-label={`${item.name}: previous and current visibility`}
                                  >
                                    <div className="competitor-trend-bar">
                                      <div
                                        className="competitor-trend-bar-previous"
                                        style={{
                                          width: `${Math.min(100, (previous?.visibilityRate || 0) * 100)}%`,
                                        }}
                                      />
                                    </div>
                                    <div className="competitor-trend-bar">
                                      <div
                                        className="competitor-trend-bar-current"
                                        style={{
                                          width: `${Math.min(100, item.visibilityRate * 100)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <strong>
                                    {(item.visibilityRate * 100).toFixed(1)}%
                                  </strong>
                                  <span
                                    className={`competitor-trend-delta${delta === null ? "" : delta >= 0 ? " positive" : " negative"}`}
                                  >
                                    {delta === null
                                      ? "—"
                                      : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pp`}
                                  </span>
                                </div>
                              );
                            })}
                        </>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          )}

          {/* TAB 5: COMPETITOR AUTO-DISCOVERY (CMP-FR-010, CMP-FR-016) */}
          {activeTab === "candidates" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              {/* Scan Trigger Header */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "1rem",
                  background: "var(--surface)",
                  padding: "1.25rem",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 600,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    <Sparkles size={18} style={{ color: "var(--accent)" }} />
                    Automated Competitor Discovery (Feature CMP-F1)
                  </h3>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                      margin: "0.25rem 0 0 0",
                    }}
                  >
                    AI scans mention entities across all answers. Entities
                    appearing in ≥ 10% of runs are surfaced for evaluation.
                  </p>
                </div>

                <button
                  className="button primary"
                  disabled={scanning}
                  onClick={handleRunDiscovery}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    cursor: scanning ? "not-allowed" : "pointer",
                  }}
                >
                  {scanning ? (
                    <>
                      <LoaderCircle size={16} className="spin" />
                      Scanning Answers...
                    </>
                  ) : (
                    <>
                      <RefreshCw size={16} />
                      Run Discovery Scan
                    </>
                  )}
                </button>
              </div>

              {/* Status Filter Tabs */}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {[
                  { id: "suggested", label: "Suggested Candidates" },
                  { id: "accepted", label: "Accepted" },
                  { id: "rejected", label: "Rejected (90d Cooldown)" },
                  { id: "snoozed", label: "Snoozed (30d)" },
                ].map((s) => (
                  <button
                    key={s.id}
                    onClick={() =>
                      setCandidateStatusFilter(s.id as CandidateStatus)
                    }
                    style={{
                      padding: "0.4rem 0.8rem",
                      borderRadius: "6px",
                      border: "1px solid var(--border)",
                      background:
                        candidateStatusFilter === s.id
                          ? "var(--accent)"
                          : "transparent",
                      color:
                        candidateStatusFilter === s.id
                          ? "#ffffff"
                          : "var(--foreground)",
                      fontSize: "0.85rem",
                      cursor: "pointer",
                      fontWeight: candidateStatusFilter === s.id ? 600 : 500,
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>

              {/* Candidates Grid / List */}
              {candidates.length === 0 ? (
                <div
                  style={{
                    padding: "3.5rem",
                    textAlign: "center",
                    color: "var(--muted)",
                    background: "var(--surface)",
                    borderRadius: "12px",
                    border: "1px solid var(--border)",
                  }}
                >
                  <Sparkles
                    size={36}
                    style={{ opacity: 0.4, marginBottom: "0.5rem" }}
                  />
                  <p style={{ fontWeight: 600, color: "var(--foreground)" }}>
                    No {candidateStatusFilter} candidates found.
                  </p>
                  <p style={{ fontSize: "0.85rem" }}>
                    Click &ldquo;Run Discovery Scan&rdquo; above to extract
                    fresh candidates from recent answer collection runs.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(min(100%, 320px), 1fr))",
                    gap: "1rem",
                  }}
                >
                  {candidates.map((cand) => (
                    <div
                      key={cand.id}
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: "1.05rem",
                                fontWeight: 700,
                              }}
                            >
                              {cand.name}
                            </h4>
                            {cand.domain && (
                              <span
                                style={{
                                  fontSize: "0.8rem",
                                  color: "var(--muted)",
                                }}
                              >
                                {cand.domain}
                              </span>
                            )}
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.2rem 0.5rem",
                              borderRadius: "12px",
                              background: "rgba(59, 130, 246, 0.12)",
                              color: "#3b82f6",
                              fontWeight: 600,
                            }}
                          >
                            {(cand.mentionFrequency * 100).toFixed(0)}% of runs
                          </span>
                        </div>

                        <div
                          style={{
                            marginTop: "0.85rem",
                            display: "flex",
                            flexDirection: "column",
                            gap: "0.4rem",
                            fontSize: "0.8rem",
                            color: "var(--muted)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>Entity Classification:</span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: "var(--foreground)",
                              }}
                            >
                              {ENTITY_TYPE_LABELS[cand.entityType] ||
                                cand.entityType}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>Total Mentions:</span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: "var(--foreground)",
                              }}
                            >
                              {cand.mentionCount}
                            </span>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <span>Co-occurred with Brand:</span>
                            <span
                              style={{
                                fontWeight: 600,
                                color: "var(--foreground)",
                              }}
                            >
                              {cand.coOccurrenceCount} runs
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Actions */}
                      {cand.status === "suggested" && (
                        <div
                          style={{
                            display: "flex",
                            gap: "0.5rem",
                            borderTop: "1px solid var(--border)",
                            paddingTop: "0.75rem",
                          }}
                        >
                          <button
                            className="button primary"
                            onClick={() =>
                              handleAcceptCandidate(cand.id, cand.name)
                            }
                            style={{
                              flex: 1,
                              padding: "0.4rem 0.6rem",
                              fontSize: "0.8rem",
                              fontWeight: 600,
                              borderRadius: "6px",
                              cursor: "pointer",
                            }}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            className="button"
                            disabled={isCustomRange && !customRange}
                            onClick={() =>
                              handleSnoozeCandidate(cand.id, cand.name)
                            }
                            title="Snooze for 30 days"
                            style={{
                              padding: "0.4rem 0.6rem",
                              fontSize: "0.8rem",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                              background: "transparent",
                              cursor: "pointer",
                            }}
                          >
                            Snooze 30d
                          </button>
                          <button
                            className="button"
                            onClick={() =>
                              handleRejectCandidate(cand.id, cand.name)
                            }
                            title="Reject entity (90-day cooldown)"
                            style={{
                              padding: "0.4rem 0.6rem",
                              fontSize: "0.8rem",
                              borderRadius: "6px",
                              border: "1px solid var(--border)",
                              background: "transparent",
                              color: "#ef4444",
                              cursor: "pointer",
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 6: MANAGE COMPETITORS (CMP-FR-001, CMP-FR-008) */}
          {activeTab === "manage" && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1.25rem",
              }}
            >
              {/* Header with Plan Limit Banner */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  flexWrap: "wrap",
                  gap: "1rem",
                  background: "var(--surface)",
                  padding: "1.25rem",
                  borderRadius: "12px",
                  border: "1px solid var(--border)",
                }}
              >
                <div>
                  <h3
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 600,
                      margin: 0,
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                    }}
                  >
                    Tracked Competitor Management
                  </h3>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      color: "var(--muted)",
                      margin: "0.25rem 0 0 0",
                    }}
                  >
                    You are tracking <b>{competitors.length}</b> of{" "}
                    <b>25 maximum competitors</b> allowed by your plan
                    (CMP-FR-001).
                  </p>
                </div>

                <button
                  className="button primary"
                  disabled={competitors.length >= 25}
                  onClick={() => setShowAddModal(true)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    padding: "0.5rem 1rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    cursor:
                      competitors.length >= 25 ? "not-allowed" : "pointer",
                  }}
                >
                  <Plus size={16} /> Add Competitor
                </button>
              </div>

              {/* Competitors List */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    "repeat(auto-fill, minmax(min(100%, 340px), 1fr))",
                  gap: "1rem",
                }}
              >
                {filteredCompetitors.map((comp) => {
                  const typeBadge = COMPETITOR_TYPE_BADGES[comp.competitorType];

                  return (
                    <div
                      key={comp.id}
                      style={{
                        background: "var(--surface)",
                        padding: "1.25rem",
                        borderRadius: "12px",
                        border: "1px solid var(--border)",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "space-between",
                        gap: "1rem",
                      }}
                    >
                      <div>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <div>
                            <h4
                              style={{
                                margin: 0,
                                fontSize: "1.1rem",
                                fontWeight: 700,
                              }}
                            >
                              {comp.name}
                            </h4>
                            <a
                              href={`https://${comp.domain}`}
                              target="_blank"
                              rel="noreferrer"
                              style={{
                                fontSize: "0.8rem",
                                color: "var(--accent)",
                                textDecoration: "none",
                                display: "inline-flex",
                                alignItems: "center",
                                gap: "0.25rem",
                                marginTop: "0.2rem",
                              }}
                            >
                              {comp.domain} <ExternalLink size={11} />
                            </a>
                          </div>
                          <span
                            style={{
                              fontSize: "0.75rem",
                              padding: "0.2rem 0.5rem",
                              borderRadius: "12px",
                              background: typeBadge.bg,
                              color: typeBadge.text,
                              border: `1px solid ${typeBadge.border}`,
                              fontWeight: 500,
                            }}
                          >
                            {typeBadge.label}
                          </span>
                        </div>

                        {comp.rationale && (
                          <p
                            style={{
                              fontSize: "0.8rem",
                              color: "var(--muted)",
                              margin: "0.75rem 0 0 0",
                              fontStyle: "italic",
                            }}
                          >
                            &ldquo;{comp.rationale}&rdquo;
                          </p>
                        )}

                        {/* Aliases */}
                        {comp.aliases && comp.aliases.length > 0 && (
                          <div
                            style={{
                              marginTop: "0.75rem",
                              display: "flex",
                              gap: "0.35rem",
                              flexWrap: "wrap",
                            }}
                          >
                            {comp.aliases.map((al) => (
                              <span
                                key={al}
                                style={{
                                  fontSize: "0.7rem",
                                  padding: "0.15rem 0.4rem",
                                  borderRadius: "4px",
                                  background: "rgba(255, 255, 255, 0.06)",
                                  color: "var(--muted)",
                                }}
                              >
                                {al}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Quick Metrics */}
                        <div
                          style={{
                            marginTop: "1rem",
                            display: "grid",
                            gridTemplateColumns: "1fr 1fr",
                            gap: "0.5rem",
                            padding: "0.75rem",
                            borderRadius: "8px",
                            background: "rgba(255, 255, 255, 0.03)",
                            fontSize: "0.8rem",
                          }}
                        >
                          <div>
                            <span style={{ color: "var(--muted)" }}>
                              Visibility:
                            </span>{" "}
                            <b>
                              {(comp.metrics.visibilityRate * 100).toFixed(1)}%
                            </b>
                          </div>
                          <div>
                            <span style={{ color: "var(--muted)" }}>
                              Citations:
                            </span>{" "}
                            <b>{comp.metrics.citationsCount}</b>
                          </div>
                          <div>
                            <span style={{ color: "var(--muted)" }}>
                              Avg Rank:
                            </span>{" "}
                            <b>
                              {comp.metrics.avgPosition > 0
                                ? `#${comp.metrics.avgPosition.toFixed(1)}`
                                : "—"}
                            </b>
                          </div>
                          <div>
                            <span style={{ color: "var(--muted)" }}>
                              H2H Record:
                            </span>{" "}
                            <b>
                              {comp.metrics.headToHead.wins}W -{" "}
                              {comp.metrics.headToHead.losses}L
                            </b>
                          </div>
                        </div>
                      </div>

                      {/* Card Actions */}
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          borderTop: "1px solid var(--border)",
                          paddingTop: "0.75rem",
                        }}
                      >
                        <button
                          className="button"
                          onClick={() => {
                            setEditingCompetitor(comp);
                            setEditType(comp.competitorType);
                            setEditAliases((comp.aliases || []).join(", "));
                            setEditRationale(comp.rationale || "");
                          }}
                          style={{
                            padding: "0.35rem 0.65rem",
                            fontSize: "0.8rem",
                            borderRadius: "6px",
                            border: "1px solid var(--border)",
                            background: "transparent",
                            cursor: "pointer",
                          }}
                        >
                          Edit Details
                        </button>

                        <button
                          className="button"
                          onClick={() =>
                            handleDeleteCompetitor(comp.id, comp.name)
                          }
                          style={{
                            padding: "0.35rem 0.65rem",
                            fontSize: "0.8rem",
                            borderRadius: "6px",
                            border: "none",
                            background: "transparent",
                            color: "#ef4444",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.3rem",
                          }}
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: ADD COMPETITOR (CMP-FR-001, CMP-FR-008) */}
      {showAddModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 100,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              border: "1px solid var(--border)",
              maxWidth: "500px",
              width: "100%",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
              boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>
                Add Tracked Competitor
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleCreateCompetitor}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Competitor Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. ApexScale"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
                {AMBIGUOUS_NAMES.has(addName.trim().toLowerCase()) && (
                  <p
                    style={{
                      fontSize: "0.75rem",
                      color: "#f59e0b",
                      marginTop: "0.35rem",
                    }}
                  >
                    Note: &ldquo;{addName.trim()}&rdquo; is a common word. Exact
                    domain matching will be enforced to prevent false positive
                    mentions (CMP-FR-008).
                  </p>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Domain *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. apexscale.com"
                  value={addDomain}
                  onChange={(e) => setAddDomain(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Competitor Type
                </label>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value as CompetitorType)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                >
                  <option value="direct">Direct Competitor</option>
                  <option value="indirect">Indirect Alternative</option>
                  <option value="aspirational">Aspirational Leader</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Aliases (comma-separated)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Apex Scale, ApexScale AI"
                  value={addAliases}
                  onChange={(e) => setAddAliases(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Strategic Rationale (optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Why track this competitor?"
                  value={addRationale}
                  onChange={(e) => setAddRationale(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                    resize: "none",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                }}
              >
                <button
                  type="button"
                  className="button"
                  onClick={() => setShowAddModal(false)}
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
                  className="button primary"
                  disabled={isSubmitting}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmitting ? "Adding..." : "Add Competitor"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT COMPETITOR */}
      {editingCompetitor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0, 0, 0, 0.7)",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 100,
            padding: "1rem",
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              borderRadius: "14px",
              border: "1px solid var(--border)",
              maxWidth: "500px",
              width: "100%",
              padding: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.15rem", fontWeight: 700 }}>
                Edit {editingCompetitor.name}
              </h3>
              <button
                onClick={() => setEditingCompetitor(null)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                }}
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={handleUpdateCompetitor}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Competitor Type
                </label>
                <select
                  value={editType}
                  onChange={(e) =>
                    setEditType(e.target.value as CompetitorType)
                  }
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                >
                  <option value="direct">Direct Competitor</option>
                  <option value="indirect">Indirect Alternative</option>
                  <option value="aspirational">Aspirational Leader</option>
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Aliases (comma-separated)
                </label>
                <input
                  type="text"
                  value={editAliases}
                  onChange={(e) => setEditAliases(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    fontSize: "0.85rem",
                    fontWeight: 600,
                    marginBottom: "0.35rem",
                  }}
                >
                  Strategic Rationale
                </label>
                <textarea
                  rows={2}
                  value={editRationale}
                  onChange={(e) => setEditRationale(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "0.55rem 0.85rem",
                    borderRadius: "8px",
                    border: "1px solid var(--border)",
                    background: "rgba(255, 255, 255, 0.04)",
                    color: "inherit",
                    fontSize: "0.9rem",
                    resize: "none",
                  }}
                />
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  gap: "0.75rem",
                  marginTop: "0.5rem",
                }}
              >
                <button
                  type="button"
                  className="button"
                  onClick={() => setEditingCompetitor(null)}
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
                  className="button primary"
                  disabled={isSubmitting}
                  style={{
                    padding: "0.5rem 1.25rem",
                    borderRadius: "8px",
                    fontWeight: 600,
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}
                >
                  {isSubmitting ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
