"use client";

import { useEffect, useState } from "react";
import {
  CheckSquare,
  Sparkles,
  Download,
  Search,
  RefreshCw,
  Plus,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Clock,
  User,
  Copy,
  Check,
  Code,
  ShieldAlert,
  Send,
  Kanban,
  List,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import styles from "./workspace-sections.module.css";
import type {
  Project,
  ActionItemRecord,
  ActionCommentRecord,
  ActionStats,
  ActionCategory,
  ActionStatus,
  ActionEffort,
} from "../lib/types";

interface ActionCenterProps {
  tenantId: string;
  project: Project;
}

export function ActionCenter({ tenantId, project }: ActionCenterProps) {
  const [items, setItems] = useState<ActionItemRecord[]>([]);
  const [stats, setStats] = useState<ActionStats>({
    total: 0,
    todo: 0,
    inProgress: 0,
    done: 0,
    dismissed: 0,
    backlog: 0,
    avgPriority: 0,
    byCategory: {},
  });

  const [loading, setLoading] = useState(true);
  const [harvesting, setHarvesting] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [selectedAction, setSelectedAction] = useState<ActionItemRecord | null>(null);
  const [comments, setComments] = useState<ActionCommentRecord[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [updatingActionId, setUpdatingActionId] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [submittingComment, setSubmittingComment] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Filters & Views
  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [effortFilter, setEffortFilter] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<"priority" | "dueDate" | "created">("priority");

  // Selection for bulk edits
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState<ActionStatus | "">("");

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newCategory, setNewCategory] = useState<ActionCategory>("technical");
  const [newImpact, setNewImpact] = useState(5);
  const [newConfidence, setNewConfidence] = useState(0.8);
  const [newEffort, setNewEffort] = useState<ActionEffort>("M");
  const [newOwner, setNewOwner] = useState("");
  const [newDueDate, setNewDueDate] = useState("");
  const [creatingAction, setCreatingAction] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const basePath = `/v1/tenants/${tenantId}/projects/${project.id}/actions`;

  // Fetch actions
  const fetchActions = async () => {
    try {
      const params = new URLSearchParams();
      if (categoryFilter) params.set("category", categoryFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (effortFilter) params.set("effort", effortFilter);
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      params.set("sortBy", sortBy);
      params.set("limit", "100");

      const res = await api.request<{
        items: ActionItemRecord[];
        total: number;
        stats: ActionStats;
      }>(`${basePath}?${params.toString()}`);

      if (res) {
        setItems(res.items || []);
        setStats(res.stats || stats);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load action items");
    }
  };

  // Initial load
  useEffect(() => {
    let ignore = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      await fetchActions();
      if (!ignore) setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryFilter, statusFilter, effortFilter, sortBy, searchQuery]);

  // Fetch comments when an action is opened
  useEffect(() => {
    let ignore = false;
    if (!selectedAction) return;

    const loadComments = async () => {
      setLoadingComments(true);
      setCommentsError(null);
      try {
        const res = await api.request<ActionCommentRecord[]>(
          `${basePath}/${selectedAction.id}/comments`,
        );
        if (!ignore && res) {
          setComments(res);
          setCommentsError(null);
        }
      } catch (err) {
        if (!ignore) {
          setCommentsError(err instanceof ApiError ? err.message : "Could not load comments.");
        }
      } finally {
        if (!ignore) setLoadingComments(false);
      }
    };
    loadComments();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAction?.id]);

  // Harvest findings across M5-M16
  const handleHarvest = async () => {
    setHarvesting(true);
    setError(null);
    try {
      const res = await api.request<{
        harvestedCount: number;
        createdCount: number;
        deduplicatedCount: number;
      }>(`${basePath}/harvest`, { method: "POST" });

      if (res) {
        setSuccessMessage(
          `Harvest complete: Found ${res.harvestedCount} findings (${res.createdCount} new, ${res.deduplicatedCount} merged).`,
        );
        await fetchActions();
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to harvest actions");
    } finally {
      setHarvesting(false);
    }
  };

  // Update Status of single action
  const handleStatusChange = async (id: string, newStatus: ActionStatus) => {
    setUpdatingActionId(id);
    setError(null);
    try {
      const updated = await api.request<ActionItemRecord>(`${basePath}/${id}`, {
        method: "PATCH",
        body: { status: newStatus },
      });

      if (updated) {
        setItems((prev) => prev.map((item) => (item.id === id ? updated : item)));
        if (selectedAction?.id === id) setSelectedAction(updated);
        await fetchActions();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update action status");
    } finally {
      setUpdatingActionId(null);
    }
  };

  // Bulk update
  const handleBulkUpdate = async () => {
    if (selectedIds.length === 0 || !bulkStatus) return;
    try {
      await api.request(`${basePath}/bulk`, {
        method: "PATCH",
        body: { ids: selectedIds, status: bulkStatus },
      });
      setSelectedIds([]);
      setBulkStatus("");
      setSuccessMessage(`Updated ${selectedIds.length} actions.`);
      await fetchActions();
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to perform bulk update");
    }
  };

  // Trigger closed-loop verification
  const handleVerify = async (actionId: string) => {
    setVerifying(true);
    setError(null);
    try {
      const res = await api.request<{
        status: "verified" | "not_verified" | "inconclusive";
        notes: string;
      }>(`${basePath}/${actionId}/verify`, { method: "POST" });

      if (res) {
        setSuccessMessage(`Verification outcome: ${res.status.toUpperCase()} - ${res.notes}`);
        const fresh = await api.request<ActionItemRecord>(`${basePath}/${actionId}`);
        if (fresh) {
          setItems((prev) => prev.map((it) => (it.id === actionId ? fresh : it)));
          if (selectedAction?.id === actionId) setSelectedAction(fresh);
        }
        setTimeout(() => setSuccessMessage(null), 5000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification probe failed");
    } finally {
      setVerifying(false);
    }
  };

  // Add comment
  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAction || !newComment.trim()) return;

    setSubmittingComment(true);
    try {
      const c = await api.request<ActionCommentRecord>(
        `${basePath}/${selectedAction.id}/comments`,
        {
          method: "POST",
          body: { body: newComment.trim() },
        },
      );
      if (c) {
        setComments((prev) => [...prev, c]);
        setNewComment("");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to add comment");
    } finally {
      setSubmittingComment(false);
    }
  };

  // Create manual action
  const handleCreateAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newDescription.trim()) return;

    setCreatingAction(true);
    setError(null);
    try {
      const created = await api.request<ActionItemRecord>(basePath, {
        method: "POST",
        body: {
          title: newTitle.trim(),
          description: newDescription.trim(),
          category: newCategory,
          impact: newImpact,
          confidence: newConfidence,
          effort: newEffort,
          owner: newOwner.trim() || undefined,
          dueDate: newDueDate ? new Date(newDueDate).toISOString() : undefined,
        },
      });

      if (created) {
        setShowCreateModal(false);
        setNewTitle("");
        setNewDescription("");
        setSuccessMessage("Custom action item created successfully.");
        await fetchActions();
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create action");
    } finally {
      setCreatingAction(false);
    }
  };

  // Copy code helper
  const handleCopyCode = (codeText: string) => {
    navigator.clipboard.writeText(codeText);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Render Verification Badge
  const renderVerificationBadge = (vStatus: string) => {
    switch (vStatus) {
      case "verified":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
            <CheckCircle2 className="w-3 h-3" />
            <span>Verified</span>
          </span>
        );
      case "not_verified":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-600 border border-red-500/20">
            <XCircle className="w-3 h-3" />
            <span>Not Verified</span>
          </span>
        );
      case "inconclusive":
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
            <AlertCircle className="w-3 h-3" />
            <span>Inconclusive</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-muted text-muted-foreground border border-border">
            <Clock className="w-3 h-3" />
            <span>Pending Probe</span>
          </span>
        );
    }
  };

  // Render Effort Badge
  const renderEffortBadge = (effort: ActionEffort) => {
    const color =
      effort === "S"
        ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20"
        : effort === "M"
          ? "bg-blue-500/10 text-blue-600 border-blue-500/20"
          : "bg-purple-500/10 text-purple-600 border-purple-500/20";
    return (
      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${color}`}>
        Effort: {effort}
      </span>
    );
  };

  const columns: ActionStatus[] = ["backlog", "todo", "in_progress", "done", "dismissed"];
  const columnTitles: Record<ActionStatus, string> = {
    backlog: "Backlog",
    todo: "To Do",
    in_progress: "In Progress",
    done: "Completed",
    dismissed: "Dismissed",
  };

  return (
    <div className={`${styles.page} ${styles.actionPage} space-y-6`}>
      <header className={`${styles.header} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>OPTIMIZE · ACTION CENTER</p>
          <h1>Prioritize and manage recommendations</h1>
          <p className={styles.description}>
            Review project findings, track their status, and use the available evidence and fix guidance to decide what to address next.
          </p>
          <p className={styles.actionProject}>Selected project: {project.domain || "Not available"}</p>
        </div>
      </header>

      {/* Top Banner / Notification */}
      {error && (
        <div role="alert" className="p-3.5 rounded-xl border border-destructive/20 bg-destructive/10 text-destructive text-xs flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-xs font-bold">
            Dismiss
          </button>
        </div>
      )}

      {successMessage && (
        <div role="status" className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 text-xs flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* KPI Cards Row */}
      <div className={`${styles.summaryGrid} grid grid-cols-1 md:grid-cols-4 gap-4`}>
        <div className={`${styles.summaryCard} p-4 rounded-2xl border border-border bg-card shadow-xs space-y-1`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Total Actions
          </span>
          <div className={styles.summaryValue}>{loading ? "Not available" : stats.total}</div>
          <p className="text-[11px] text-muted-foreground">
            {loading ? "Loading project recommendations" : `${stats.todo} to do · ${stats.inProgress} in progress`}
          </p>
        </div>

        <div className={`${styles.summaryCard} p-4 rounded-2xl border border-border bg-card shadow-xs space-y-1`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Average priority score
          </span>
          <div className={styles.summaryValue}>
            {loading || stats.total === 0 ? "Not available" : `${stats.avgPriority} / 100`}
          </div>
          <span className="inline-block px-1.5 py-0.2 rounded text-[9px] uppercase font-bold tracking-wide bg-blue-500/10 text-blue-600 border border-blue-500/20">
            {stats.total > 0 ? "Modeled" : "No score data"}
          </span>
        </div>

        <div className={`${styles.summaryCard} p-4 rounded-2xl border border-border bg-card shadow-xs space-y-1`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            Marked completed
          </span>
          <div className={styles.summaryValue}>{loading ? "Not available" : stats.done}</div>
          <p className="text-[11px] text-muted-foreground">Status count; verification is shown per recommendation</p>
        </div>

        <div className={`${styles.summaryCard} p-4 rounded-2xl border border-border bg-card shadow-xs space-y-1`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            By Stream
          </span>
          <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[11px]">
            {Object.entries(stats.byCategory).length === 0 ? (
              <span className="text-muted-foreground">{loading ? "Not available" : "No category data"}</span>
            ) : Object.entries(stats.byCategory).map(([cat, count]) => (
              <span key={cat} className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground text-[10px]">
                {cat}: <strong>{count}</strong>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Main Action Bar */}
      <div className={`${styles.filterBar} ${styles.actionToolbar} flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 p-3.5 rounded-2xl border border-border bg-card shadow-xs`}>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View Mode Toggle */}
          <div className={`${styles.actionViewToggle} flex items-center border border-border rounded-xl p-0.5 bg-muted/30`}>
            <button
              type="button"
              aria-label="Kanban board view"
              aria-pressed={viewMode === "kanban"}
              onClick={() => setViewMode("kanban")}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === "kanban"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Kanban Board View"
            >
              <Kanban className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="List view"
              aria-pressed={viewMode === "list"}
              onClick={() => setViewMode("list")}
              className={`p-1.5 rounded-lg text-xs font-medium transition-colors ${
                viewMode === "list"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Table List View"
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* Search */}
          <div className={`${styles.actionSearch} relative`}>
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted-foreground" />
            <input
              type="text"
              aria-label="Search action recommendations"
              placeholder="Filter actions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground w-44 focus:outline-hidden focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Category Filter */}
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground"
          >
            <option value="">All Categories</option>
            <option value="technical">Technical</option>
            <option value="content">Content</option>
            <option value="citation">Citation</option>
            <option value="agent_readiness">Agent Readiness</option>
            <option value="accuracy">Accuracy</option>
            <option value="competitor">Competitor</option>
          </select>

          {/* Status Filter */}
          <select
            aria-label="Filter by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground"
          >
            <option value="">All Statuses</option>
            <option value="backlog">Backlog</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Completed</option>
            <option value="dismissed">Dismissed</option>
          </select>

          {/* Effort Filter */}
          <select
            aria-label="Filter by effort"
            value={effortFilter}
            onChange={(e) => setEffortFilter(e.target.value)}
            className="px-2.5 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground"
          >
            <option value="">All Efforts</option>
            <option value="S">Small (S)</option>
            <option value="M">Medium (M)</option>
            <option value="L">Large (L)</option>
          </select>

          {/* Sort By */}
          <select
            aria-label="Sort action recommendations"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "priority" | "dueDate" | "created")}
            className="px-2.5 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground"
          >
            <option value="priority">Sort: Highest Priority</option>
            <option value="dueDate">Sort: Due Date</option>
            <option value="created">Sort: Newest</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          {/* Harvest Findings Button */}
          <button
            type="button"
            disabled={harvesting}
            onClick={handleHarvest}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-muted text-xs font-semibold text-foreground transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${harvesting ? "animate-spin" : ""}`} />
            <span>Harvest Findings</span>
          </button>

          {/* Export CSV Button */}
          <a
            href={`${basePath}/export/csv`}
            download={`savoir-actions-${project.id}.csv`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border hover:bg-muted text-xs font-semibold text-foreground transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export CSV</span>
          </a>

          {/* New Action Button */}
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 transition-colors shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Action</span>
          </button>
        </div>
      </div>

      {/* Bulk Action Bar (When items selected in list view) */}
      {selectedIds.length > 0 && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-primary/10 border border-primary/20 text-xs">
          <span className="font-semibold text-foreground">
            {selectedIds.length} action{selectedIds.length > 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            <select
              value={bulkStatus}
              onChange={(e) => setBulkStatus(e.target.value as ActionStatus)}
              className="px-2 py-1 rounded-lg border border-border bg-background text-xs text-foreground"
            >
              <option value="">Move status to...</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="done">Completed</option>
              <option value="dismissed">Dismissed</option>
            </select>
            <button
              type="button"
              onClick={handleBulkUpdate}
              className="px-2.5 py-1 rounded-lg bg-primary text-primary-foreground font-semibold text-xs"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => setSelectedIds([])}
              className="px-2.5 py-1 rounded-lg border border-border text-muted-foreground hover:text-foreground text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Main Content: Kanban or List */}
      {loading ? (
        <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin text-primary" />
          <span>Loading Action Center...</span>
        </div>
      ) : items.length === 0 ? (
        <div className={`${styles.emptyState} p-12 text-center rounded-2xl border border-dashed border-border bg-card space-y-3`}>
          <CheckSquare className="w-8 h-8 text-muted-foreground mx-auto" />
          <h3 className="text-sm font-bold text-foreground">{error ? "Could not load recommendations" : "No recommendations found"}</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Click &quot;Harvest Findings&quot; to automatically convert technical audit issues, citation gaps, and content recommendations into prioritized action items.
          </p>
          {error && (
            <button type="button" className={styles.secondaryButton} onClick={fetchActions}>
              Try again
            </button>
          )}
          <button
            type="button"
            onClick={handleHarvest}
            disabled={harvesting}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Harvest Findings Now</span>
          </button>
        </div>
      ) : viewMode === "kanban" ? (
        /* KANBAN BOARD VIEW */
        <div className={`${styles.actionColumns} grid grid-cols-1 md:grid-cols-5 gap-4 items-start`}>
          {columns.map((colStatus) => {
            const colItems = items.filter((it) => it.status === colStatus);
            return (
              <div
                key={colStatus}
                className="rounded-2xl border border-border bg-muted/20 p-3 space-y-3"
              >
                <div className="flex items-center justify-between border-b border-border pb-2 px-1">
                  <span className="text-xs font-bold text-foreground capitalize">
                    {columnTitles[colStatus]}
                  </span>
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-muted text-muted-foreground">
                    {colItems.length}
                  </span>
                </div>

                <div className="space-y-2.5">
                  {colItems.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setSelectedAction(item)}
                      aria-label={`Open recommendation: ${item.title}`}
                      className={`${styles.itemCard} w-full text-left p-3.5 rounded-xl border border-border bg-card shadow-xs hover:border-primary/40 hover:shadow-sm cursor-pointer transition-all space-y-2`}
                    >
                      {/* Priority Score & Category */}
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
                            {item.category.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-black text-foreground">
                            {item.priorityScore}
                          </span>
                          <span className="text-[9px] uppercase font-bold text-muted-foreground bg-muted px-1 py-0.2 rounded">
                            Modeled
                          </span>
                        </div>
                      </div>

                      {/* Title */}
                      <h4 className="text-xs font-semibold text-foreground line-clamp-2 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-[11px] text-muted-foreground truncate">
                        Affected page: {item.evidence.find((evidence) => evidence.url)?.url || "Not available"}
                      </p>

                      {/* Badges / Meta */}
                      <div className="flex items-center gap-1.5 flex-wrap pt-1 text-[10px]">
                        {renderEffortBadge(item.effort)}
                        <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                          {item.sourceModule}
                        </span>
                        {item.fixGuidance && (
                          <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600 border border-purple-500/20 font-bold">
                            Fix Ready
                          </span>
                        )}
                        {item.status === "done" && renderVerificationBadge(item.verificationStatus)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* TABLE LIST VIEW */
        <div className={styles.tableScroller}>
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/40 border-b border-border text-muted-foreground text-[11px] font-bold uppercase">
              <tr>
                <th className="p-3 w-8">
                  <input
                    type="checkbox"
                    checked={selectedIds.length === items.length && items.length > 0}
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? items.map((i) => i.id) : [])
                    }
                  />
                </th>
                <th className="p-3">Action Item</th>
                <th className="p-3">Category</th>
                <th className="p-3">Affected page</th>
                <th className="p-3 text-center">Priority</th>
                <th className="p-3 text-center">Effort</th>
                <th className="p-3">Status</th>
                <th className="p-3">Verification</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20 transition-colors">
                  <td className="p-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(item.id)}
                      onChange={(e) =>
                        setSelectedIds((prev) =>
                          e.target.checked ? [...prev, item.id] : prev.filter((id) => id !== item.id),
                        )
                      }
                    />
                  </td>
                  <td className="p-3">
                    <button type="button" onClick={() => setSelectedAction(item)} className="text-left">
                      <span className="font-semibold text-foreground line-clamp-1">{item.title}</span>
                      <span className="text-[10px] text-muted-foreground line-clamp-1">{item.description}</span>
                    </button>
                  </td>
                  <td className="p-3 uppercase text-[10px] font-bold text-muted-foreground">
                    {item.category.replace(/_/g, " ")}
                  </td>
                  <td className="p-3 text-[10px] text-muted-foreground">
                    <span className="block max-w-48 truncate">
                      {item.evidence.find((evidence) => evidence.url)?.url || "Not available"}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className="font-bold text-foreground">{item.priorityScore}</span>
                    <span className="text-[9px] text-muted-foreground block">Modeled</span>
                  </td>
                  <td className="p-3 text-center">{renderEffortBadge(item.effort)}</td>
                  <td className="p-3">
                    <select
                      aria-label={`Status for ${item.title}`}
                      value={item.status}
                      onChange={(e) => handleStatusChange(item.id, e.target.value as ActionStatus)}
                      disabled={updatingActionId === item.id}
                      aria-busy={updatingActionId === item.id}
                      className="px-2 py-1 rounded-lg border border-border bg-background text-xs text-foreground capitalize"
                    >
                      <option value="backlog">Backlog</option>
                      <option value="todo">To Do</option>
                      <option value="in_progress">In Progress</option>
                      <option value="done">Completed</option>
                      <option value="dismissed">Dismissed</option>
                    </select>
                  </td>
                  <td className="p-3">{renderVerificationBadge(item.verificationStatus)}</td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => setSelectedAction(item)}
                      className="px-2 py-1 rounded-lg border border-border hover:bg-muted text-[11px] font-semibold text-foreground transition-colors"
                    >
                      Details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* DETAIL MODAL / DRAWER */}
      {selectedAction && (
        <div className={styles.modalBackdrop}>
          <div className={`${styles.modalPanel} space-y-6`} role="dialog" aria-modal="true" aria-labelledby="action-detail-title" tabIndex={-1}>
            {/* Modal Header */}
            <div className="flex items-start justify-between border-b border-border pb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">
                    {selectedAction.category} · {selectedAction.sourceModule}
                  </span>
                  <span className="text-xs font-black text-foreground bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    Priority: {selectedAction.priorityScore} (Modeled)
                  </span>
                </div>
                <h2 id="action-detail-title" className="text-base font-bold text-foreground">{selectedAction.title}</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedAction(null);
                  setComments([]);
                }}
                className="text-xs font-semibold text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <section className="p-3.5 rounded-xl border border-border bg-muted/20">
                <h3 className="text-xs font-bold text-foreground">Issue</h3>
                <p className="text-xs text-muted-foreground">{selectedAction.title || "Not available"}</p>
              </section>
              <section className="p-3.5 rounded-xl border border-border bg-muted/20">
                <h3 className="text-xs font-bold text-foreground">Why it matters</h3>
                <p className="text-xs text-muted-foreground">{selectedAction.description || "Not available"}</p>
              </section>
              <section className="p-3.5 rounded-xl border border-border bg-muted/20 sm:col-span-2">
                <h3 className="text-xs font-bold text-foreground">Affected page</h3>
                <p className="text-xs text-muted-foreground break-all">
                  {Array.from(new Set(selectedAction.evidence.map((evidence) => evidence.url).filter((url): url is string => Boolean(url)))).join(", ") || "Not available"}
                </p>
              </section>
            </div>

            {/* Status & Priority Breakdown Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl border border-border bg-card space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Status</span>
                <select
                  aria-label="Recommendation status"
                  value={selectedAction.status}
                  onChange={(e) => handleStatusChange(selectedAction.id, e.target.value as ActionStatus)}
                  disabled={updatingActionId === selectedAction.id}
                  aria-busy={updatingActionId === selectedAction.id}
                  className="w-full px-2 py-1 rounded-lg border border-border bg-background text-xs capitalize text-foreground"
                >
                  <option value="backlog">Backlog</option>
                  <option value="todo">To Do</option>
                  <option value="in_progress">In Progress</option>
                  <option value="done">Completed</option>
                  <option value="dismissed">Dismissed</option>
                </select>
              </div>

              <div className="p-3 rounded-xl border border-border bg-card space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Impact</span>
                <div className="text-sm font-bold text-foreground">{selectedAction.impact} / 10</div>
              </div>

              <div className="p-3 rounded-xl border border-border bg-card space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Confidence</span>
                <div className="text-sm font-bold text-foreground">
                  {(selectedAction.confidence * 100).toFixed(0)}%
                </div>
              </div>

              <div className="p-3 rounded-xl border border-border bg-card space-y-1">
                <span className="text-[10px] uppercase font-bold text-muted-foreground">Effort</span>
                <div>{renderEffortBadge(selectedAction.effort)}</div>
              </div>
            </div>

            <section className="p-4 rounded-xl border border-primary/20 bg-primary/5 space-y-3">
              <h3 className="text-xs font-bold text-foreground">Recommended fix</h3>
              {selectedAction.fixGuidance ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Code className="w-4 h-4 text-primary" />
                    <strong className="text-xs font-bold text-foreground">
                      {selectedAction.fixGuidance.title}
                    </strong>
                    <span className="text-[9px] uppercase font-bold px-1.5 py-0.2 rounded bg-primary/10 text-primary">
                      {selectedAction.fixGuidance.label}
                    </span>
                  </div>
                  {selectedAction.fixGuidance.code && (
                    <button
                      type="button"
                      onClick={() => handleCopyCode(selectedAction.fixGuidance!.code!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border bg-card hover:bg-muted text-[11px] font-semibold text-foreground transition-colors"
                    >
                      {copiedCode ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedCode ? "Copied" : "Copy Snippet"}</span>
                    </button>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">{selectedAction.fixGuidance.instructions}</p>

                {selectedAction.fixGuidance.code && (
                  <pre className="p-3 rounded-xl bg-muted/80 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre">
                    {selectedAction.fixGuidance.code}
                  </pre>
                )}

                <p className="text-[10px] text-muted-foreground italic">
                  {selectedAction.fixGuidance.disclaimer}
                </p>
              </div>
              ) : (
                <p className="text-xs text-muted-foreground">Not available for this recommendation.</p>
              )}
            </section>

            {/* Closed-Loop Verification Panel */}
            <div className="p-4 rounded-xl border border-border bg-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-primary" />
                  <strong className="text-xs font-bold text-foreground">
                    Closed-Loop Verification Loop (ACT-FR-008)
                  </strong>
                </div>
                <button
                  type="button"
                  disabled={verifying}
                  onClick={() => handleVerify(selectedAction.id)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg border border-border hover:bg-muted text-xs font-semibold text-foreground transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
                  <span>Verify Now</span>
                </button>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground">Status:</span>
                {renderVerificationBadge(selectedAction.verificationStatus)}
                {selectedAction.verifiedAt && (
                  <span className="text-[10px] text-muted-foreground">
                    Verified at: {new Date(selectedAction.verifiedAt).toLocaleTimeString()}
                  </span>
                )}
              </div>

              {selectedAction.verificationNotes && (
                <p className="text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-lg font-mono">
                  {selectedAction.verificationNotes}
                </p>
              )}
            </div>

            {/* Evidence List */}
            {selectedAction.evidence && selectedAction.evidence.length > 0 && (
              <div className="space-y-2">
                <strong className="text-xs font-bold text-foreground">Evidence & Audit Trace:</strong>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  {selectedAction.evidence.map((ev, idx) => (
                    <li key={idx} className="p-2 rounded-lg border border-border bg-muted/10 font-mono text-[11px]">
                      {ev.url && <div className="text-primary truncate">{ev.url}</div>}
                      {ev.quote && <div className="italic">&ldquo;{ev.quote}&rdquo;</div>}
                      {ev.source && <div className="text-[10px] text-muted-foreground">Source: {ev.source}</div>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Team Comments Timeline */}
            <div className="space-y-3 pt-2 border-t border-border">
              <strong className="text-xs font-bold text-foreground">Comments & Activity</strong>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {loadingComments ? (
                  <p role="status" className="text-xs text-muted-foreground">Loading comments…</p>
                ) : commentsError ? (
                  <p role="alert" className="text-xs text-rose-600">{commentsError}</p>
                ) : comments.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No comments yet. Start the discussion below.</p>
                ) : (
                  comments.map((c) => (
                    <div key={c.id} className="p-2.5 rounded-xl border border-border bg-muted/20 space-y-1">
                      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="font-bold text-foreground flex items-center gap-1">
                          <User className="w-3 h-3" />
                          <span>{c.userName}</span>
                        </span>
                        <span>{new Date(c.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs text-foreground">{c.body}</p>
                    </div>
                  ))
                )}
              </div>

              <form onSubmit={handleAddComment} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Add a team comment or note..."
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  className="flex-1 px-3 py-1.5 rounded-xl border border-border bg-background text-xs text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
                />
                <button
                  type="submit"
                  disabled={submittingComment || !newComment.trim()}
                  className="px-3 py-1.5 rounded-xl bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-50 shadow-xs flex items-center gap-1"
                >
                  <Send className="w-3 h-3" />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* CREATE MANUAL ACTION MODAL */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <Plus className="w-4 h-4 text-primary" />
                <span>Create Custom Action Item</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            <form onSubmit={handleCreateAction} className="space-y-3 text-xs">
              <div>
                <label className="block text-muted-foreground font-semibold mb-1">Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Implement Product Schema on Pricing Page"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-border bg-background text-foreground"
                />
              </div>

              <div>
                <label className="block text-muted-foreground font-semibold mb-1">Description</label>
                <textarea
                  required
                  rows={3}
                  placeholder="Context and details of the required optimization..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-xl border border-border bg-background text-foreground"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Category</label>
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value as ActionCategory)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-border bg-background text-foreground"
                  >
                    <option value="technical">Technical</option>
                    <option value="content">Content</option>
                    <option value="citation">Citation</option>
                    <option value="agent_readiness">Agent Readiness</option>
                    <option value="accuracy">Accuracy</option>
                    <option value="competitor">Competitor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Effort</label>
                  <select
                    value={newEffort}
                    onChange={(e) => setNewEffort(e.target.value as ActionEffort)}
                    className="w-full px-2.5 py-1.5 rounded-xl border border-border bg-background text-foreground"
                  >
                    <option value="S">Small (S)</option>
                    <option value="M">Medium (M)</option>
                    <option value="L">Large (L)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">
                    Impact (1–10): {newImpact}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={newImpact}
                    onChange={(e) => setNewImpact(Number(e.target.value))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">
                    Confidence: {(newConfidence * 100).toFixed(0)}%
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={1.0}
                    step={0.05}
                    value={newConfidence}
                    onChange={(e) => setNewConfidence(Number(e.target.value))}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Assignee / Owner</label>
                  <input
                    type="text"
                    placeholder="e.g. dev@example.com"
                    value={newOwner}
                    onChange={(e) => setNewOwner(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-border bg-background text-foreground"
                  />
                </div>

                <div>
                  <label className="block text-muted-foreground font-semibold mb-1">Due Date</label>
                  <input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-xl border border-border bg-background text-foreground"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-xl border border-border hover:bg-muted text-foreground"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingAction}
                  className="px-4 py-1.5 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 shadow-xs flex items-center gap-1.5"
                >
                  {creatingAction && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create Action Item</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
