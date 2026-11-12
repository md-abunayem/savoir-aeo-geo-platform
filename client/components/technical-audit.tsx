"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  FileCode,
  Globe,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type {
  Project,
  TechnicalAuditRecord,
  TechnicalAuditPageItem,
  TechnicalAuditIssueItem,
  TechnicalGrade,
  TechnicalAuditSchedule,
} from "../lib/types";

const GRADE_STYLES: Record<TechnicalGrade, { color: string; label: string }> = {
  A: { color: "excellent", label: "Leader" },
  B: { color: "good", label: "Strong" },
  C: { color: "moderate", label: "Moderate" },
  D: { color: "at-risk", label: "At risk" },
  F: { color: "critical", label: "Critical gaps" },
};

const SCORE_CATEGORIES = [
  {
    key: "botAccess",
    label: "Declared bot permissions",
    weight: 25,
    icon: Bot,
  },
  { key: "indexability", label: "Indexability", weight: 25, icon: Globe },
  { key: "schema", label: "Structured data", weight: 20, icon: FileCode },
  { key: "answerStructure", label: "Answer structure", weight: 15, icon: Zap },
  {
    key: "performanceTrust",
    label: "Response time",
    weight: 10,
    icon: ShieldCheck,
  },
  { key: "agentReadability", label: "Discovery", weight: 5, icon: Sparkles },
] as const;

const formatCount = (value: number | null | undefined) =>
  value === null || value === undefined ? "—" : value.toLocaleString();

const formatDate = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

function botStatusLabel(status: string, legacy: boolean) {
  if (legacy) return `Legacy result: ${status}`;
  if (status === "declared_allowed") return "No root restriction declared";
  if (status === "declared_partial") return "Some paths restricted";
  if (status === "declared_disallowed") return "Root disallowed";
  return "Unknown";
}

function botStatusClass(status: string) {
  if (status === "declared_allowed" || status === "allowed") return "allowed";
  if (status === "declared_partial" || status === "partial") return "partial";
  if (status === "declared_disallowed" || status === "disallowed")
    return "disallowed";
  return "unknown";
}

