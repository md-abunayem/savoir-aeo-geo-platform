"use client";

import { useEffect, useState, useCallback } from "react";
import {
  BarChart3,
  AlertTriangle,
  ShieldAlert,
  CheckCircle2,
  RefreshCw,
  Plus,
  FileText,
  Download,
  Eye,
  AlertCircle,
  ShieldCheck,
  X,
  Play,
  Calendar,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { reportingDashboard, reportingSchedule, type ExecutiveDashboardResponse } from "../lib/reporting-response";
import styles from "./workspace-sections.module.css";
import type {
  Project,
  ExecutiveDashboardData,
  AlertIncident,
  AlertRule,
  ReportSchedule,
  GeneratedReport,
  AlertRuleType,
  AlertSeverity,
  AlertIncidentStatus,
  ReportCadence,
  ReportFormat,
} from "../lib/types";

interface ReportingDashboardProps {
  tenantId: string;
  project: Project;
}

export function ReportingDashboard({ tenantId, project }: ReportingDashboardProps) {
  // Tabs: overview | alerts | reports
  const [activeTab, setActiveTab] = useState<"overview" | "alerts" | "reports">("overview");

  // Global State
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Tab 1: Executive Dashboard
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [dashboardData, setDashboardData] = useState<ExecutiveDashboardData | null>(null);

  // Tab 2: Incidents & Alert Rules
  const [incidents, setIncidents] = useState<AlertIncident[]>([]);
  const [incidentStatusFilter, setIncidentStatusFilter] = useState<string>("active");
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [evaluatingRules, setEvaluatingRules] = useState<boolean>(false);
  const [showRuleModal, setShowRuleModal] = useState<boolean>(false);
  const [showResolveModal, setShowResolveModal] = useState<AlertIncident | null>(null);
  const [resolveNotes, setResolveNotes] = useState<string>("");

  // Rule Form State
  const [ruleName, setRuleName] = useState("");
  const [ruleType, setRuleType] = useState<AlertRuleType>("visibility_drop");
  const [ruleSeverity, setRuleSeverity] = useState<AlertSeverity>("high");
  const [ruleCooldown, setRuleCooldown] = useState<number>(24);
  const [ruleChannels, setRuleChannels] = useState<string[]>(["in_app", "email"]);
  // Threshold helpers
  const [dropThreshold, setDropThreshold] = useState<number>(15);
  const [competitorDomain, setCompetitorDomain] = useState<string>("");
  const [overtakeGap, setOvertakeGap] = useState<number>(5);
  const [crawlAgent, setCrawlAgent] = useState<string>("GPTBot");

  // Tab 3: Reports & Schedules
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [reports, setReports] = useState<GeneratedReport[]>([]);
  const [showScheduleModal, setShowScheduleModal] = useState<boolean>(false);
  const [showGenerateModal, setShowGenerateModal] = useState<boolean>(false);
  const [previewReportHtml, setPreviewReportHtml] = useState<{ id: string; html: string; title: string } | null>(null);

  // Schedule Form State
  const [schedTitle, setSchedTitle] = useState("");
  const [schedCadence, setSchedCadence] = useState<ReportCadence>("weekly");
  const [schedFormat, setSchedFormat] = useState<ReportFormat>("pdf");
  const [schedRecipients, setSchedRecipients] = useState("");

  // Generate Report Form State
  const [genTitle, setGenTitle] = useState("");
  const [genPeriodDays, setGenPeriodDays] = useState<number>(30);
  const [genFormat, setGenFormat] = useState<ReportFormat>("pdf");
  const [genRecipients, setGenRecipients] = useState("");
  const [generating, setGenerating] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const basePath = `/v1/tenants/${tenantId}/projects/${project.id}/reporting`;

  // Data Fetching
  const fetchDashboard = useCallback(async () => {
    try {
      const data = await api.request<ExecutiveDashboardResponse>(
        `${basePath}/dashboard?days=${periodDays}`,
      );
      setDashboardData(reportingDashboard(data));
    } catch (err) {
      console.error("Failed to load executive dashboard", err);
    }
  }, [basePath, periodDays]);

  const fetchIncidentsAndRules = useCallback(async () => {
    try {
      const [rulesRes, incidentsRes] = await Promise.all([
        api.request<AlertRule[]>(`${basePath}/alerts/rules`),
        api.request<AlertIncident[]>(
          `${basePath}/alerts/incidents${incidentStatusFilter !== "all" ? `?status=${incidentStatusFilter}` : ""}`,
        ),
      ]);
      setRules(rulesRes);
      setIncidents(incidentsRes);
    } catch (err) {
      console.error("Failed to load rules/incidents", err);
    }
  }, [basePath, incidentStatusFilter]);

  const fetchReportsAndSchedules = useCallback(async () => {
    try {
      const [schedulesRes, reportsRes] = await Promise.all([
        api.request<Parameters<typeof reportingSchedule>[0][]>(`${basePath}/schedules`),
        api.request<GeneratedReport[]>(`${basePath}/reports?limit=50`),
      ]);
      setSchedules(schedulesRes.map(reportingSchedule));
      setReports(reportsRes);
    } catch (err) {
      console.error("Failed to load reports/schedules", err);
    }
  }, [basePath]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      fetchDashboard(),
      fetchIncidentsAndRules(),
      fetchReportsAndSchedules(),
    ]);
    setRefreshing(false);
  };

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        await Promise.all([
          fetchDashboard(),
          fetchIncidentsAndRules(),
          fetchReportsAndSchedules(),
        ]);
      } catch {
        // Individual fetches log errors
      } finally {
        if (!ignore) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      ignore = true;
    };
  }, [fetchDashboard, fetchIncidentsAndRules, fetchReportsAndSchedules]);

  const handleTabChange = (tab: "overview" | "alerts" | "reports") => {
    setActiveTab(tab);
    if (tab === "overview") fetchDashboard();
    else if (tab === "alerts") fetchIncidentsAndRules();
    else if (tab === "reports") fetchReportsAndSchedules();
  };

  // Incident Actions
  const handleAcknowledgeIncident = async (incidentId: string) => {
    try {
      await api.request(`${basePath}/alerts/incidents/${incidentId}`, {
        method: "PATCH",
        body: { status: "acknowledged" },
      });
      showToast("Incident marked as acknowledged.");
      fetchIncidentsAndRules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update incident status";
      showToast(msg);
    }
  };

  const handleResolveIncident = async () => {
    if (!showResolveModal) return;
    try {
      await api.request(`${basePath}/alerts/incidents/${showResolveModal.id}`, {
        method: "PATCH",
        body: {
          status: "resolved",
          notes: resolveNotes.trim() || undefined,
        },
      });
      showToast("Incident marked as resolved.");
      setShowResolveModal(null);
      setResolveNotes("");
      fetchIncidentsAndRules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to resolve incident";
      showToast(msg);
    }
  };

  const handleEvaluateRules = async () => {
    setEvaluatingRules(true);
    try {
      const res = await api.request<{ evaluatedCount: number; incidentsTriggered: number }>(
        `${basePath}/rules/evaluate`,
        { method: "POST" },
      );
      showToast(`Evaluated ${res.evaluatedCount} rules. ${res.incidentsTriggered} incident(s) triggered.`);
      fetchIncidentsAndRules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to evaluate alert rules";
      showToast(msg);
    } finally {
      setEvaluatingRules(false);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let thresholdObj: Record<string, unknown> = {};
      if (ruleType === "visibility_drop") {
        thresholdObj = { dropThresholdPercent: dropThreshold, confidenceLevel: 0.95 };
      } else if (ruleType === "competitor_overtake") {
        thresholdObj = { competitorDomain: competitorDomain.trim() || undefined, gapThresholdPercent: overtakeGap };
      } else if (ruleType === "lost_citation") {
        thresholdObj = { domain: competitorDomain.trim() || undefined, minVisibilityLossPercent: 10 };
      } else if (ruleType === "crawl_blockage") {
        thresholdObj = { userAgent: crawlAgent };
      }

      await api.request(`${basePath}/alerts/rules`, {
        method: "POST",
        body: {
          name: ruleName.trim(),
          ruleType,
          threshold: thresholdObj,
          severity: ruleSeverity === "critical" ? "critical" : ruleSeverity === "low" ? "info" : "warning",
          channels: ruleChannels,
          cooldownHours: ruleCooldown,
        },
      });

      showToast("Alert rule created successfully.");
      setShowRuleModal(false);
      setRuleName("");
      fetchIncidentsAndRules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create rule";
      showToast(msg);
    }
  };

  // Schedule & Report Actions
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const recList = schedRecipients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      await api.request(`${basePath}/schedules`, {
        method: "POST",
        body: {
          name: schedTitle.trim(),
          frequency: schedCadence,
          format: schedFormat,
          recipients: recList,
        },
      });

      showToast("Report schedule configured.");
      setShowScheduleModal(false);
      setSchedTitle("");
      setSchedRecipients("");
      fetchReportsAndSchedules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to create schedule";
      showToast(msg);
    }
  };

  const handleGenerateOnDemand = async (e: React.FormEvent) => {
    e.preventDefault();
    setGenerating(true);
    try {
      const recList = genRecipients
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await api.request<{ report: GeneratedReport; htmlContent: string }>(`${basePath}/reports/generate`, {
        method: "POST",
        body: {
          title: genTitle.trim() || `${project.brandName} Executive Brief`,
          dateWindowDays: genPeriodDays,
          format: genFormat,
          recipients: recList.length > 0 ? recList : undefined,
        },
      });

      showToast(`Report generated: ${res.report.title}`);
      setShowGenerateModal(false);
      setGenTitle("");
      setGenRecipients("");
      fetchReportsAndSchedules();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to generate report";
      showToast(msg);
    } finally {
      setGenerating(false);
    }
  };

  const handlePreviewHtml = async (reportId: string, title: string) => {
    try {
      const res = await api.request<{ html: string }>(`${basePath}/reports/${reportId}/html`);
      setPreviewReportHtml({ id: reportId, html: res.html, title });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to preview report";
      showToast(msg);
    }
  };

  // Helper colors
  const getSeverityBadgeClass = (sev: AlertSeverity) => {
    switch (sev) {
      case "critical":
        return "badge-critical";
      case "high":
        return "badge-high";
      case "medium":
        return "badge-medium";
      default:
        return "badge-low";
    }
  };

  const getStatusBadgeClass = (st: AlertIncidentStatus) => {
    switch (st) {
      case "active":
        return "badge-active";
      case "acknowledged":
        return "badge-ack";
      case "resolved":
        return "badge-resolved";
      default:
        return "badge-dismissed";
    }
  };

  const getReadinessColor = (classification?: string) => {
    switch (classification) {
      case "Leading":
        return "text-emerald-500 border-emerald-500 bg-emerald-50 dark:bg-emerald-950/20";
      case "Competitive":
        return "text-blue-500 border-blue-500 bg-blue-50 dark:bg-blue-950/20";
      case "Moderate":
        return "text-amber-500 border-amber-500 bg-amber-50 dark:bg-amber-950/20";
      default:
        return "text-rose-500 border-rose-500 bg-rose-50 dark:bg-rose-950/20";
    }
  };

  return (
    <div className={`${styles.page} ${styles.reportingPage}`}>
      <div className="reporting-container">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="toast-banner">
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header Section */}
      <div className={`reporting-header ${styles.header} ${styles.reportingHeader}`}>
        <div className={styles.headerCopy}>
          <p className={`${styles.eyebrow} ${styles.reportingEyebrow}`}>
            <BarChart3 size={13} />
            <span>M13 REPORTING & ALERTS</span>
          </p>
          <h1 className="text-2xl font-bold tracking-tight">Executive Intelligence & Incident Response</h1>
          <p className={styles.description}>
            Cross-module executive synthesis, real-time alert triage, and automated stakeholder reporting.
          </p>
        </div>

        <div className={`${styles.headerActions} ${styles.reportingHeaderActions}`}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
            title="Refresh Intelligence Data"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>

          {activeTab === "overview" && (
            <div className="flex items-center border rounded-lg bg-white dark:bg-gray-800 p-1 text-xs">
              {[7, 14, 30, 90].map((days) => (
                <button
                  key={days}
                  onClick={() => setPeriodDays(days)}
                  className={`px-3 py-1 rounded font-medium transition ${
                    periodDays === days
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          )}

          {activeTab === "alerts" && (
            <div className="flex items-center gap-2">
              <button
                onClick={handleEvaluateRules}
                disabled={evaluatingRules}
                className="btn btn-secondary flex items-center gap-2 text-xs"
              >
                <Play size={13} className={evaluatingRules ? "animate-spin" : ""} />
                <span>Evaluate Rules</span>
              </button>
              <button
                onClick={() => setShowRuleModal(true)}
                className="btn btn-primary flex items-center gap-2 text-xs"
              >
                <Plus size={14} />
                <span>New Alert Rule</span>
              </button>
            </div>
          )}

          {activeTab === "reports" && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowScheduleModal(true)}
                className="btn btn-secondary flex items-center gap-2 text-xs"
              >
                <Calendar size={13} />
                <span>New Schedule</span>
              </button>
              <button
                onClick={() => setShowGenerateModal(true)}
                className="btn btn-primary flex items-center gap-2 text-xs"
              >
                <FileText size={14} />
                <span>Generate Report</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className={`reporting-tabs ${styles.reportingTabs}`}>
        <button
          onClick={() => handleTabChange("overview")}
          className={`${styles.reportingTab} ${activeTab === "overview" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "overview"}
        >
          <BarChart3 size={16} />
          <span>Executive Overview</span>
        </button>

        <button
          onClick={() => handleTabChange("alerts")}
          className={`${styles.reportingTab} ${activeTab === "alerts" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "alerts"}
        >
          <AlertTriangle size={16} />
          <span>Incidents & Rules</span>
          {dashboardData?.summary && dashboardData.summary.activeIncidentsCount > 0 && (
            <span className="px-2 py-0.5 text-xs rounded-full bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 font-bold">
              {dashboardData.summary.activeIncidentsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => handleTabChange("reports")}
          className={`${styles.reportingTab} ${activeTab === "reports" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "reports"}
        >
          <FileText size={16} />
          <span>Scheduled Reports & PDF Exports</span>
          <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
            {reports.length}
          </span>
        </button>
      </div>

      {/* Loading Skeleton */}
      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-gray-400">
          <RefreshCw size={28} className="animate-spin mb-3 text-blue-500" />
          <p className="text-sm font-medium">Aggregating cross-module intelligence...</p>
        </div>
      ) : (
        <>
          {/* TAB 1: EXECUTIVE OVERVIEW */}
          {activeTab === "overview" && dashboardData && (
            <div className="flex flex-col gap-6 mt-4">
              {/* Readiness Hero Card */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="panel flex flex-col items-center justify-center text-center p-6 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                  <div className="text-xs uppercase font-bold tracking-wider text-gray-400 mb-2">
                    AEO Executive Readiness Index
                  </div>
                  <div className="relative flex items-center justify-center my-3">
                    <div className="w-32 h-32 rounded-full border-8 border-gray-100 dark:border-gray-800 flex items-center justify-center">
                      <div className="text-4xl font-extrabold text-gray-900 dark:text-white">
                        {dashboardData.summary.aeoReadinessIndex}
                      </div>
                    </div>
                  </div>
                  <div
                    className={`px-3 py-1 rounded-full text-xs font-bold border mt-2 ${getReadinessColor(
                      dashboardData.summary.readinessClassification,
                    )}`}
                  >
                    Standing: {dashboardData.summary.readinessClassification}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-3 max-w-xs">
                    Synthesizes visibility, authoritative citations, crawl indexability, content coverage, AI traffic,
                    and action remediation velocity.
                  </p>
                </div>

                {/* Key Wins & Critical Risks */}
                <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Wins */}
                  <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col">
                    <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm mb-3">
                      <CheckCircle2 size={16} />
                      <span>Key Strategic Wins ({periodDays}d)</span>
                    </div>
                    <ul className="flex flex-col gap-2.5 flex-1">
                      {dashboardData.keyWins.length > 0 ? (
                        dashboardData.keyWins.map((win, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2 bg-emerald-50/50 dark:bg-emerald-950/20 p-2.5 rounded border border-emerald-100 dark:border-emerald-900/30"
                          >
                            <span className="text-emerald-500 font-bold">•</span>
                            <span>{win}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-xs text-gray-400 italic">No significant positive spikes recorded.</li>
                      )}
                    </ul>
                  </div>

                  {/* Risks */}
                  <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col">
                    <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400 font-bold text-sm mb-3">
                      <ShieldAlert size={16} />
                      <span>Critical Risks & Impediments</span>
                    </div>
                    <ul className="flex flex-col gap-2.5 flex-1">
                      {dashboardData.criticalRisks.length > 0 ? (
                        dashboardData.criticalRisks.map((risk, idx) => (
                          <li
                            key={idx}
                            className="text-xs text-gray-700 dark:text-gray-300 flex items-start gap-2 bg-rose-50/50 dark:bg-rose-950/20 p-2.5 rounded border border-rose-100 dark:border-rose-900/30"
                          >
                            <span className="text-rose-500 font-bold">•</span>
                            <span>{risk}</span>
                          </li>
                        ))
                      ) : (
                        <li className="text-xs text-gray-400 italic">Zero critical alert impediments detected.</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              {/* 6 Pillars Breakdown */}
              <div className="panel p-6 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Pillar Score Breakdown</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Standardized weighting model governing the composite Readiness Index
                    </p>
                  </div>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded">
                    Total Monitored Prompts: {dashboardData.summary.totalPromptsMonitored}
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {dashboardData.pillarBreakdown.map((pillar) => (
                    <div
                      key={pillar.id}
                      className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/50 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-gray-700 dark:text-gray-300">{pillar.title}</span>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              pillar.status === "healthy"
                                ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                : pillar.status === "warning"
                                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                            }`}
                          >
                            {pillar.status.toUpperCase()}
                          </span>
                        </div>
                        <div className="flex items-baseline gap-2 mb-2">
                          <span className="text-2xl font-extrabold text-gray-900 dark:text-white">
                            {pillar.score}%
                          </span>
                          <span className="text-[11px] text-gray-400">Weight: {pillar.weightPercent}%</span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden mb-2">
                          <div
                            className={`h-full ${
                              pillar.status === "healthy"
                                ? "bg-emerald-500"
                                : pillar.status === "warning"
                                ? "bg-amber-500"
                                : "bg-rose-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, pillar.score))}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2 leading-relaxed">
                        {pillar.detail}
                      </p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mandatory Metric Disclosures (RPT-FR-011) */}
              <div className="panel p-5 border rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40">
                <div className="flex items-start gap-3">
                  <ShieldCheck size={20} className="text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300 mb-1">
                      Statutory Measurement Disclosure (RPT-FR-011)
                    </h4>
                    <p className="text-xs text-blue-800/80 dark:text-blue-300/80 leading-relaxed mb-3">
                      {dashboardData.metricLabels.disclosure}
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                      <div className="bg-white/80 dark:bg-gray-900/80 p-3 rounded border border-blue-100 dark:border-blue-900/30">
                        <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 mb-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          Observed Telemetry Metrics
                        </span>
                        <div className="text-gray-600 dark:text-gray-400 flex flex-wrap gap-1 mt-1">
                          {dashboardData.metricLabels.observedMetrics.map((m, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[11px]">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="bg-white/80 dark:bg-gray-900/80 p-3 rounded border border-blue-100 dark:border-blue-900/30">
                        <span className="font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1.5 mb-1">
                          <span className="w-2 h-2 rounded-full bg-purple-500" />
                          Modeled & Inferred Indices
                        </span>
                        <div className="text-gray-600 dark:text-gray-400 flex flex-wrap gap-1 mt-1">
                          {dashboardData.metricLabels.modeledMetrics.map((m, i) => (
                            <span key={i} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-[11px]">
                              {m}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: INCIDENTS & ALERT RULES */}
          {activeTab === "alerts" && (
            <div className="flex flex-col gap-6 mt-4">
              {/* Incidents Filter & Table */}
              <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Active Alert Incidents</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Real-time incidents generated by statistical drop tests, crawl blockages, and overtake events
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {["active", "acknowledged", "resolved", "all"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setIncidentStatusFilter(st)}
                        className={`px-3 py-1 text-xs rounded-full capitalize font-medium transition ${
                          incidentStatusFilter === st
                            ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900 shadow-sm"
                            : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-200"
                        }`}
                      >
                        {st}
                      </button>
                    ))}
                  </div>
                </div>

                {incidents.length === 0 ? (
                  <div className="py-12 text-center text-gray-400 flex flex-col items-center">
                    <ShieldCheck size={36} className="text-emerald-500 mb-2" />
                    <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                      No incidents matching current filter
                    </p>
                    <p className="text-xs text-gray-400 mt-1">All monitored metrics and crawl bots are operating normally.</p>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 mt-3">
                    {incidents.map((inc) => (
                      <div key={inc.id} className="py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <div className="mt-1">
                            {inc.severity === "critical" ? (
                              <ShieldAlert size={20} className="text-rose-500" />
                            ) : inc.severity === "high" ? (
                              <AlertTriangle size={20} className="text-amber-500" />
                            ) : (
                              <AlertCircle size={20} className="text-blue-500" />
                            )}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-gray-900 dark:text-white">{inc.title}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${getSeverityBadgeClass(inc.severity)}`}>
                                {inc.severity}
                              </span>
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded capitalize ${getStatusBadgeClass(inc.status)}`}>
                                {inc.status}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {new Date(inc.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{inc.message}</p>
                            {inc.resolvedNotes && (
                              <div className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-2 rounded border border-emerald-200 dark:border-emerald-800">
                                <strong>Resolution note:</strong> {inc.resolvedNotes}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-2 text-[11px] text-gray-400">
                              <span>Channels:</span>
                              {inc.notifiedChannels.map((c, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded uppercase text-[9px]">
                                  {c}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Incident Triage Actions */}
                        <div className="flex items-center gap-2 self-end sm:self-center">
                          {inc.status === "active" && (
                            <button
                              onClick={() => handleAcknowledgeIncident(inc.id)}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 dark:border-amber-700 dark:text-amber-300 dark:bg-amber-950/40"
                            >
                              Acknowledge
                            </button>
                          )}
                          {(inc.status === "active" || inc.status === "acknowledged") && (
                            <button
                              onClick={() => {
                                setShowResolveModal(inc);
                                setResolveNotes("");
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-700 dark:text-emerald-300 dark:bg-emerald-950/40"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Configured Rules Section */}
              <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Configured Alert Rules</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Rules evaluated periodically and on new monitoring batch completion
                    </p>
                  </div>
                  <button
                    onClick={() => setShowRuleModal(true)}
                    className="btn btn-primary flex items-center gap-1.5 text-xs"
                  >
                    <Plus size={13} />
                    <span>Add Rule</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  {rules.map((rule) => (
                    <div
                      key={rule.id}
                      className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/40 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-bold text-xs text-gray-900 dark:text-white">{rule.name}</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${getSeverityBadgeClass(rule.severity)}`}>
                            {rule.severity}
                          </span>
                        </div>
                        <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-2">
                          Type: <span className="font-semibold text-gray-700 dark:text-gray-300">{rule.ruleType}</span>
                        </div>
                        <div className="text-xs bg-white dark:bg-gray-900 p-2.5 rounded border border-gray-200 dark:border-gray-700 font-mono text-[11px] text-gray-600 dark:text-gray-300">
                          {JSON.stringify(rule.threshold)}
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-200 dark:border-gray-700">
                        <span>Cooldown: {rule.cooldownHours}h</span>
                        <span>
                          {rule.lastTriggeredAt
                            ? `Last fired: ${new Date(rule.lastTriggeredAt).toLocaleDateString()}`
                            : "Never fired"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: REPORTS & SCHEDULES */}
          {activeTab === "reports" && (
            <div className="flex flex-col gap-6 mt-4">
              {/* Schedules */}
              <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Recurring Report Schedules</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Automated weekly or monthly executive reports delivered directly via Brevo email
                    </p>
                  </div>
                  <button
                    onClick={() => setShowScheduleModal(true)}
                    className="btn btn-primary flex items-center gap-1.5 text-xs"
                  >
                    <Plus size={13} />
                    <span>Create Schedule</span>
                  </button>
                </div>

                {schedules.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs">
                    No recurring schedules configured. Set up a weekly or monthly executive dispatch.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mt-4">
                    {schedules.map((sched) => (
                      <div
                        key={sched.id}
                        className="p-4 border rounded-lg bg-gray-50 dark:bg-gray-800/40 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-xs text-gray-900 dark:text-white">{sched.title}</span>
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 uppercase">
                              {sched.cadence}
                            </span>
                          </div>
                          <div className="text-[11px] text-gray-500 mb-2">
                            Format: <span className="font-semibold uppercase">{sched.format}</span>
                          </div>
                          <div className="text-xs text-gray-600 dark:text-gray-300">
                            <strong>Recipients:</strong> {sched.recipients.join(", ")}
                          </div>
                        </div>

                        <div className="text-[11px] text-gray-400 mt-3 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                          <span>Next run: {new Date(sched.nextRunAt).toLocaleDateString()}</span>
                          <span className={sched.isActive ? "text-emerald-500 font-bold" : "text-gray-400"}>
                            {sched.isActive ? "Active" : "Paused"}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Generated Reports History */}
              <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
                <div className="flex items-center justify-between pb-4 border-b border-gray-100 dark:border-gray-800">
                  <div>
                    <h3 className="text-base font-bold text-gray-900 dark:text-white">Generated Reports Archive</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Print-ready executive briefs with embedded KPIs and disclosure telemetry
                    </p>
                  </div>
                  <button
                    onClick={() => setShowGenerateModal(true)}
                    className="btn btn-secondary flex items-center gap-1.5 text-xs"
                  >
                    <FileText size={13} />
                    <span>Generate On-Demand</span>
                  </button>
                </div>

                {reports.length === 0 ? (
                  <div className="py-8 text-center text-gray-400 text-xs">
                    No reports generated yet. Click &quot;Generate On-Demand&quot; to create your first executive brief.
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-gray-100 dark:divide-gray-800 mt-3">
                    {reports.map((rep) => (
                      <div key={rep.id} className="py-3.5 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400">
                            <FileText size={18} />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-gray-900 dark:text-white">{rep.title}</span>
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800 uppercase">
                                {rep.format}
                              </span>
                              <span className="text-[10px] text-gray-400">Window: {rep.dateWindowDays}d</span>
                            </div>
                            <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
                              Generated {new Date(rep.createdAt).toLocaleString()}
                              {rep.deliveredEmails.length > 0 && ` • Dispatched to ${rep.deliveredEmails.length} recipient(s)`}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handlePreviewHtml(rep.id, rep.title)}
                            className="px-2.5 py-1 text-xs font-semibold rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-1"
                          >
                            <Eye size={13} />
                            <span>Preview</span>
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* MODAL: CREATE ALERT RULE */}
      {showRuleModal && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-lg">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold">Create Real-Time Alert Rule</h3>
              <button onClick={() => setShowRuleModal(false)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateRule} className="flex flex-col gap-3 mt-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Critical Visibility Drop Alert"
                  value={ruleName}
                  onChange={(e) => setRuleName(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Rule Type</label>
                  <select
                    value={ruleType}
                    onChange={(e) => setRuleType(e.target.value as AlertRuleType)}
                    className="input-field w-full"
                  >
                    <option value="visibility_drop">Visibility Drop (z-test)</option>
                    <option value="competitor_overtake">Competitor Overtake</option>
                    <option value="lost_citation">Lost Citations</option>
                    <option value="crawl_blockage">Crawl Blockage (robots.txt)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Severity</label>
                  <select
                    value={ruleSeverity}
                    onChange={(e) => setRuleSeverity(e.target.value as AlertSeverity)}
                    className="input-field w-full"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              {/* Dynamic Threshold Inputs */}
              {ruleType === "visibility_drop" && (
                <div>
                  <label className="font-semibold block mb-1">Drop Threshold (%) with p &lt; 0.05</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={dropThreshold}
                    onChange={(e) => setDropThreshold(Number(e.target.value))}
                    className="input-field w-full"
                  />
                  <p className="text-[11px] text-gray-500 mt-1">
                    Triggers when brand share drops by &ge; {dropThreshold}% with statistical significance (z &ge; 1.96).
                  </p>
                </div>
              )}

              {ruleType === "competitor_overtake" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="font-semibold block mb-1">Competitor Domain (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. competitor.com"
                      value={competitorDomain}
                      onChange={(e) => setCompetitorDomain(e.target.value)}
                      className="input-field w-full"
                    />
                  </div>
                  <div>
                    <label className="font-semibold block mb-1">Overtake Lead Gap (%)</label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={overtakeGap}
                      onChange={(e) => setOvertakeGap(Number(e.target.value))}
                      className="input-field w-full"
                    />
                  </div>
                </div>
              )}

              {ruleType === "lost_citation" && (
                <div>
                  <label className="font-semibold block mb-1">Monitored Citation Domain</label>
                  <input
                    type="text"
                    placeholder="e.g. wikipedia.org or leave blank for any"
                    value={competitorDomain}
                    onChange={(e) => setCompetitorDomain(e.target.value)}
                    className="input-field w-full"
                  />
                </div>
              )}

              {ruleType === "crawl_blockage" && (
                <div>
                  <label className="font-semibold block mb-1">AI Crawler User-Agent</label>
                  <select
                    value={crawlAgent}
                    onChange={(e) => setCrawlAgent(e.target.value)}
                    className="input-field w-full"
                  >
                    <option value="GPTBot">GPTBot (OpenAI Web Crawl)</option>
                    <option value="OAI-SearchBot">OAI-SearchBot (SearchGPT)</option>
                    <option value="Google-Extended">Google-Extended (Gemini Training)</option>
                    <option value="PerplexityBot">PerplexityBot</option>
                    <option value="ClaudeBot">ClaudeBot</option>
                  </select>
                </div>
              )}

              <div>
                <label className="font-semibold block mb-1">Notification Channels</label>
                <div className="flex gap-4 items-center">
                  {["in_app", "email", "webhook"].map((ch) => (
                    <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={ruleChannels.includes(ch)}
                        onChange={(e) => {
                          if (e.target.checked) setRuleChannels([...ruleChannels, ch]);
                          else setRuleChannels(ruleChannels.filter((c) => c !== ch));
                        }}
                      />
                      <span className="uppercase text-[11px] font-medium">{ch.replace("_", " ")}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Cooldown Window (Hours)</label>
                <input
                  type="number"
                  min={1}
                  max={168}
                  value={ruleCooldown}
                  onChange={(e) => setRuleCooldown(Number(e.target.value))}
                  className="input-field w-full"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Prevents alert storms by enforcing a deduplication quiet period between triggers.
                </p>
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowRuleModal(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-xs">
                  Create Alert Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: RESOLVE INCIDENT */}
      {showResolveModal && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold">Resolve Incident</h3>
              <button onClick={() => setShowResolveModal(null)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <div className="mt-3 text-xs">
              <p className="font-semibold text-gray-800 dark:text-gray-200">{showResolveModal.title}</p>
              <p className="text-gray-500 mt-1">{showResolveModal.message}</p>

              <label className="font-semibold block mt-4 mb-1">Resolution Notes (Optional)</label>
              <textarea
                rows={3}
                placeholder="Explain the mitigation or root cause remediation..."
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                className="input-field w-full"
              />

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(null)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResolveIncident}
                  className="btn btn-primary text-xs bg-emerald-600 hover:bg-emerald-700"
                >
                  Mark as Resolved
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: CREATE SCHEDULE */}
      {showScheduleModal && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold">Schedule Recurring Executive Report</h3>
              <button onClick={() => setShowScheduleModal(false)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateSchedule} className="flex flex-col gap-3 mt-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Schedule Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Weekly Executive AEO Intelligence Brief"
                  value={schedTitle}
                  onChange={(e) => setSchedTitle(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Cadence</label>
                  <select
                    value={schedCadence}
                    onChange={(e) => setSchedCadence(e.target.value as ReportCadence)}
                    className="input-field w-full"
                  >
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Format</label>
                  <select
                    value={schedFormat}
                    onChange={(e) => setSchedFormat(e.target.value as ReportFormat)}
                    className="input-field w-full"
                  >
                    <option value="pdf">PDF Document</option>
                    <option value="html">HTML Email/Web</option>
                    <option value="json">JSON Telemetry</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Recipient Emails (Comma separated)</label>
                <input
                  type="text"
                  required
                  placeholder="executive@brand.com, marketing@brand.com"
                  value={schedRecipients}
                  onChange={(e) => setSchedRecipients(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowScheduleModal(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary text-xs">
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: ON-DEMAND REPORT GENERATION */}
      {showGenerateModal && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold">Generate On-Demand Executive Report</h3>
              <button onClick={() => setShowGenerateModal(false)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleGenerateOnDemand} className="flex flex-col gap-3 mt-4 text-xs">
              <div>
                <label className="font-semibold block mb-1">Report Title</label>
                <input
                  type="text"
                  placeholder={`${project.brandName} Executive Intelligence Brief`}
                  value={genTitle}
                  onChange={(e) => setGenTitle(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Analysis Window</label>
                  <select
                    value={genPeriodDays}
                    onChange={(e) => setGenPeriodDays(Number(e.target.value))}
                    className="input-field w-full"
                  >
                    <option value={7}>Last 7 Days</option>
                    <option value={14}>Last 14 Days</option>
                    <option value={30}>Last 30 Days</option>
                    <option value={90}>Last 90 Days</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Output Format</label>
                  <select
                    value={genFormat}
                    onChange={(e) => setGenFormat(e.target.value as ReportFormat)}
                    className="input-field w-full"
                  >
                    <option value="pdf">PDF Document</option>
                    <option value="html">HTML Email/Web</option>
                    <option value="json">JSON Telemetry</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Email Delivery (Optional)</label>
                <input
                  type="text"
                  placeholder="Send copy to: ceo@brand.com"
                  value={genRecipients}
                  onChange={(e) => setGenRecipients(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowGenerateModal(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={generating}
                  className="btn btn-primary text-xs flex items-center gap-1.5"
                >
                  {generating ? (
                    <>
                      <RefreshCw size={13} className="animate-spin" />
                      <span>Compiling...</span>
                    </>
                  ) : (
                    <>
                      <FileText size={13} />
                      <span>Generate Now</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: HTML REPORT PREVIEW */}
      {previewReportHtml && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-4xl h-[85vh] flex flex-col p-0 overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
              <div className="flex items-center gap-2">
                <FileText size={16} className="text-blue-600" />
                <h3 className="text-sm font-bold">{previewReportHtml.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const printWin = window.open("", "_blank");
                    if (printWin) {
                      printWin.document.write(previewReportHtml.html);
                      printWin.document.close();
                      printWin.focus();
                      setTimeout(() => printWin.print(), 250);
                    }
                  }}
                  className="btn btn-secondary text-xs flex items-center gap-1.5"
                >
                  <Download size={13} />
                  <span>Print / Save PDF</span>
                </button>
                <button
                  onClick={() => setPreviewReportHtml(null)}
                  className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 text-gray-500"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-white">
              <iframe
                title="Report Preview"
                srcDoc={previewReportHtml.html}
                className="w-full h-full border-0"
              />
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
