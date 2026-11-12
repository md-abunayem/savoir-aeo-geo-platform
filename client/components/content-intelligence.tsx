"use client";
import Link from "next/link";

import { useEffect, useState } from "react";
import {
  FileText,
  Sparkles,
  AlertCircle,
  Clock,
  ArrowRight,
  Download,
  Search,
  RefreshCw,
  Plus,
  Compass,
  CheckCircle2,
  ChevronRight,
  HelpCircle,
  Copy,
  Check,
  Scale,
  Split,
  FileCheck,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import styles from "./workspace-sections.module.css";
import type {
  Project,
  ContentItemRecord,
  ContentGapRecord,
  ContentBriefRecord,
  CompetitorPageComparison,
} from "../lib/types";

interface ContentIntelligenceProps {
  tenantId: string;
  project: Project;
}

export function ContentIntelligence({ tenantId, project }: ContentIntelligenceProps) {
  const [activeTab, setActiveTab] = useState<"inventory" | "gaps" | "briefs">("inventory");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Inventory state
  const [inventory, setInventory] = useState<ContentItemRecord[]>([]);
  const [inventoryTotal, setInventoryTotal] = useState(0);
  const [isStaleFilter, setIsStaleFilter] = useState<boolean | undefined>(undefined);
  const [searchQuery, setSearchQuery] = useState("");
  const [inventorySort, setInventorySort] = useState<"score" | "title" | "updated">("score");
  const [syncing, setSyncing] = useState(false);

  // Gaps state
  const [gaps, setGaps] = useState<ContentGapRecord[]>([]);
  const [gapStatusFilter, setGapStatusFilter] = useState<string | undefined>("open");
  const [identifyingGaps, setIdentifyingGaps] = useState(false);

  // Briefs state
  const [briefs, setBriefs] = useState<ContentBriefRecord[]>([]);
  const [selectedBrief, setSelectedBrief] = useState<ContentBriefRecord | null>(null);
  const [creatingBrief, setCreatingBrief] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Modal: New Brief Form
  const [showNewBriefModal, setShowNewBriefModal] = useState(false);
  const [newBriefPrompts, setNewBriefPrompts] = useState("");
  const [newBriefTitle, setNewBriefTitle] = useState("");
  const [newBriefIntent, setNewBriefIntent] = useState<"informational" | "commercial" | "comparison" | "troubleshooting">("informational");
  const [newBriefGapId, setNewBriefGapId] = useState<string | null>(null);

  // Modal: Competitor Page Comparison
  const [comparisonModal, setComparisonModal] = useState<CompetitorPageComparison | null>(null);
  const [showComparisonForm, setShowComparisonForm] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [compareOwnedUrl, setCompareOwnedUrl] = useState("");
  const [compareCompetitorUrl, setCompareCompetitorUrl] = useState("");

  const basePath = `/v1/tenants/${tenantId}/projects/${project.id}/content`;

  // Fetch Inventory
  const fetchInventory = async () => {
    try {
      const params = new URLSearchParams();
      if (isStaleFilter !== undefined) params.set("isStale", String(isStaleFilter));
      if (searchQuery.trim()) params.set("search", searchQuery.trim());
      params.set("limit", "50");

      const res = await api.request<{ items: ContentItemRecord[]; total: number }>(
        `${basePath}/inventory?${params.toString()}`
      );
      if (res) {
        setInventory(res.items || []);
        setInventoryTotal(res.total || 0);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load content inventory");
    }
  };

  // Fetch Gaps
  const fetchGaps = async () => {
    try {
      const params = new URLSearchParams();
      if (gapStatusFilter) params.set("status", gapStatusFilter);

      const res = await api.request<ContentGapRecord[]>(`${basePath}/gaps?${params.toString()}`);
      if (res) {
        setGaps(res);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load content gaps");
    }
  };

  // Fetch Briefs
  const fetchBriefs = async () => {
    try {
      const res = await api.request<ContentBriefRecord[]>(`${basePath}/briefs`);
      if (res) {
        setBriefs(res);
        if (res.length > 0 && !selectedBrief) {
          setSelectedBrief(res[0]!);
        }
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load content briefs");
    }
  };

  // Initial Load
  useEffect(() => {
    let ignore = false;
    const loadAll = async () => {
      setLoading(true);
      setError(null);
      await Promise.all([fetchInventory(), fetchGaps(), fetchBriefs()]);
      if (!ignore) setLoading(false);
    };

    loadAll();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePath]);

  // Sync Inventory from Crawl Data
  const handleSyncInventory = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await api.request<{
        syncedPagesCount: number;
        stalePagesCount: number;
      }>(`${basePath}/inventory/sync`, { method: "POST" });
      if (res) {
        setSuccessMessage(`Synchronized ${res.syncedPagesCount} pages from crawl data (${res.stalePagesCount} stale).`);
        setTimeout(() => setSuccessMessage(null), 3000);
        await fetchInventory();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to sync inventory from crawl");
    } finally {
      setSyncing(false);
    }
  };

  // Identify Gaps
  const handleIdentifyGaps = async () => {
    setIdentifyingGaps(true);
    setError(null);
    try {
      const res = await api.request<{ newGapsCount: number; totalGaps: number }>(
        `${basePath}/gaps/identify`,
        { method: "POST" }
      );
      if (res) {
        setSuccessMessage(`Identified ${res.newGapsCount} content gaps (${res.totalGaps} total).`);
        setTimeout(() => setSuccessMessage(null), 3000);
        await fetchGaps();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to identify content gaps");
    } finally {
      setIdentifyingGaps(false);
    }
  };

  // Trigger Brief from Gap
  const handleCreateBriefFromGap = (gap: ContentGapRecord) => {
    setNewBriefGapId(gap.id);
    setNewBriefPrompts(gap.promptText);
    setNewBriefTitle(`Definitive Guide to ${gap.clusterName}`);
    setShowNewBriefModal(true);
  };

  // Submit New Brief
  const handleSubmitBrief = async () => {
    if (!newBriefPrompts.trim()) {
      setError("Please enter at least one target prompt");
      return;
    }

    setCreatingBrief(true);
    setError(null);
    try {
      const prompts = newBriefPrompts.split(/\r?\n/).map((p) => p.trim()).filter(Boolean);
      const res = await api.request<ContentBriefRecord>(`${basePath}/briefs`, {
        method: "POST",
        body: {
          gapId: newBriefGapId || undefined,
          targetPrompts: prompts,
          primaryIntent: newBriefIntent,
          title: newBriefTitle.trim() || undefined,
        },
      });

      if (res) {
        setBriefs((prev) => [res, ...prev]);
        setSelectedBrief(res);
        setShowNewBriefModal(false);
        setActiveTab("briefs");
        setSuccessMessage("Content brief generated successfully!");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create content brief");
    } finally {
      setCreatingBrief(false);
    }
  };

  // Compare Owned Page vs Competitor
  const handleRunComparison = async () => {
    if (!compareOwnedUrl.trim() || !compareCompetitorUrl.trim()) return;
    setComparing(true);
    setError(null);
    try {
      const res = await api.request<CompetitorPageComparison>(`${basePath}/compare`, {
        method: "POST",
        body: {
          ownedUrl: compareOwnedUrl.trim(),
          competitorUrl: compareCompetitorUrl.trim(),
        },
      });
      if (res) {
        setComparisonModal(res);
        setShowComparisonForm(false);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to compare pages");
    } finally {
      setComparing(false);
    }
  };

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      // Ignore
    }
  };

  const sortedInventory = [...inventory].sort((a, b) => {
    if (inventorySort === "title") {
      return (a.title || a.path).localeCompare(b.title || b.path);
    }
    if (inventorySort === "updated") {
      return (b.lastModified || "").localeCompare(a.lastModified || "");
    }
    return b.contentScore - a.contentScore;
  });

  if (loading) {
    return (
      <div className={`${styles.page} ${styles.loadingState}`} aria-live="polite">
        <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto" />
        <p className="text-xs text-muted-foreground">Loading Content Intelligence models and briefs...</p>
      </div>
    );
  }

  return (
    <div className={`${styles.page} space-y-8 max-w-6xl mx-auto pb-16`}>
      {/* Top Header */}
      <header className={`${styles.header} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Content intelligence</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>Content Intelligence</span>
          </h1>
          <p className={`${styles.description} text-xs text-muted-foreground mt-1`}>
            Review crawled pages and modeled content checks, explore identified prompt gaps, and prepare briefs for {project.domain}.
          </p>
        </div>

        <div className={`${styles.headerActions} flex items-center gap-2.5`}>
          <Link href="/content/studio" className={styles.primaryButton}>Open content studio →</Link>
          <button
            type="button"
            onClick={() => {
              setNewBriefGapId(null);
              setNewBriefPrompts("");
              setNewBriefTitle("");
              setShowNewBriefModal(true);
            }}
            className={`${styles.primaryButton} inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all`}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Content Brief</span>
          </button>
        </div>
      </header>

      {/* Notifications */}
      {error && (
        <div role="alert" className="p-3 text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div role="status" className="p-3 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      <section className={styles.summaryGrid} aria-label="Content intelligence summary">
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Inventory pages</span>
          <strong className={styles.summaryValue}>{error ? "Not available" : inventoryTotal}</strong>
          <span className={styles.summaryNote}>Pages returned by the content inventory</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Gaps in current filter</span>
          <strong className={styles.summaryValue}>{error ? "Not available" : gaps.length}</strong>
          <span className={styles.summaryNote}>Current gap filter: {gapStatusFilter || "all statuses"}</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Saved briefs</span>
          <strong className={styles.summaryValue}>{error ? "Not available" : briefs.length}</strong>
          <span className={styles.summaryNote}>Briefs available for this project</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Project</span>
          <strong className={styles.summaryValue}>{project.domain || "Not available"}</strong>
          <span className={styles.summaryNote}>Selected project content</span>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className={`${styles.tabs} flex items-center gap-1 border-b border-border`} role="tablist" aria-label="Content Intelligence sections">
        <button
          type="button"
          id="content-inventory-tab"
          role="tab"
          aria-selected={activeTab === "inventory"}
          aria-controls="content-inventory-panel"
          onClick={() => setActiveTab("inventory")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "inventory"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Content Inventory & Clusters</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-muted text-muted-foreground">
            {inventoryTotal}
          </span>
        </button>

        <button
          type="button"
          id="content-gaps-tab"
          role="tab"
          aria-selected={activeTab === "gaps"}
          aria-controls="content-gaps-panel"
          onClick={() => setActiveTab("gaps")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "gaps"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Compass className="w-4 h-4" />
          <span>Content Gap Identification</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-500/10 text-amber-600">
            {gaps.length}
          </span>
        </button>

        <button
          type="button"
          id="content-briefs-tab"
          role="tab"
          aria-selected={activeTab === "briefs"}
          aria-controls="content-briefs-panel"
          onClick={() => setActiveTab("briefs")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "briefs"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Content Briefs Studio</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-primary/10 text-primary">
            {briefs.length}
          </span>
        </button>
      </div>

      {/* TAB 1: CONTENT INVENTORY & CLUSTERS */}
      {activeTab === "inventory" && (
        <div id="content-inventory-panel" role="tabpanel" aria-labelledby="content-inventory-tab" className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Inventory values come from crawled pages and modeled checks. Gap recommendations and briefs are shown separately.
          </p>
          {/* Controls Bar */}
          <div className={`${styles.filterBar} ${styles.contentFilterBar}`}>
            <div className={styles.contentSearchGroup}>
              <div className={styles.contentSearchField}>
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-muted-foreground" />
                <input
                  type="text"
                  aria-label="Search content pages"
                  placeholder="Search pages by path or title..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && fetchInventory()}
                  className={`${styles.contentSearchInput} text-xs pl-8 pr-3 py-2 rounded-xl border border-border bg-card text-foreground w-full focus:outline-none focus:ring-1 focus:ring-primary`}
                />
              </div>
              <button
                type="button"
                onClick={fetchInventory}
                className={`${styles.contentSearchButton} px-3 py-2 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition-colors`}
              >
                Search
              </button>
            </div>

            <div className={styles.contentFilterActions}>
              <label className="sr-only" htmlFor="inventory-sort">Sort inventory</label>
              <select
                id="inventory-sort"
                aria-label="Sort inventory"
                value={inventorySort}
                onChange={(e) => setInventorySort(e.target.value as typeof inventorySort)}
                className={styles.contentSortSelect}
              >
                <option value="score">Sort by content score</option>
                <option value="title">Sort by title</option>
                <option value="updated">Sort by last modified</option>
              </select>
              <button
                type="button"
                onClick={() => {
                  setIsStaleFilter(isStaleFilter === true ? undefined : true);
                  setTimeout(fetchInventory, 50);
                }}
                className={`${styles.contentStaleButton} px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                  isStaleFilter === true
                    ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
                    : "border-border bg-card text-muted-foreground hover:text-foreground"
                }`}
              >
                Stale Pages Only
              </button>

              <button
                type="button"
                onClick={handleSyncInventory}
                disabled={syncing}
                aria-busy={syncing}
                className={`${styles.contentSyncButton} inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all disabled:opacity-50`}
              >
                {syncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>{syncing ? "Syncing…" : "Sync from Crawl"}</span>
              </button>
            </div>
          </div>

          {/* Inventory Table / Cards */}
          <div className="space-y-3">
            {inventory.length === 0 ? (
              <div className={`${styles.contentEmptyState} p-12 text-center border border-dashed border-border rounded-2xl bg-card space-y-3`}>
                <FileText className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">
                  No content inventory records found. Click &quot;Sync from Crawl&quot; to index your site pages.
                </p>
              </div>
            ) : (
              sortedInventory.map((item) => (
                <div
                  key={item.id}
                  className={`${styles.itemCard} p-4 rounded-2xl border border-border bg-card hover:border-primary/40 transition-all space-y-3`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="font-bold text-sm text-foreground">{item.title || item.path}</h2>
                        {item.isStale && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-600 border border-amber-500/20">
                            <Clock className="w-3 h-3" />
                            <span>Stale (&gt;90d)</span>
                          </span>
                        )}
                        {item.cannibalizedPromptIds.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-600 border border-purple-500/20">
                            <Split className="w-3 h-3" />
                            <span>Cannibalization Risk</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground truncate max-w-2xl font-mono">{item.url}</div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <div className="flex items-baseline gap-1">
                          <span className="text-xl font-black text-foreground">{item.contentScore ?? "Not available"}</span>
                          <span className="text-[10px] text-muted-foreground">/ 100</span>
                        </div>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground bg-muted px-1.5 py-0.2 rounded">
                          Modeled
                        </span>
                      </div>

                      <button
                        type="button"
                        disabled={comparing}
                        onClick={() => {
                          setCompareOwnedUrl(item.url);
                          setCompareCompetitorUrl("");
                          setShowComparisonForm(true);
                        }}
                        aria-label={`Compare ${item.title || item.path} with a competitor page`}
                        className="p-2 rounded-xl border border-border hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                      >
                        {comparing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Metric Sub-pills */}
                  <div className={styles.metricGrid} aria-label="Page metrics">
                    <span>Words <strong>{item.wordCount ?? "Not available"}</strong></span>
                    <span>Answer-first <strong>{item.answerFirstScore ?? "Not available"}/25</strong></span>
                    <span>Entity clarity <strong>{item.entityClarityScore ?? "Not available"}/20</strong></span>
                    <span>Schema <strong>{item.schemaScore ?? "Not available"}/10</strong></span>
                    <span>Structure <strong>{item.structureScore ?? "Not available"}/10</strong></span>
                  </div>

                  {/* Clusters */}
                  {item.promptClusters.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/50 text-[11px]">
                      <span className="text-muted-foreground text-[10px] font-semibold uppercase">Clusters:</span>
                      {item.promptClusters.map((cluster, cIdx) => (
                        <span key={cIdx} className="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-[10px]">
                          {cluster}
                        </span>
                      ))}
                    </div>
                  )}
                  <details className={styles.disclosure}>
                    <summary>Page evidence and opportunities</summary>
                    <div className="grid gap-3 text-xs sm:grid-cols-2">
                      <div>
                        <strong>Meta description</strong>
                        <p className="text-muted-foreground">{item.metaDescription || "Not available"}</p>
                      </div>
                      <div>
                        <strong>Last modified</strong>
                        <p className="text-muted-foreground">
                          {item.lastModified ? new Date(item.lastModified).toLocaleDateString() : "Not available"}
                        </p>
                      </div>
                      <div>
                        <strong>Identified opportunities</strong>
                        <p className="text-muted-foreground">
                          {item.isStale || item.cannibalizedPromptIds.length > 0
                            ? [
                                item.isStale ? "Review this stale page for an update." : "",
                                item.cannibalizedPromptIds.length > 0 ? "Review overlapping prompt coverage." : "",
                              ].filter(Boolean).join(" ")
                            : "Not available"}
                        </p>
                      </div>
                      <div>
                        <strong>Mapped prompts</strong>
                        <p className="text-muted-foreground">{item.mappedPromptIds?.length ?? "Not available"}</p>
                      </div>
                    </div>
                  </details>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 2: CONTENT GAP IDENTIFICATION */}
      {activeTab === "gaps" && (
        <div id="content-gaps-panel" role="tabpanel" aria-labelledby="content-gaps-tab" className="space-y-6">
          <p className="text-xs text-muted-foreground">
            Demand and priority are modeled indicators; suggested actions are guidance to review, not changes made to your site.
          </p>
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {(["open", "in_brief", "resolved", "dismissed"] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setGapStatusFilter(st);
                    setTimeout(fetchGaps, 50);
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition-colors ${
                    gapStatusFilter === st
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {st.replace("_", " ")}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={handleIdentifyGaps}
              disabled={identifyingGaps}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
            >
              {identifyingGaps ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Compass className="w-3.5 h-3.5" />}
              <span>Identify New Gaps</span>
            </button>
          </div>

          {/* Gaps Cards */}
          <div className="space-y-4">
            {gaps.length === 0 ? (
              <div className="p-12 text-center border border-dashed border-border rounded-2xl bg-card space-y-3">
                <Compass className="w-8 h-8 text-muted-foreground mx-auto" />
                <p className="text-xs text-muted-foreground">
                  No content gaps found for this filter. Run &quot;Identify New Gaps&quot; to cross-reference monitoring prompts.
                </p>
              </div>
            ) : (
              gaps.map((gap) => (
                <div
                  key={gap.id}
                  className="p-5 rounded-2xl border border-border bg-card space-y-4 hover:border-primary/40 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600">
                          {gap.clusterName}
                        </span>
                        <span className="text-xs font-semibold text-rose-500">
                          Brand Vis: {(gap.brandVisScore * 100).toFixed(0)}%
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-foreground leading-snug">{gap.promptText}</h3>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-right">
                        <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
                          Priority {gap.priorityScore}
                        </span>
                        <div className="text-[10px] text-muted-foreground">Demand: {gap.demandIndex}</div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCreateBriefFromGap(gap)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all"
                      >
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>Generate Brief</span>
                      </button>
                    </div>
                  </div>

                  {/* Context and Suggested Action */}
                  <div className="p-3 rounded-xl bg-muted/40 border border-border text-xs space-y-2">
                    <div className="flex items-start gap-2">
                      <ArrowRight className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                      <span className="text-foreground leading-relaxed">
                        <strong>Action:</strong> {gap.suggestedAction}
                      </span>
                    </div>

                    {gap.topCitedCompetitorDomains.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/60 text-[11px]">
                        <span className="text-muted-foreground">Cited Competitors:</span>
                        {gap.topCitedCompetitorDomains.map((dom, dIdx) => (
                          <span key={dIdx} className="px-2 py-0.5 rounded-md bg-background border border-border font-mono text-[10px]">
                            {dom}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CONTENT BRIEFS STUDIO */}
      {activeTab === "briefs" && (
        <div id="content-briefs-panel" role="tabpanel" aria-labelledby="content-briefs-tab" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left Column: Briefs List */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Saved Briefs ({briefs.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setNewBriefGapId(null);
                    setNewBriefPrompts("");
                    setNewBriefTitle("");
                    setShowNewBriefModal(true);
                  }}
                  className="inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New</span>
                </button>
              </div>

              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {briefs.length === 0 ? (
                  <div className="p-8 text-center border border-dashed border-border rounded-xl bg-card text-xs text-muted-foreground">
                    No briefs yet. Click &quot;New Content Brief&quot; to synthesize one.
                  </div>
                ) : (
                  briefs.map((b) => {
                    const isSelected = selectedBrief?.id === b.id;
                    return (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setSelectedBrief(b)}
                        className={`w-full text-left p-3.5 rounded-xl border transition-all space-y-1.5 ${
                          isSelected
                            ? "border-primary bg-primary/5 ring-1 ring-primary shadow-sm"
                            : "border-border bg-card hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground truncate max-w-[200px]">
                            {b.title}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.2 rounded font-bold uppercase bg-muted text-muted-foreground">
                            {b.primaryIntent}
                          </span>
                        </div>
                        <div className="text-[11px] text-muted-foreground line-clamp-1">
                          {b.targetPrompts[0] || "Target Prompt"}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Brief Viewer & Export */}
            <div className="lg:col-span-2 space-y-4">
              {selectedBrief ? (
                <div className="p-6 rounded-2xl border border-border bg-card space-y-6">
                  {/* Brief Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary uppercase">
                          {selectedBrief.primaryIntent}
                        </span>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 uppercase">
                          {selectedBrief.label}
                        </span>
                      </div>
                      <h2 className="text-xl font-bold text-foreground">{selectedBrief.title}</h2>
                    </div>

                    <div className="flex items-center gap-2">
                      <a
                        href={`${basePath}/briefs/${selectedBrief.id}/export?format=markdown`}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-background hover:bg-muted text-xs font-semibold text-foreground transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Markdown</span>
                      </a>

                      <a
                        href={`${basePath}/briefs/${selectedBrief.id}/export?format=docx`}
                        download
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Word (.docx)</span>
                      </a>
                    </div>
                  </div>

                  {/* CNT-FR-009 Mandatory Notice */}
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <p className="leading-relaxed">
                      <strong>Notice (CNT-FR-009):</strong> This content brief is AI-synthesized modeled guidance.
                      Review and adapt before publishing; Savoir does not auto-publish or write to your site.
                    </p>
                  </div>

                  {/* Questions to Answer (CNT-FR-008) */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <HelpCircle className="w-4 h-4 text-primary" />
                      <span>Questions to Answer (FAQ &amp; PAA Blocks)</span>
                    </span>
                    <ul className="space-y-1.5 text-xs text-foreground">
                      {selectedBrief.questionsToAnswer.map((q, idx) => (
                        <li key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30">
                          <span className="font-bold text-primary">{idx + 1}.</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Recommended Outline */}
                  <div className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileCheck className="w-4 h-4 text-primary" />
                      <span>Recommended Outline (Answer-First Pattern)</span>
                    </span>
                    <div className="space-y-2">
                      {selectedBrief.suggestedOutline.map((item, idx) => (
                        <div key={idx} className="p-3 rounded-xl border border-border bg-muted/20 text-xs space-y-1">
                          <div className="font-bold text-foreground">
                            H{item.level}: {item.heading}
                          </div>
                          <div className="text-[11px] text-muted-foreground">{item.guidance}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Entities & Proof Points Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase">Target Entities:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {selectedBrief.targetEntities.map((ent, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-background border border-border text-[10px] font-mono">
                            {ent}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2">
                      <span className="text-[11px] font-bold text-muted-foreground uppercase">Recommended Schemas:</span>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {selectedBrief.recommendedSchemas.map((sch, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-600 text-[10px] font-semibold">
                            {sch}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Raw Markdown Viewer */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        Markdown Source
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy("brief_md", selectedBrief.markdownContent)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                      >
                        {copiedKey === "brief_md" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedKey === "brief_md" ? "Copied" : "Copy Markdown"}</span>
                      </button>
                    </div>

                    <pre className="font-mono text-xs p-4 rounded-xl border border-border bg-muted/40 text-foreground overflow-x-auto whitespace-pre-wrap max-h-80 leading-relaxed">
                      {selectedBrief.markdownContent}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="p-16 text-center border border-dashed border-border rounded-2xl bg-card space-y-3">
                  <Sparkles className="w-8 h-8 text-muted-foreground mx-auto" />
                  <p className="text-xs text-muted-foreground">Select a brief on the left or create a new one.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL: NEW CONTENT BRIEF */}
      {showNewBriefModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-xl space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h3 className="text-sm font-bold text-foreground">Generate New Content Brief</h3>
              <button
                type="button"
                onClick={() => setShowNewBriefModal(false)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Brief Title (Optional):</label>
                <input
                  type="text"
                  placeholder="e.g. Definitive Guide to Distributed Tracing"
                  value={newBriefTitle}
                  onChange={(e) => setNewBriefTitle(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Target Search Prompts (1 per line):</label>
                <textarea
                  rows={4}
                  placeholder="e.g. How to implement distributed tracing in Kubernetes?"
                  value={newBriefPrompts}
                  onChange={(e) => setNewBriefPrompts(e.target.value)}
                  className="w-full text-xs p-3 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Primary Search Intent:</label>
                <select
                  value={newBriefIntent}
                  onChange={(e) => setNewBriefIntent(e.target.value as typeof newBriefIntent)}
                  className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="informational">Informational (Educational &amp; Guides)</option>
                  <option value="commercial">Commercial (Product &amp; Pricing Evaluation)</option>
                  <option value="comparison">Comparison (Head-to-Head &amp; Alternatives)</option>
                  <option value="troubleshooting">Troubleshooting (Errors &amp; Fixes)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewBriefModal(false)}
                className="px-4 py-2 rounded-xl border border-border text-xs font-semibold text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitBrief}
                disabled={creatingBrief}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {creatingBrief ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span>Generate Brief</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: COMPETITOR PAGE COMPARISON */}
      {showComparisonForm && (
        <div className={styles.modalBackdrop}>
          <form
            className={`${styles.modalPanel} space-y-5`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="comparison-form-title"
            onSubmit={(event) => {
              event.preventDefault();
              void handleRunComparison();
            }}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
              <div>
                <h2 id="comparison-form-title" className="text-base font-bold text-foreground">
                  Compare content pages
                </h2>
                <p className="text-xs text-muted-foreground">
                  Enter a competitor page URL to compare against the selected project page.
                </p>
              </div>
              <button type="button" className={styles.secondaryButton} onClick={() => setShowComparisonForm(false)}>
                Cancel
              </button>
            </div>
            <label>
              Your page
              <input aria-label="Your page URL" type="url" required value={compareOwnedUrl} onChange={(event) => setCompareOwnedUrl(event.target.value)} />
            </label>
            {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
            <label>
              Competitor page
              <input
                aria-label="Competitor page URL"
                type="url"
                required
                placeholder="https://competitor.example/page"
                value={compareCompetitorUrl}
                onChange={(event) => setCompareCompetitorUrl(event.target.value)}
              />
            </label>
            <button type="submit" className={styles.primaryButton} disabled={comparing}>
              {comparing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Scale className="w-3.5 h-3.5" />}
              {comparing ? "Comparing pages…" : "Run comparison"}
            </button>
          </form>
        </div>
      )}
      {comparisonModal && (
        <div className={styles.modalBackdrop}>
          <div className={`${styles.modalPanel} space-y-5`} role="dialog" aria-modal="true" aria-labelledby="comparison-result-title">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <h2 id="comparison-result-title" className="text-sm font-bold text-foreground flex items-center gap-2">
                <Scale className="w-4 h-4 text-primary" />
                <span>Owned vs Competitor Page Comparison</span>
              </h2>
              <button
                type="button"
                onClick={() => setComparisonModal(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Owned Page</span>
                <div className="text-xl font-bold text-foreground">{comparisonModal.ownedScore} / 100</div>
                <div className="text-xs text-muted-foreground truncate">{comparisonModal.ownedUrl}</div>
              </div>

              <div className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Competitor Page</span>
                <div className="text-xl font-bold text-foreground">{comparisonModal.competitorScore} / 100</div>
                <div className="text-xs text-muted-foreground truncate">{comparisonModal.competitorUrl}</div>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-primary/5 border border-primary/20 text-xs text-foreground space-y-1">
              <strong>Actionable Summary:</strong>
              <p className="text-muted-foreground leading-relaxed">{comparisonModal.actionableSummary}</p>
            </div>

            {comparisonModal.structuralDifferences.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <strong className="text-foreground">Structural Differences:</strong>
                <ul className="space-y-1 text-muted-foreground">
                  {comparisonModal.structuralDifferences.map((d, idx) => (
                    <li key={idx} className="flex items-center gap-1.5">
                      <ChevronRight className="w-3.5 h-3.5 text-primary shrink-0" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {comparisonModal.missingEntities.length > 0 && (
              <div className="space-y-1.5 text-xs">
                <strong className="text-foreground">Missing Topic Entities:</strong>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {comparisonModal.missingEntities.map((e, idx) => (
                    <span key={idx} className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 text-[10px] font-mono">
                      +{e}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