export function TechnicalAudit({ project }: { project: Project }) {
  const [audit, setAudit] = useState<TechnicalAuditRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runPending, setRunPending] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<
    "overview" | "bots" | "issues" | "pages"
  >("overview");
  const [issues, setIssues] = useState<TechnicalAuditIssueItem[]>([]);
  const [loadingIssues, setLoadingIssues] = useState(false);
  const [issuesError, setIssuesError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [findingTypeFilter, setFindingTypeFilter] = useState("all");
  const [issueSearch, setIssueSearch] = useState("");
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);
  const [pages, setPages] = useState<TechnicalAuditPageItem[]>([]);
  const [pagesTotal, setPagesTotal] = useState(0);
  const [loadingPages, setLoadingPages] = useState(false);
  const [pagesError, setPagesError] = useState<string | null>(null);
  const [pageSearch, setPageSearch] = useState("");
  const [history, setHistory] = useState<TechnicalAuditRecord[]>([]);
  const [schedule, setSchedule] = useState<TechnicalAuditSchedule | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] =
    useState<TechnicalAuditSchedule["frequency"]>("weekly");
  const [schedulePending, setSchedulePending] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  const basePath = `/v1/tenants/${project.tenantId}/projects/${project.id}/technical`;
  const auditId = audit?.projectId === project.id ? audit.id : undefined;
  const issueExportHref = () => {
    const params = new URLSearchParams({ type: "issues" });
    if (findingTypeFilter !== "all")
      params.set("findingType", findingTypeFilter);
    if (severityFilter !== "all") params.set("severity", severityFilter);
    if (categoryFilter !== "all") params.set("category", categoryFilter);
    if (issueSearch.trim()) params.set("search", issueSearch.trim());
    return `${basePath}/audits/${auditId}/export?${params.toString()}`;
  };

  useEffect(() => {
    let ignore = false;
    async function loadLatest() {
      try {
        const data = await api.request<TechnicalAuditRecord | null>(
          `${basePath}/audits/latest`,
        );
        if (!ignore) {
          setAudit(data);
          setError(null);
          setRunPending(
            data?.status === "pending" || data?.status === "running",
          );
        }
      } catch (err) {
        if (!ignore)
          setError(
            err instanceof Error
              ? err.message
              : "Failed to load technical audit.",
          );
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    void loadLatest();
    return () => {
      ignore = true;
    };
  }, [basePath, refreshKey]);

  useEffect(() => {
    let ignore = false;
    async function loadHistoryAndSchedule() {
      try {
        const [auditHistory, auditSchedule] = await Promise.all([
          api.request<TechnicalAuditRecord[]>(`${basePath}/audits?limit=2`),
          api.request<TechnicalAuditSchedule | null>(
            `${basePath}/audits/schedule`,
          ),
        ]);
        if (!ignore) {
          setHistory(Array.isArray(auditHistory) ? auditHistory : []);
          if (auditSchedule && !Array.isArray(auditSchedule)) {
            setSchedule(auditSchedule);
            setScheduleFrequency(auditSchedule.frequency);
          } else {
            setSchedule(null);
          }
        }
      } catch {
        if (!ignore) setScheduleError("Could not load audit history or schedule.");
      }
    }

    void loadHistoryAndSchedule();
    return () => {
      ignore = true;
    };
  }, [basePath, refreshKey]);

  useEffect(() => {
    if (
      !runPending &&
      audit?.status !== "pending" &&
      audit?.status !== "running"
    )
      return;
    const timer = window.setInterval(
      () => setRefreshKey((key) => key + 1),
      2000,
    );
    return () => window.clearInterval(timer);
  }, [audit?.status, runPending]);

  useEffect(() => {
    if (!auditId || (activeTab !== "issues" && activeTab !== "overview"))
      return;
    let ignore = false;

    async function fetchIssues() {
      setLoadingIssues(true);
      setIssuesError(null);
      try {
        const params = new URLSearchParams();
        if (severityFilter !== "all") params.set("severity", severityFilter);
        if (categoryFilter !== "all") params.set("category", categoryFilter);
        if (findingTypeFilter !== "all")
          params.set("findingType", findingTypeFilter);
        if (issueSearch.trim()) params.set("search", issueSearch.trim());
        const data = await api.request<TechnicalAuditIssueItem[]>(
          `${basePath}/audits/${auditId}/issues?${params.toString()}`,
        );
        if (!ignore) setIssues(data || []);
      } catch (err) {
        if (!ignore)
          setIssuesError(
            err instanceof Error ? err.message : "Could not load audit issues.",
          );
      } finally {
        if (!ignore) setLoadingIssues(false);
      }
    }

    void fetchIssues();
    return () => {
      ignore = true;
    };
  }, [
    auditId,
    basePath,
    severityFilter,
    categoryFilter,
    findingTypeFilter,
    issueSearch,
    activeTab,
    refreshKey,
  ]);

  useEffect(() => {
    if (!auditId || (activeTab !== "pages" && activeTab !== "overview")) return;
    let ignore = false;

    async function fetchPages() {
      setLoadingPages(true);
      setPagesError(null);
      try {
        const params = new URLSearchParams({ limit: "1000" });
        if (pageSearch.trim()) params.set("search", pageSearch.trim());
        const data = await api.request<{
          pages: TechnicalAuditPageItem[];
          total: number;
        }>(`${basePath}/audits/${auditId}/pages?${params.toString()}`);
        if (!ignore) {
          setPages(data?.pages || []);
          setPagesTotal(data?.total || 0);
        }
      } catch (err) {
        if (!ignore)
          setPagesError(
            err instanceof Error
              ? err.message
              : "Could not load crawled pages.",
          );
      } finally {
        if (!ignore) setLoadingPages(false);
      }
    }

    void fetchPages();
    return () => {
      ignore = true;
    };
  }, [auditId, basePath, pageSearch, activeTab, refreshKey]);

  const handleTriggerAudit = async () => {
    setTriggering(true);
    setError(null);
    try {
      await api.request(`${basePath}/audits`, {
        method: "POST",
        body: { crawlType: "full_site", pagesLimit: 500 },
      });
      setRunPending(true);
      setRefreshKey((key) => key + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Failed to start technical audit.",
      );
    } finally {
      setTriggering(false);
    }
  };

  const handleSaveSchedule = async () => {
    setSchedulePending(true);
    setScheduleError(null);
    try {
      const saved = await api.request<TechnicalAuditSchedule>(
        `${basePath}/audits/schedule`,
        { method: "PUT", body: { frequency: scheduleFrequency } },
      );
      setSchedule(saved);
      setScheduleDialogOpen(false);
    } catch (err) {
      setScheduleError(
        err instanceof Error ? err.message : "Could not save audit schedule.",
      );
    } finally {
      setSchedulePending(false);
    }
  };

  const handleDeleteSchedule = async () => {
    setSchedulePending(true);
    setScheduleError(null);
    try {
      await api.request(`${basePath}/audits/schedule`, { method: "DELETE" });
      setSchedule(null);
      setScheduleDialogOpen(false);
    } catch (err) {
      setScheduleError(
        err instanceof Error ? err.message : "Could not remove audit schedule.",
      );
    } finally {
      setSchedulePending(false);
    }
  };

  const handleIssueStatus = async (
    issueId: string,
    status: TechnicalAuditIssueItem["status"],
  ) => {
    if (!auditId) return;
    setIssuesError(null);
    try {
      await api.request(
        `${basePath}/audits/${auditId}/issues/${issueId}`,
        { method: "PATCH", body: { status } },
      );
      setIssues((current) =>
        current.map((issue) =>
          issue.id === issueId ? { ...issue, status } : issue,
        ),
      );
    } catch (err) {
      setIssuesError(
        err instanceof Error ? err.message : "Could not update this finding.",
      );
    }
  };

  const handleCopySnippet = async (id: string, snippet: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopiedSnippetId(id);
      window.setTimeout(() => setCopiedSnippetId(null), 2000);
    } catch {
      setError(
        "Clipboard access is unavailable. Select and copy the suggested text manually.",
      );
    }
  };

  if (loading || (audit !== null && audit.projectId !== project.id)) {
    return (
      <div className="audit-loading" role="status" aria-live="polite">
        <LoaderCircle className="spin" size={24} aria-hidden="true" />
        <span>Loading the latest technical audit…</span>
      </div>
    );
  }

  const gradeInfo = audit ? GRADE_STYLES[audit.grade] : null;
  const bots = Object.values(audit?.botMatrix?.bots ?? {});
  const isRunning =
    triggering ||
    runPending ||
    audit?.status === "pending" ||
    audit?.status === "running";
  const scoreUnavailable =
    audit?.status === "failed" ||
    audit?.status === "pending" ||
    audit?.status === "running" ||
    triggering ||
    runPending;

  return (
    <section
      className="technical-audit"
      aria-labelledby="technical-audit-title"
    >
      <header className="audit-header">
        <div>
          <p className="audit-eyebrow">TECHNICAL SITE AUDIT</p>
          <h1 id="technical-audit-title">Technical Audit</h1>
          <p className="audit-description">
            Review crawl declarations, public page quality, structured data, and
            discovery signals for <strong>{project.domain}</strong>.
          </p>
        </div>
        <div className="audit-actions">
          {audit && (
            <a
              className="button"
              href={issueExportHref()}
              aria-label="Export audit issues as CSV"
            >
              <Download size={15} aria-hidden="true" />
              Export issues
            </a>
          )}
          <button
            type="button"
            className="button"
            onClick={() => {
              setScheduleFrequency(schedule?.frequency ?? "weekly");
              setScheduleDialogOpen(true);
            }}
          >
            <CalendarDays size={15} aria-hidden="true" />
            Schedule audits
          </button>
          <button
            type="button"
            className="button"
            onClick={() => setRefreshKey((key) => key + 1)}
            disabled={isRunning}
            aria-label="Refresh technical audit"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh
          </button>
          <button
            type="button"
            className="button primary"
            onClick={handleTriggerAudit}
            disabled={isRunning}
          >
            {isRunning ? (
              <LoaderCircle className="spin" size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {isRunning
              ? "Audit running"
              : audit
                ? "Run new audit"
                : "Run audit"}
          </button>
        </div>
      </header>

      {error && (
        <div className="audit-alert audit-alert-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{error}</span>
          {!audit && (
            <button
              type="button"
              className="text-button"
              onClick={() => setRefreshKey((key) => key + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
      {scheduleError && !scheduleDialogOpen && (
        <div className="audit-alert audit-alert-error" role="alert">
          <AlertCircle size={18} aria-hidden="true" />
          <span>{scheduleError}</span>
        </div>
      )}

      {!audit ? (
        <div className="audit-empty">
          <span className="audit-empty-icon">
            <Globe size={25} aria-hidden="true" />
          </span>
          <h2>
            {error ? "Audit could not be loaded" : "No technical audit yet"}
          </h2>
          <p>
            Start a crawl to check public pages, canonical URLs, structured
            data, and declared robots.txt permissions.
          </p>
          {!error && (
            <button
              type="button"
              className="button primary"
              onClick={handleTriggerAudit}
              disabled={isRunning}
            >
              <Play size={15} aria-hidden="true" />
              Start technical audit
            </button>
          )}
        </div>
      ) : (
        <>
          {(audit.status === "pending" ||
            audit.status === "running" ||
            isRunning) && (
            <div
              className="audit-alert audit-alert-running"
              role="status"
              aria-live="polite"
            >
              <LoaderCircle className="spin" size={18} aria-hidden="true" />
              <span>
                The crawl is running. Results refresh automatically as the audit
                completes.
              </span>
            </div>
          )}
          {audit.status === "partial" && (
            <div className="audit-alert audit-alert-warning" role="status">
              <AlertCircle size={18} aria-hidden="true" />
              <span>
                {audit.completionReason ||
                  "The audit completed with incomplete crawl evidence."}
              </span>
            </div>
          )}
          {audit.status === "failed" && (
            <div className="audit-alert audit-alert-error" role="alert">
              <AlertCircle size={18} aria-hidden="true" />
              <span>
                {audit.errorMessage ||
                  audit.completionReason ||
                  "No usable public pages were collected; no audit score is available."}
              </span>
            </div>
          )}
          {audit.scoringVersion < 3 && (
            <div className="audit-alert audit-alert-warning" role="status">
              <AlertCircle size={18} aria-hidden="true" />
              <span>
                This is a historical scoring v{audit.scoringVersion} result. It
                has been preserved; run a new audit to calculate the current
                score and classifications.
              </span>
            </div>
          )}

          <section className="audit-summary" aria-label="Audit summary">
            <div className="audit-summary-main">
              <div className={`audit-grade ${gradeInfo?.color ?? ""}`}>
                {scoreUnavailable ? (
                  <>
                    <span className="audit-grade-value">—</span>
                    <span className="audit-grade-caption">
                      {audit.status === "failed" ? "Not scored" : "In progress"}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="audit-grade-value">{audit.grade}</span>
                    <span className="audit-grade-caption">
                      {audit.overallScore}/100
                    </span>
                  </>
                )}
              </div>
              <div className="audit-summary-copy">
                <div className="audit-summary-topline">
                  <span className={`audit-status status-${audit.status}`}>
                    {audit.status}
                  </span>
                  <span>{audit.targetDomain}</span>
                  <span>Scoring v{audit.scoringVersion}</span>
                </div>
                <h2>
                  {audit.status === "failed"
                    ? "Audit needs another attempt"
                    : isRunning
                      ? "Audit in progress"
                      : `${gradeInfo?.label ?? "Technical"} technical readiness`}
                </h2>
                <p>
                  {audit.pagesScored === null
                    ? "Crawl details are not available for this historical result."
                    : `${formatCount(audit.pagesScored)} public pages included in the score; utility pages are excluded.`}
                </p>
              </div>
            </div>
            <div
              className="audit-summary-severity"
              aria-label="Issues by severity"
            >
              <strong>Issues by severity</strong>
              <div className="audit-issue-counts">
                {(["critical", "high", "medium", "low", "info"] as const).map(
                  (severity) => (
                    <div className={`audit-count ${severity}`} key={severity}>
                      <strong>{audit.issuesSummary[severity]}</strong>
                      <span>{severity}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          </section>

          <section className="audit-crawl-stats" aria-label="Crawl results">
            {[
              ["Attempted URLs", audit.attemptedUrls],
              ["Fetched pages", audit.fetchedPages],
              ["Failed requests", audit.failedRequests],
              ["HTTP errors", audit.httpErrorPages],
              ["Excluded pages", audit.excludedPages],
              ["Queued URLs remaining", audit.queuedUrlsRemaining],
            ].map(([label, count]) => (
              <div className="audit-crawl-stat" key={label as string}>
                <span>{label}</span>
                <strong>{formatCount(count as number | null)}</strong>
              </div>
            ))}
          </section>

          <div className="audit-analysis-grid">
            <section
              className="audit-panel audit-score-panel"
              aria-label="Score breakdown"
            >
              <div className="audit-panel-heading">
                <div>
                  <h2>Score breakdown</h2>
                  <p>Each category, its weight, and the recoverable score.</p>
                </div>
                <span className="audit-version-badge">
                  Scoring v{audit.scoringVersion}
                </span>
              </div>
              <div className="audit-categories">
                {SCORE_CATEGORIES.map(({ key, label, weight, icon: Icon }) => {
                  const score = isRunning ? null : audit.categoryScores[key];
                  const recoverable =
                    score === null ? null : (weight * (100 - score)) / 100;
                  return (
                    <article className="audit-category" key={key}>
                      <div className="audit-category-title">
                        <Icon size={15} aria-hidden="true" />
                        <span>
                          {label}
                          <small>{weight}% weight</small>
                        </span>
                      </div>
                      <div
                        className="audit-progress"
                        role="progressbar"
                        aria-label={`${label} score`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={score ?? undefined}
                        aria-valuetext={
                          score === null ? "Not scored" : `${score} percent`
                        }
                      >
                        {score !== null && (
                          <span style={{ width: `${score}%` }} />
                        )}
                      </div>
                      <div className="audit-category-score">
                        <strong>
                          {score === null ? "Not scored" : `${score}%`}
                        </strong>
                        <small>
                          {recoverable === null || recoverable === 0
                            ? "—"
                            : `+${recoverable.toFixed(1)} pts`}
                        </small>
                      </div>
                    </article>
                  );
                })}
              </div>
              <p className="audit-recoverable-note">
                Recoverable points = weight × (100% − score). Unscored checks
                do not count as zero.
              </p>
            </section>

            <aside className="audit-sidebar">
              <section className="audit-panel audit-history">
                <div className="audit-panel-heading">
                  <h2>Audit history</h2>
                  <Clock3 size={15} aria-hidden="true" />
                </div>
                {(() => {
                  const current = history[0] ?? audit;
                  const previous = history[1];
                  const delta = previous
                    ? current.overallScore - previous.overallScore
                    : null;
                  return (
                    <>
                      <div className="audit-history-grid">
                        <div>
                          <span>This audit</span>
                          <strong>
                            {scoreUnavailable
                              ? "—"
                              : `${current.overallScore}/100`}
                          </strong>
                          <small>{formatDate(current.completedAt)}</small>
                        </div>
                        <div>
                          <span>Previous</span>
                          <strong>
                            {previous ? `${previous.overallScore}/100` : "—"}
                          </strong>
                          <small>
                            {previous ? formatDate(previous.completedAt) : "No earlier audit"}
                          </small>
                        </div>
                        <div>
                          <span>Change</span>
                          <strong>
                            {delta === null
                              ? "—"
                              : `${delta > 0 ? "+" : ""}${delta}`}
                          </strong>
                          <small>points</small>
                        </div>
                      </div>
                      {schedule ? (
                        <p className="audit-schedule-status">
                          Next {schedule.frequency} audit{" "}
                          {formatDate(schedule.nextRunAt)}
                        </p>
                      ) : (
                        <p className="audit-schedule-status">
                          No recurring audit scheduled.
                        </p>
                      )}
                      <button
                        type="button"
                        className="button audit-schedule-button"
                        onClick={() => {
                          setScheduleFrequency(schedule?.frequency ?? "weekly");
                          setScheduleDialogOpen(true);
                        }}
                      >
                        {schedule
                          ? "Manage recurring audit"
                          : "Schedule recurring audit"}
                      </button>
                    </>
                  );
                })()}
              </section>
              <section
                className="audit-score-basis"
                aria-label="Score methodology"
              >
                <strong>How this score is calculated</strong>
                <p>
                  Weights are normalized across checks with evidence. Failed
                  requests, HTTP errors, utility pages, and duplicate URLs stay
                  out of the public-page denominator. Rendering time is excluded
                  from response-time scoring. Robots rules show published
                  directives, not observed bot activity or citations.
                </p>
              </section>
            </aside>
          </div>

          <section className="audit-findings-panel" aria-label="Audit findings">
          <div
            className="audit-tabs"
            role="tablist"
            aria-label="Technical audit sections"
          >
            {[
              ["overview", "Overview"],
              ["bots", "Robots declarations"],
              ["issues", `Issues (${audit.issuesSummary.total})`],
              ["pages", `Pages (${audit.attemptedUrls ?? audit.pagesCrawled})`],
            ].map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`audit-tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={
                  activeTab === tab ? `audit-panel-${tab}` : undefined
                }
                tabIndex={activeTab === tab ? 0 : -1}
                onClick={() => setActiveTab(tab as typeof activeTab)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  const tabIds = [
                    "overview",
                    "bots",
                    "issues",
                    "pages",
                  ] as const;
                  const currentIndex = tabIds.indexOf(
                    tab as (typeof tabIds)[number],
                  );
                  const direction = event.key === "ArrowRight" ? 1 : -1;
                  const nextTab =
                    tabIds[
                      (currentIndex + direction + tabIds.length) % tabIds.length
                    ];
                  setActiveTab(nextTab);
                  document.getElementById(`audit-tab-${nextTab}`)?.focus();
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <section
              id="audit-panel-overview"
              className="audit-panel"
              role="tabpanel"
              aria-labelledby="audit-tab-overview"
            >
              <div className="audit-panel-heading">
                <div>
                  <h2>Highest-priority findings</h2>
                  <p>
                    Findings include recommendations and supporting crawl
                    evidence.
                  </p>
                </div>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setActiveTab("issues")}
                >
                  View all issues
                </button>
              </div>
              {issuesError ? (
                <p className="audit-inline-error" role="alert">
                  {issuesError}
                </p>
              ) : loadingIssues ? (
                <p className="audit-inline-state" role="status">
                  Loading findings…
                </p>
              ) : issues.length ? (
                <IssueList
                  issues={issues.slice(0, 5)}
                  expandedIssueId={expandedIssueId}
                  copiedSnippetId={copiedSnippetId}
                  onToggle={(id) =>
                    setExpandedIssueId(expandedIssueId === id ? null : id)
                  }
                  onCopy={handleCopySnippet}
                  onStatusChange={handleIssueStatus}
                  onRecheck={handleTriggerAudit}
                  isRechecking={isRunning}
                />
              ) : (
                <p className="audit-inline-state">
                  No issues were found for this audit.
                </p>
              )}
            </section>
          )}

          {activeTab === "bots" && (
            <section
              id="audit-panel-bots"
              className="audit-panel"
              role="tabpanel"
              aria-labelledby="audit-tab-bots"
            >
              <div className="audit-panel-heading">
                <div>
                  <h2>robots.txt declared crawl permissions</h2>
                  <p>
                    Rules are evaluated for the site root and matching paths;
                    they do not prove bot activity.
                  </p>
                </div>
              </div>
              <div className="audit-alert audit-alert-note">
                <ShieldAlert size={18} aria-hidden="true" />
                <span>
                  A robots.txt rule is a published crawl directive. This audit
                  has no evidence that a bot accessed, indexed, or cited the
                  site.
                </span>
              </div>
              {!bots.length ? (
                <p className="audit-inline-state">
                  No bot declaration results are available.
                </p>
              ) : (
                <div className="audit-bot-grid">
                  {bots.map((bot) => {
                    const statusClass = botStatusClass(bot.status);
                    return (
                      <article className="audit-bot-card" key={bot.bot}>
                        <div className="audit-bot-topline">
                          <div>
                            <h3>{bot.name}</h3>
                            <p>{bot.ruleSource}</p>
                          </div>
                          <span className={`audit-badge ${statusClass}`}>
                            {botStatusLabel(
                              bot.status,
                              audit.scoringVersion < 2,
                            )}
                          </span>
                        </div>
                        <p>{bot.impact}</p>
                        {bot.fixSnippet && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              handleCopySnippet(bot.bot, bot.fixSnippet!)
                            }
                          >
                            {copiedSnippetId === bot.bot ? (
                              <Check size={14} />
                            ) : (
                              <Copy size={14} />
                            )}
                            {copiedSnippetId === bot.bot
                              ? "Copied"
                              : "Copy suggested directive"}
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {activeTab === "issues" && (
            <section
              id="audit-panel-issues"
              className="audit-panel"
              role="tabpanel"
              aria-labelledby="audit-tab-issues"
            >
              <div className="audit-panel-heading">
                <div>
                  <h2>Audit issues</h2>
                  <p>
                    {audit.issuesSummary.critical + audit.issuesSummary.high}{" "}
                    problems · {audit.issuesSummary.medium + audit.issuesSummary.low}{" "}
                    suggestions · {audit.issuesSummary.info} informational notes.
                  </p>
                </div>
                <a
                  className="button"
                  href={issueExportHref()}
                >
                  <Download size={15} aria-hidden="true" />
                  Export issues CSV
                </a>
              </div>
              <div className="audit-toolbar">
                <label className="audit-search">
                  <Search size={16} aria-hidden="true" />
                  <span className="sr-only">Search audit issues</span>
                  <input
                    value={issueSearch}
                    onChange={(event) => setIssueSearch(event.target.value)}
                    placeholder="Search issues"
                  />
                </label>
                <label>
                  <span className="sr-only">Filter by severity</span>
                  <select
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value)}
                  >
                    <option value="all">All severities</option>
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                    <option value="info">Informational</option>
                  </select>
                </label>
                <label>
                    <span className="sr-only">Filter by finding type</span>
                    <select
                      value={findingTypeFilter}
                      onChange={(event) =>
                        setFindingTypeFilter(event.target.value)
                      }
                    >
                      <option value="all">All finding types</option>
                      <option value="problem">Problems</option>
                      <option value="suggestion">Suggestions</option>
                      <option value="information">Informational notes</option>
                    </select>
                </label>
                <label>
                  <span className="sr-only">Filter by category</span>
                  <select
                    value={categoryFilter}
                    onChange={(event) => setCategoryFilter(event.target.value)}
                  >
                    <option value="all">All categories</option>
                    <option value="bot_access">Bot declarations</option>
                    <option value="indexability">Indexability</option>
                    <option value="schema">Structured data</option>
                    <option value="answer_structure">Answer structure</option>
                    <option value="performance_trust">Response time</option>
                    <option value="agent_readability">Discovery files</option>
                  </select>
                </label>
              </div>
              {issuesError ? (
                <p className="audit-inline-error" role="alert">
                  {issuesError}
                </p>
              ) : loadingIssues ? (
                <p className="audit-inline-state" role="status">
                  Loading issues…
                </p>
              ) : issues.length ? (
                <IssueList
                  issues={issues}
                  expandedIssueId={expandedIssueId}
                  copiedSnippetId={copiedSnippetId}
                  onToggle={(id) =>
                    setExpandedIssueId(expandedIssueId === id ? null : id)
                  }
                  onCopy={handleCopySnippet}
                  onStatusChange={handleIssueStatus}
                  onRecheck={handleTriggerAudit}
                  isRechecking={isRunning}
                />
              ) : (
                <p className="audit-inline-state">
                  <CheckCircle2 size={17} /> No issues match these filters.
                </p>
              )}
            </section>
          )}

          {activeTab === "pages" && (
            <section
              id="audit-panel-pages"
              className="audit-panel"
              role="tabpanel"
              aria-labelledby="audit-tab-pages"
            >
              <div className="audit-panel-heading">
                <div>
                  <h2>Crawl results</h2>
                  <p>
                    {pages.length} of {formatCount(pagesTotal)} URLs shown ·
                    failed and excluded pages remain visible.
                  </p>
                </div>
                <a
                  className="button"
                  href={`${basePath}/audits/${audit.id}/export?type=pages`}
                >
                  <Download size={15} aria-hidden="true" />
                  Export pages CSV
                </a>
              </div>
              <label className="audit-search audit-page-search">
                <Search size={16} aria-hidden="true" />
                <span className="sr-only">Search crawled URLs</span>
                <input
                  value={pageSearch}
                  onChange={(event) => setPageSearch(event.target.value)}
                  placeholder="Search URL or path"
                />
              </label>
              {pagesError ? (
                <p className="audit-inline-error" role="alert">
                  {pagesError}
                </p>
              ) : loadingPages ? (
                <p className="audit-inline-state" role="status">
                  Loading crawl results…
                </p>
              ) : pages.length ? (
                <div className="audit-table-wrap">
                  <table className="audit-table">
                    <thead>
                      <tr>
                        <th scope="col">URL</th>
                        <th scope="col">Fetch</th>
                        <th scope="col">Score</th>
                        <th scope="col">Indexable</th>
                        <th scope="col">Words</th>
                        <th scope="col">Schemas</th>
                        <th scope="col">Issues</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pages.map((page) => (
                        <tr key={page.id}>
                          <td className="audit-url-cell">
                            <a
                              href={page.finalUrl || page.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {page.path}
                            </a>
                            <small>{page.finalUrl || page.url}</small>
                            {page.finalUrl && page.finalUrl !== page.url && (
                              <small>Requested: {page.url}</small>
                            )}
                            {page.excluded && (
                              <small className="audit-exclusion">
                                {page.exclusionReason ||
                                  "Excluded utility page"}
                              </small>
                            )}
                            {page.fetchError && (
                              <small className="audit-fetch-error">
                                {page.fetchError}
                              </small>
                            )}
                          </td>
                          <td>
                            <span className={`audit-badge ${page.crawlStatus}`}>
                              {page.crawlStatus === "fetched"
                                ? `HTTP ${page.statusCode}`
                                : page.crawlStatus.replace("_", " ")}
                            </span>
                            <small>
                              {page.crawlSource === "firecrawl"
                                ? "Firecrawl"
                                : page.crawlSource === "direct"
                                  ? "Direct fetch"
                                  : "Crawler not recorded"}
                            </small>
                            {page.fallbackReason && (
                              <small>Fallback: {page.fallbackReason}</small>
                            )}
                            <small>
                              Fetch duration: {page.loadTimeMs} ms
                              {page.crawlSource === "firecrawl"
                                ? " (includes rendering)"
                                : ""}
                            </small>
                          </td>
                          <td>
                            {page.pageScore === null
                              ? "—"
                              : `${page.pageScore}/100`}
                          </td>
                          <td>
                            {page.crawlStatus !== "fetched"
                              ? "—"
                              : page.excluded
                                ? "Excluded"
                                : page.isIndexable
                                  ? "Yes"
                                  : "No"}
                          </td>
                          <td>{page.wordCount}</td>
                          <td>
                            {page.schemasDetected?.length
                              ? page.schemasDetected
                                  .map((schema) => schema.type)
                                  .join(", ")
                              : "—"}
                          </td>
                          <td>{page.issuesCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="audit-inline-state">
                  No crawl results match this URL search.
                </p>
              )}
            </section>
          )}
          </section>
        </>
      )}
      {audit && (
        <p className="audit-disclaimer">
          Official API samples may differ from consumer AI apps. Locale is simulated.
        </p>
      )}
      {scheduleDialogOpen && (
        <div className="audit-dialog-backdrop">
          <section
            className="audit-schedule-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="audit-schedule-title"
          >
            <p className="audit-eyebrow">AUTOMATED CRAWLS</p>
            <h2 id="audit-schedule-title">Schedule recurring audits</h2>
            <p>
              Keep {project.domain} up to date with regular technical crawls.
              The first run starts after the selected interval.
            </p>
            <label htmlFor="audit-frequency">Repeat</label>
            <select
              id="audit-frequency"
              value={scheduleFrequency}
              onChange={(event) =>
                setScheduleFrequency(
                  event.target.value as TechnicalAuditSchedule["frequency"],
                )
              }
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {scheduleError && (
              <p className="audit-inline-error" role="alert">
                {scheduleError}
              </p>
            )}
            <div className="audit-dialog-actions">
              {schedule && (
                <button
                  type="button"
                  className="button danger"
                  onClick={handleDeleteSchedule}
                  disabled={schedulePending}
                >
                  Remove schedule
                </button>
              )}
              <button
                type="button"
                className="button"
                onClick={() => setScheduleDialogOpen(false)}
                disabled={schedulePending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                onClick={handleSaveSchedule}
                disabled={schedulePending}
              >
                {schedulePending ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

function IssueList({
  issues,
  expandedIssueId,
  copiedSnippetId,
  onToggle,
  onCopy,
  onStatusChange,
  onRecheck,
  isRechecking,
}: {
  issues: TechnicalAuditIssueItem[];
  expandedIssueId: string | null;
  copiedSnippetId: string | null;
  onToggle: (id: string) => void;
  onCopy: (id: string, snippet: string) => void;
  onStatusChange: (
    issueId: string,
    status: TechnicalAuditIssueItem["status"],
  ) => void;
  onRecheck: () => void;
  isRechecking: boolean;
}) {
  return (
    <div className="audit-issue-list">
      {issues.map((issue) => {
        const expanded = expandedIssueId === issue.id;
        return (
          <article className="audit-issue" key={issue.id}>
            <button
              type="button"
              className="audit-issue-toggle"
              aria-expanded={expanded}
              onClick={() => onToggle(issue.id)}
            >
              <span className="audit-issue-title">
              <span
                className={`audit-badge finding-${issue.findingType}`}
              >
                {issue.findingType === "information"
                  ? "Informational note"
                  : issue.findingType}
              </span>
              <span className={`audit-badge severity-${issue.severity}`}>
                {issue.severity}
                </span>
              {issue.status !== "open" && (
                <span className={`audit-badge issue-status-${issue.status}`}>
                  {issue.status}
                </span>
              )}
                <strong>{issue.title}</strong>
                <small>{issue.category.replace(/_/g, " ")}</small>
              </span>
              {issue.affectedUrl && (
                <span className="audit-issue-url">{issue.affectedUrl}</span>
              )}
              {expanded ? (
                <ChevronUp size={17} aria-hidden="true" />
              ) : (
                <ChevronDown size={17} aria-hidden="true" />
              )}
            </button>
            {expanded && (
              <div className="audit-issue-detail">
                <p className="audit-finding-explanation">
                  {issue.findingType === "problem"
                    ? "Problem: a higher-priority finding that may affect access or page quality. Review its evidence and impact before making changes."
                    : issue.findingType === "suggestion"
                      ? "Suggestion: a lower-priority improvement, not necessarily an urgent failure."
                      : "Informational note: context from the audit, not a reported problem."}
                </p>
                <p>{issue.description}</p>
                <div className="audit-recommendation">
                  <strong>Recommendation</strong>
                  <p>{issue.recommendation}</p>
                </div>
                {issue.fixSnippet && (
                  <div className="audit-snippet">
                    <div className="audit-snippet-heading">
                      <strong>Suggested directive or code</strong>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => onCopy(issue.id, issue.fixSnippet!)}
                      >
                        {copiedSnippetId === issue.id ? (
                          <Check size={14} />
                        ) : (
                          <Copy size={14} />
                        )}
                        {copiedSnippetId === issue.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <pre>{issue.fixSnippet}</pre>
                  </div>
                )}
                <div className="audit-issue-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={onRecheck}
                    disabled={isRechecking}
                  >
                    {isRechecking ? "Audit running" : "Re-check"}
                  </button>
                  {issue.status === "open" ? (
                    <>
                      <button
                        type="button"
                        className="button"
                        onClick={() => onStatusChange(issue.id, "fixed")}
                      >
                        Mark as fixed
                      </button>
                      <button
                        type="button"
                        className="button"
                        onClick={() => onStatusChange(issue.id, "dismissed")}
                      >
                        Dismiss
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      onClick={() => onStatusChange(issue.id, "open")}
                    >
                      Reopen finding
                    </button>
                  )}
                </div>
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
