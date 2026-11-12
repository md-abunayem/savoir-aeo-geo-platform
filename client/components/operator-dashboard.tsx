"use client";

import { useState, useCallback } from "react";
import {
  Sliders,
  Search,
  RefreshCw,
  Pause,
  Play,
  Coins,
  Activity,
  History,
  CheckCircle2,
  X,
  Key,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import styles from "./workspace-sections.module.css";
import type {
  OperatorTenantSummary,
  QueueHealthStats,
  OperatorAuditLog,
  CreditCategory,
} from "../lib/types";

export function OperatorDashboard() {
  const [operatorKey, setOperatorKey] = useState<string>("");
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"tenants" | "queues" | "logs">("tenants");

  // State
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [credentialError, setCredentialError] = useState<string | null>(null);

  // Tab 1: Tenant Directory
  const [tenants, setTenants] = useState<OperatorTenantSummary[]>([]);
  const [totalTenants, setTotalTenants] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  // Modals
  const [selectedTenant, setSelectedTenant] = useState<OperatorTenantSummary | null>(null);
  const [showStatusModal, setShowStatusModal] = useState<"pause" | "resume" | null>(null);
  const [statusReason, setStatusReason] = useState("");

  const [showCreditModal, setShowCreditModal] = useState<boolean>(false);
  const [adjustCategory, setAdjustCategory] = useState<CreditCategory>("monitoring");
  const [adjustAmount, setAdjustAmount] = useState<number>(500);
  const [adjustReason, setAdjustReason] = useState<string>("");

  // Tab 2: Queues
  const [queues, setQueues] = useState<QueueHealthStats[]>([]);

  // Tab 3: Audit Logs
  const [logs, setLogs] = useState<OperatorAuditLog[]>([]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const getHeaders = useCallback(() => {
    return {
      "X-Operator-Key": operatorKey.trim(),
    };
  }, [operatorKey]);

  // Fetch Tenants
  const fetchTenants = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set("query", searchQuery);
      if (planFilter !== "all") params.set("planTier", planFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await api.request<{ tenants: OperatorTenantSummary[]; totalCount: number }>(
        `/v1/operator/tenants?${params.toString()}`,
        { headers: getHeaders() },
      );
      setTenants(res.tenants);
      setTotalTenants(res.totalCount);
      setIsConnected(true);
      setCredentialError(null);
      return true;
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setIsConnected(false);
      }
      setCredentialError(
        err instanceof ApiError && (err.status === 401 || err.status === 403)
          ? "The operator key was rejected. Check the configured key and try again."
          : err instanceof ApiError
            ? err.message
            : "Could not authenticate with the operator service.",
      );
      return false;
    }
  }, [searchQuery, planFilter, statusFilter, getHeaders]);

  // Fetch Queues
  const fetchQueues = useCallback(async () => {
    try {
      const res = await api.request<QueueHealthStats[]>("/v1/operator/queues", {
        headers: getHeaders(),
      });
      setQueues(res);
    } catch (err) {
      console.error("Failed to load queue telemetry", err);
    }
  }, [getHeaders]);

  // Fetch Audit Logs
  const fetchLogs = useCallback(async () => {
    try {
      const res = await api.request<OperatorAuditLog[]>("/v1/operator/audit-logs?limit=50", {
        headers: getHeaders(),
      });
      setLogs(res);
    } catch (err) {
      console.error("Failed to load operator audit logs", err);
    }
  }, [getHeaders]);

  const handleRefresh = async () => {
    setRefreshing(true);
    if (activeTab === "tenants") await fetchTenants();
    if (activeTab === "queues") await fetchQueues();
    if (activeTab === "logs") await fetchLogs();
    setRefreshing(false);
    showToast("Operator telemetry updated.");
  };

  const handleAuthenticate = async () => {
    setLoading(true);
    const authenticated = await fetchTenants();
    if (authenticated) await Promise.all([fetchQueues(), fetchLogs()]);
    setLoading(false);
  };

  const handleTabChange = (tab: "tenants" | "queues" | "logs") => {
    setActiveTab(tab);
    if (tab === "tenants") fetchTenants();
    else if (tab === "queues") fetchQueues();
    else if (tab === "logs") fetchLogs();
  };

  const handleUpdateTenantStatus = async () => {
    if (!selectedTenant || !showStatusModal) return;
    const newStatus = showStatusModal === "pause" ? "paused" : "active";
    try {
      await api.request(`/v1/operator/tenants/${selectedTenant.id}/status`, {
        method: "POST",
        headers: getHeaders(),
        body: {
          status: newStatus,
          reason: statusReason.trim() || `Administrative ${newStatus} operation`,
        },
      });

      showToast(`Tenant ${selectedTenant.name} is now ${newStatus}.`);
      setShowStatusModal(null);
      setSelectedTenant(null);
      setStatusReason("");
      fetchTenants();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to update tenant status";
      showToast(msg);
    }
  };

  const handleAdjustCredits = async () => {
    if (!selectedTenant) return;
    try {
      const res = await api.request<{ balanceAfter: number }>(
        `/v1/operator/tenants/${selectedTenant.id}/credits`,
        {
          method: "POST",
          headers: getHeaders(),
          body: {
            category: adjustCategory,
            amount: adjustAmount,
            reason: adjustReason.trim() || "Administrative adjustment",
          },
        },
      );

      showToast(`Adjusted credits for ${selectedTenant.name}. New balance: ${res.balanceAfter.toLocaleString()}`);
      setShowCreditModal(false);
      setSelectedTenant(null);
      setAdjustReason("");
      fetchTenants();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : "Failed to adjust credits";
      showToast(msg);
    }
  };

  return (
    <div className={`${styles.page} ${styles.reportingPage} ${styles.operatorPage}`}>
      {/* Toast */}
      {toastMessage && (
        <div className="toast-banner">
          <CheckCircle2 size={16} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Header */}
      <div className={`reporting-header ${styles.header} ${styles.reportingHeader}`}>
        <div className={styles.headerCopy}>
          <p className={`${styles.eyebrow} ${styles.reportingEyebrow}`}>
            <Sliders size={13} />
            <span>M15 PLATFORM ADMINISTRATION</span>
          </p>
          <h1 className={styles.sectionTitle}>Internal Operator Console</h1>
          <p className={styles.description}>
            Global tenant directory search, manual credit adjustments, queue health telemetry, and lifecycle controls.
          </p>
        </div>

        <div className={`${styles.headerActions} ${styles.reportingHeaderActions}`}>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn btn-secondary flex items-center gap-2"
          >
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Operator Credential Bar */}
      <div className={styles.operatorCredentialCard}>
        <form
          className={styles.operatorCredentialForm}
          onSubmit={(event) => {
            event.preventDefault();
            void handleAuthenticate();
          }}
        >
          <div className={styles.operatorCredentialHeading}>
            <span className={styles.operatorCredentialIcon}>
              <Key size={16} />
            </span>
            <div>
              <h2>Operator authentication</h2>
              <p>Enter the configured key to access administrative controls.</p>
            </div>
          </div>
          <div className={styles.operatorCredentialControls}>
            <label className={styles.operatorCredentialLabel} htmlFor="operator-key">
              Operator key
            </label>
            <div className={styles.operatorCredentialInputRow}>
              <input
                id="operator-key"
                type="password"
                autoComplete="current-password"
                placeholder="Enter operator key"
                value={operatorKey}
                onChange={(e) => {
                  setOperatorKey(e.target.value);
                  setCredentialError(null);
                }}
                className={`input-field ${styles.operatorCredentialInput}`}
              />
              <button
                type="submit"
                disabled={!operatorKey.trim() || loading}
                className="btn btn-primary text-xs"
              >
                {loading ? "Verifying..." : "Authenticate"}
              </button>
            </div>
          </div>
        </form>

        <div
          className={`${styles.operatorAuthStatus} ${
            isConnected ? styles.operatorAuthConnected : styles.operatorAuthPending
          }`}
          role="status"
          aria-live="polite"
        >
          <span className={styles.operatorAuthDot} />
          <span>
            <strong>{isConnected ? "Authenticated" : "Not authenticated"}</strong>
            <small>
              {isConnected
                ? "Operator access is active for this session."
                : "Authenticate to load protected platform data."}
            </small>
          </span>
        </div>
      </div>
      {credentialError && (
        <div className={styles.operatorCredentialError} role="alert">
          {credentialError}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className={`reporting-tabs ${styles.reportingTabs}`}>
        <button
          onClick={() => handleTabChange("tenants")}
          disabled={!isConnected}
          className={`${styles.reportingTab} ${activeTab === "tenants" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "tenants"}
        >
          <Search size={16} />
          <span>Tenant Directory ({totalTenants})</span>
        </button>

        <button
          onClick={() => handleTabChange("queues")}
          disabled={!isConnected}
          className={`${styles.reportingTab} ${activeTab === "queues" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "queues"}
        >
          <Activity size={16} />
          <span>Queue Health &amp; Telemetry</span>
        </button>

        <button
          onClick={() => handleTabChange("logs")}
          disabled={!isConnected}
          className={`${styles.reportingTab} ${activeTab === "logs" ? styles.activeReportingTab : ""}`}
          aria-pressed={activeTab === "logs"}
        >
          <History size={16} />
          <span>Operator Audit Trail</span>
        </button>
      </div>

      {loading ? (
        <div className="py-20 flex flex-col items-center justify-center text-gray-400">
          <RefreshCw size={28} className="animate-spin mb-3 text-blue-500" />
          <p className="text-sm font-medium">Querying platform administration database...</p>
        </div>
      ) : !isConnected ? (
        <div className={styles.operatorAccessEmpty}>
          <span className={styles.operatorCredentialIcon}>
            <Key size={18} />
          </span>
          <h2>Authenticate to continue</h2>
          <p>Platform tenant, queue, and audit data will appear here after operator access is verified.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {/* TAB 1: TENANTS */}
          {activeTab === "tenants" && (
            <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col gap-4">
              {/* Search & Filter Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b dark:border-gray-800">
                <div className="flex items-center gap-2 flex-1">
                  <div className="relative flex-1 max-w-sm">
                    <Search size={14} className="absolute left-3 top-3 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search tenant name, ID, or domain..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && fetchTenants()}
                      className="input-field pl-9 w-full text-xs"
                    />
                  </div>
                  <button onClick={fetchTenants} className="btn btn-secondary text-xs">
                    Search
                  </button>
                </div>

                <div className="flex items-center gap-3 text-xs">
                  <div>
                    <span className="text-gray-400 mr-1.5">Plan:</span>
                    <select
                      value={planFilter}
                      onChange={(e) => setPlanFilter(e.target.value)}
                      className="input-field py-1 text-xs"
                    >
                      <option value="all">All Plans</option>
                      <option value="starter">Starter</option>
                      <option value="growth">Growth</option>
                      <option value="enterprise">Enterprise</option>
                    </select>
                  </div>
                  <div>
                    <span className="text-gray-400 mr-1.5">Status:</span>
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="input-field py-1 text-xs"
                    >
                      <option value="all">All Statuses</option>
                      <option value="active">Active</option>
                      <option value="paused">Paused</option>
                      <option value="archived">Archived</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Tenants Table */}
              {tenants.length === 0 ? (
                <div className="py-12 text-center text-gray-400 text-xs">
                  No tenants matching criteria.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className={`w-full text-xs text-left ${styles.operatorTable}`}>
                    <thead>
                      <tr className="border-b dark:border-gray-800 text-gray-400 font-semibold">
                        <th className="py-2.5 px-3">Organization</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Plan</th>
                        <th className="py-2.5 px-3">Monitoring Credits</th>
                        <th className="py-2.5 px-3">Crawl Credits</th>
                        <th className="py-2.5 px-3">Projects</th>
                        <th className="py-2.5 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {tenants.map((t) => (
                        <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="py-2.5 px-3">
                            <div className="font-bold text-gray-900 dark:text-white">{t.name}</div>
                            <div className="text-[10px] text-gray-400 font-mono">{t.primaryDomain || t.id}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                t.status === "active"
                                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                                  : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                              }`}
                            >
                              {t.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 capitalize font-semibold text-gray-700 dark:text-gray-300">
                            {t.planTier}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-amber-600 dark:text-amber-400">
                            {t.availableCredits.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-blue-600 dark:text-blue-400">
                            {t.availableCrawlCredits.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 text-gray-500">
                            {t.projectCount} ({t.memberCount} members)
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => {
                                  setSelectedTenant(t);
                                  setShowCreditModal(true);
                                }}
                                className="px-2 py-1 text-[11px] font-semibold rounded border border-gray-300 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                Adjust Credits
                              </button>
                              {t.status === "active" ? (
                                <button
                                  onClick={() => {
                                    setSelectedTenant(t);
                                    setShowStatusModal("pause");
                                  }}
                                  className="px-2 py-1 text-[11px] font-semibold rounded border border-rose-300 text-rose-700 bg-rose-50 hover:bg-rose-100 dark:border-rose-800 dark:bg-rose-950/40"
                                >
                                  Pause
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setSelectedTenant(t);
                                    setShowStatusModal("resume");
                                  }}
                                  className="px-2 py-1 text-[11px] font-semibold rounded border border-emerald-300 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40"
                                >
                                  Resume
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: QUEUES */}
          {activeTab === "queues" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {queues.map((q) => (
                <div
                  key={q.queueName}
                  className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-bold text-sm text-gray-900 dark:text-white font-mono">
                        {q.queueName}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          q.status === "healthy"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            : "bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300"
                        }`}
                      >
                        {q.status}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs my-3">
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/40">
                        <div className="text-gray-400 text-[10px]">WAITING / QUEUED</div>
                        <div className="text-xl font-bold text-gray-900 dark:text-white mt-0.5">
                          {q.waiting}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/40">
                        <div className="text-gray-400 text-[10px]">ACTIVE / PROCESSING</div>
                        <div className="text-xl font-bold text-blue-600 mt-0.5">
                          {q.active}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/40">
                        <div className="text-gray-400 text-[10px]">FAILED</div>
                        <div className={`text-xl font-bold mt-0.5 ${q.failed > 0 ? "text-rose-600" : "text-gray-400"}`}>
                          {q.failed}
                        </div>
                      </div>
                      <div className="p-2.5 rounded bg-gray-50 dark:bg-gray-800/40">
                        <div className="text-gray-400 text-[10px]">COMPLETED TODAY</div>
                        <div className="text-xl font-bold text-emerald-600 mt-0.5">
                          {q.completedToday}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-[11px] text-gray-400 pt-3 border-t dark:border-gray-800 flex items-center justify-between">
                    <span>BullMQ &amp; PostgreSQL Engine</span>
                    <span className="text-emerald-500 font-semibold">Active Workers</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 3: AUDIT LOGS */}
          {activeTab === "logs" && (
            <div className="panel p-5 border rounded-xl bg-white dark:bg-gray-900 shadow-sm">
              <div className="pb-3 border-b dark:border-gray-800">
                <h3 className="text-base font-bold text-gray-900 dark:text-white">Operator Audit Log</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Immutable security trail of all administrative actions, credit adjustments, and tenant state changes
                </p>
              </div>

              {logs.length === 0 ? (
                <div className="py-10 text-center text-gray-400 text-xs">
                  No operator actions recorded yet.
                </div>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <table className={`w-full text-xs text-left ${styles.operatorTable}`}>
                    <thead>
                      <tr className="border-b dark:border-gray-800 text-gray-400 font-semibold">
                        <th className="py-2.5 px-3">Date</th>
                        <th className="py-2.5 px-3">Operator</th>
                        <th className="py-2.5 px-3">Action</th>
                        <th className="py-2.5 px-3">Target Tenant</th>
                        <th className="py-2.5 px-3">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {logs.map((l) => (
                        <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                          <td className="py-2.5 px-3 text-gray-500">
                            {new Date(l.createdAt).toLocaleString()}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-gray-800 dark:text-gray-200">
                            {l.operatorId}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                              {l.action}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-gray-700 dark:text-gray-300">
                            {l.targetTenantName || l.targetTenantId || "System"}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-[11px] text-gray-500 max-w-sm truncate">
                            {JSON.stringify(l.details)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* MODAL: PAUSE / RESUME TENANT */}
      {showStatusModal && selectedTenant && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold flex items-center gap-2">
                {showStatusModal === "pause" ? (
                  <Pause size={16} className="text-rose-500" />
                ) : (
                  <Play size={16} className="text-emerald-500" />
                )}
                <span>
                  {showStatusModal === "pause" ? "Pause Tenant Operations" : "Resume Tenant Operations"}
                </span>
              </h3>
              <button onClick={() => setShowStatusModal(null)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <div className="my-4 text-xs">
              <p className="text-gray-600 dark:text-gray-300 leading-relaxed mb-3">
                {showStatusModal === "pause"
                  ? `Pausing ${selectedTenant.name} will immediately suspend all scheduled monitoring runs and web crawling jobs. Active runs will complete but no new items will be claimed.`
                  : `Resuming ${selectedTenant.name} will allow scheduled monitoring runs to be queued and claimed again.`}
              </p>

              <label className="font-semibold block mb-1">Administrative Reason (Required for Audit Trail)</label>
              <textarea
                rows={3}
                required
                placeholder="e.g. Requested by customer billing investigation ticket #4021"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
                className="input-field w-full"
              />

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowStatusModal(null)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleUpdateTenantStatus}
                  className={`btn text-xs font-bold ${
                    showStatusModal === "pause"
                      ? "btn-primary bg-rose-600 hover:bg-rose-700"
                      : "btn-primary bg-emerald-600 hover:bg-emerald-700"
                  }`}
                >
                  {showStatusModal === "pause" ? "Confirm Pause" : "Confirm Resume"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADJUST CREDITS */}
      {showCreditModal && selectedTenant && (
        <div className="modal-backdrop">
          <div className="modal-content max-w-md">
            <div className="flex items-center justify-between pb-3 border-b dark:border-gray-800">
              <h3 className="text-sm font-bold flex items-center gap-2">
                <Coins size={16} className="text-amber-500" />
                <span>Adjust Credits: {selectedTenant.name}</span>
              </h3>
              <button onClick={() => setShowCreditModal(false)} className="text-gray-400 hover:text-black">
                <X size={16} />
              </button>
            </div>

            <div className="my-4 text-xs flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold block mb-1">Credit Category</label>
                  <select
                    value={adjustCategory}
                    onChange={(e) => setAdjustCategory(e.target.value as CreditCategory)}
                    className="input-field w-full"
                  >
                    <option value="monitoring">Monitoring Runs</option>
                    <option value="crawl">Crawl Pages</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold block mb-1">Adjustment Amount (+/-)</label>
                  <input
                    type="number"
                    value={adjustAmount}
                    onChange={(e) => setAdjustAmount(Number(e.target.value))}
                    className="input-field w-full font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="font-semibold block mb-1">Mandatory Operational Reason</label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. VIP onboarding credit grant or service disruption compensation"
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  className="input-field w-full"
                />
              </div>

              <div className="flex justify-end gap-2 mt-4 pt-3 border-t dark:border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowCreditModal(false)}
                  className="btn btn-secondary text-xs"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAdjustCredits}
                  className="btn btn-primary text-xs"
                >
                  Apply Credit Adjustment
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
