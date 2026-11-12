"use client";
import Link from "next/link";
import { ProviderError } from "./provider-error";
import { engineStatusLabel, runGroundingLabel } from "../lib/provider-status";
import {
  selectedProject,
  selectProject,
  projectRequestKey,
  clearProjectRequest,
} from "../lib/project-selection";
import { OverviewDashboard } from "./overview-dashboard";
import { WorkspaceTools } from "./workspace-tools";
import { MonitoringControls } from "./monitoring-controls";
import { AnswerExplorer } from "./answer-explorer";
import { PromptLibrary } from "./prompt-library";
import { VisibilityDashboard } from "./visibility-dashboard";
import { CitationIntelligence } from "./citation-intelligence";
import { CompetitorIntelligence } from "./competitor-intelligence";
import { TechnicalAudit } from "./technical-audit";
import { AgentExperience } from "./agent-experience";
import { ContentIntelligence } from "./content-intelligence";
import { ActionCenter } from "./action-center";
import { TrafficAnalytics } from "./traffic-analytics";
import { ReportingDashboard } from "./reporting-dashboard";
import { BillingDashboard } from "./billing-dashboard";
import { OperatorDashboard } from "./operator-dashboard";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  BarChart3,
  BookOpen,
  Bot,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Coins,
  CreditCard,
  FileText,
  Globe2,
  LayoutDashboard,
  Link2,
  ListTodo,
  LoaderCircle,
  LogOut,
  Menu,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sliders,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import type {
  User,
  Project,
  Snapshot,
  Run,
  Prompt,
  Schedule,
  Health,
  Engine,
} from "../lib/types";
type View =
  | "overview"
  | "monitoring"
  | "prompts"
  | "answers"
  | "visibility"
  | "citations"
  | "competitors"
  | "technical"
  | "axo"
  | "content"
  | "actions"
  | "traffic"
  | "reporting"
  | "billing"
  | "operator";
const labels = {
  overview: "Overview",
  monitoring: "Monitoring",
  prompts: "Prompts",
  answers: "Answer Explorer",
  visibility: "Visibility Analytics",
  citations: "Citation Intelligence",
  competitors: "Competitor Intelligence",
  technical: "Technical AEO Audit",
  axo: "Agent Experience (AXO)",
  content: "Content Intelligence",
  actions: "Action Center",
  traffic: "AI Traffic & Integrations",
  reporting: "Executive Reports",
  billing: "Billing & Credits",
  operator: "Operator Console",
};
const viewsWithDedicatedHeading = new Set<View>([
  "prompts",
  "competitors",
  "technical",
  "axo",
  "content",
  "actions",
  "traffic",
  "reporting",
  "billing",
  "operator",
]);
const names: Record<string, string> = {
  openrouter: "OpenRouter / GPT-6 Luna",
  gemini: "Gemini",
  openai: "ChatGPT",
  google_ai_overviews: "AI Overviews",
  google_ai_mode: "AI Mode",
};
const path = (p: Project) =>
  `/v1/tenants/${p.tenantId}/projects/${p.id}/monitoring`;
const date = (value: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "No completed runs yet";
const message = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
function runStage(run: Run) {
  if (
    run.status === "queued" &&
    run.error_code === "PROVIDER_PREFLIGHT_UNAVAILABLE"
  )
    return "Waiting for provider check";
  if (
    run.status === "failed" &&
    run.error_code === "PROVIDER_QUOTA_REVIEW_REQUIRED"
  )
    return "Stopped · quota review";
  if (run.status === "queued") {
    return run.attempts && run.attempts > 0
      ? "Queued · automatic retry"
      : "Queued";
  }
  if (run.status === "processing") return "Calling provider";
  if (run.status === "succeeded" || run.status === "refused")
    return run.answer_processed ? "Completed" : "Processing answer";
  if (run.status === "failed") return "Failed";
  return "Uncertain";
}
export function Workspace({ view }: { view: View }) {
  const needsMonitoring = view === "monitoring" || view === "prompts";
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [selected, setSelected] = useState("");
  const [booted, setBooted] = useState(false),
    [error, setError] = useState(""),
    [nextCursor, setNextCursor] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<{
    projectId: string;
    value: Snapshot;
  } | null>(null);
  const [promptSnapshot, setPromptSnapshot] = useState<{
    projectId: string;
    prompts: Prompt[];
    engines: Engine[];
    hasMore: boolean;
  } | null>(null);
  const [reload, setReload] = useState(0),
    [refreshing, setRefreshing] = useState(false),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [sidebarCollapsed, setSidebarCollapsed] = useState(false),
    [addPromptOpen, setAddPromptOpen] = useState(false),
    [notice, setNotice] = useState("");
  const [run, setRun] = useState<Run | null>(null);
  const [promptError, setPromptError] = useState("");
  const [promptPages, setPromptPages] = useState({ projectId: "", count: 1 });
  const [showArchivedPrompts, setShowArchivedPrompts] = useState(false);
  const [promptPagination, setPromptPagination] = useState({
    projectId: "",
    hasMore: false,
  });
  const [monitoringPages, setMonitoringPages] = useState({
    projectId: "",
    runs: 1,
    schedules: 1,
  });
  const [monitoringPagination, setMonitoringPagination] = useState({
    projectId: "",
    runs: false,
    schedules: false,
  });
  const promptInFlight = useRef(false);
  const pendingPrompt = useRef<{
    projectId: string;
    fingerprint: string;
    key: string;
  } | null>(null);
  const project = projects.find((p) => p.id === selected);
  const promptPageCount =
    promptPages.projectId === selected ? promptPages.count : 1;
  const runPageCount =
    monitoringPages.projectId === selected ? monitoringPages.runs : 1;
  const schedulePageCount =
    monitoringPages.projectId === selected ? monitoringPages.schedules : 1;
  const data = snapshot?.projectId === selected ? snapshot.value : null;
  const promptData =
    promptSnapshot?.projectId === selected ? promptSnapshot : null;
  const projectHref = (href: string) =>
    project
      ? `${href}${href.includes("?") ? "&" : "?"}project=${encodeURIComponent(project.id)}`
      : href;
  useEffect(() => {
    if (user && selected) selectProject(user.id, selected);
  }, [user, selected]);
  useEffect(() => {
    let disposed = false;
    async function boot() {
      try {
        const account = await api.request<{ user: User }>("/v1/auth/me");
        const result = await api.request<{
          projects: Project[];
          nextCursor: string | null;
        }>("/v1/projects?limit=100");
        if (disposed) return;
        const preferred =
          new URLSearchParams(window.location.search).get("project") ||
          selectedProject(account.user.id);
        if (preferred && !result.projects.some((p) => p.id === preferred)) {
          try {
            const extra = await api.request<{ project: Project }>(
              `/v1/project-management/${preferred}`,
            );
            result.projects.push(extra.project);
          } catch {
            /* Unknown or inaccessible selections are not retained. */
          }
        }
        if (disposed) return;
        setUser(account.user);
        setProjects(result.projects);
        setNextCursor(result.nextCursor);
        setSelected(
          (
            result.projects.find((p) => p.id === preferred) ??
            result.projects.find((p) => p.status === "active") ??
            result.projects[0]
          )?.id ?? "",
        );
        setBooted(true);
      } catch (e) {
        if (disposed) return;
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else {
          setError(message(e));
          setBooted(true);
        }
      }
    }
    void boot();
    return () => {
      disposed = true;
    };
  }, [router]);
  useEffect(() => {
    if (!project || !needsMonitoring || view === "prompts") return;
    let disposed = false;
    const base = path(project);
    async function loadPages<T extends { id: string }>(
      kind: string,
      limit: number,
      pages: number,
      includeArchived = false,
    ) {
      const items: T[] = [];
      let before = "";
      let hasMore = false;
      for (let page = 0; page < pages; page++) {
        const batch = await api.request<T[]>(
          base +
            `/${kind}?limit=${limit}` +
            (kind === "prompts" && includeArchived
              ? "&includeArchived=true"
              : "") +
            (before ? `&before=${encodeURIComponent(before)}` : ""),
        );
        items.push(...batch);
        hasMore = batch.length === limit;
        if (!hasMore) break;
        before = batch[batch.length - 1].id;
      }
      return {
        items: [...new Map(items.map((item) => [item.id, item])).values()],
        hasMore,
      };
    }
    Promise.all([
      api.request<Health>(base + "/health"),
      api.request<Engine[]>(base + "/engines"),
      loadPages<Run>("runs", 25, runPageCount),
      loadPages<Prompt>("prompts", 100, promptPageCount, showArchivedPrompts),
      loadPages<Schedule>("schedules", 100, schedulePageCount),
    ])
      .then(([health, engines, runResult, promptResult, scheduleResult]) => {
        if (!disposed) {
          setSnapshot({
            projectId: project.id,
            value: {
              health,
              engines,
              runs: runResult.items,
              prompts: promptResult.items,
              schedules: scheduleResult.items,
            },
          });
          setPromptPagination({
            projectId: project.id,
            hasMore: promptResult.hasMore,
          });
          setMonitoringPagination({
            projectId: project.id,
            runs: runResult.hasMore,
            schedules: scheduleResult.hasMore,
          });
          setRefreshing(false);
        }
      })
      .catch((e) => {
        if (!disposed) {
          setRefreshing(false);
          if (e instanceof ApiError && e.status === 401)
            router.replace("/login");
          else setError(message(e));
        }
      });
    return () => {
      disposed = true;
    };
  }, [
    project,
    reload,
    router,
    needsMonitoring,
    view,
    promptPageCount,
    runPageCount,
    schedulePageCount,
    showArchivedPrompts,
  ]);
  useEffect(() => {
    if (!project || view !== "prompts") return;
    let disposed = false;
    const base = path(project);
    async function loadPrompts() {
      const items: Prompt[] = [];
      let before = "";
      let hasMore = false;
      for (let page = 0; page < promptPageCount; page += 1) {
        const batch = await api.request<Prompt[]>(
          base +
            `/prompts?limit=100` +
            (showArchivedPrompts ? "&includeArchived=true" : "") +
            (before ? `&before=${encodeURIComponent(before)}` : ""),
        );
        items.push(...batch);
        hasMore = batch.length === 100;
        if (!hasMore) break;
        before = batch[batch.length - 1]!.id;
      }
      return {
        prompts: [...new Map(items.map((item) => [item.id, item])).values()],
        hasMore,
      };
    }
    Promise.all([loadPrompts(), api.request<Engine[]>(base + "/engines")])
      .then(([result, engines]) => {
        if (disposed) return;
        setPromptSnapshot({
          projectId: project.id,
          prompts: result.prompts,
          engines,
          hasMore: result.hasMore,
        });
        setPromptPagination({ projectId: project.id, hasMore: result.hasMore });
        setRefreshing(false);
      })
      .catch((e: unknown) => {
        if (disposed) return;
        setRefreshing(false);
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else setError(message(e));
      });
    return () => {
      disposed = true;
    };
  }, [project, reload, router, view, promptPageCount, showArchivedPrompts]);
  useEffect(() => {
    if (!project || !needsMonitoring) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible")
        setReload((value) => value + 1);
    }, 15000);
    return () => window.clearInterval(interval);
  }, [project, needsMonitoring]);
  function refresh() {
    setError("");
    setPromptError("");
    setRefreshing(needsMonitoring);
    setReload((v) => v + 1);
  }
  function moreMonitoring(kind: "prompts" | "schedules" | "runs") {
    if (!project || refreshing) return;
    setRefreshing(true);
    if (kind === "prompts")
      setPromptPages({ projectId: project.id, count: promptPageCount + 1 });
    else
      setMonitoringPages({
        projectId: project.id,
        runs: runPageCount + (kind === "runs" ? 1 : 0),
        schedules: schedulePageCount + (kind === "schedules" ? 1 : 0),
      });
  }
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api.request("/v1/auth/logout", { method: "POST", auth: false });
      router.replace("/login");
    } catch (e) {
      setError(message(e));
      setBusy(false);
    }
  }
  async function more() {
    setBusy(true);
    try {
      const result = await api.request<{
        projects: Project[];
        nextCursor: string | null;
      }>("/v1/projects?limit=100&after=" + nextCursor);
      setProjects((p) => [...p, ...result.projects]);
      setNextCursor(result.nextCursor);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function createPrompt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !user || busy || promptInFlight.current) return;
    promptInFlight.current = true;
    const form = event.currentTarget;
    const input = new FormData(form);
    setBusy(true);
    setNotice("");
    setError("");
    setPromptError("");
    const payload = {
      body: String(input.get("body") ?? "").trim(),
      persona: String(input.get("persona") ?? "").trim(),
      tags: String(input.get("tags") ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .slice(0, 10),
    };
    const operation = `prompt.create:${project.id}`;
    try {
      if (!payload.body)
        throw new Error("Enter a question before adding a prompt.");
      const fingerprint = JSON.stringify(payload);
      if (
        pendingPrompt.current?.projectId !== project.id ||
        pendingPrompt.current.fingerprint !== fingerprint
      ) {
        pendingPrompt.current = {
          projectId: project.id,
          fingerprint,
          key: projectRequestKey(user.id, operation, payload),
        };
      }
      await api.request(path(project) + "/prompts", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": pendingPrompt.current.key },
      });
      clearProjectRequest(user.id, operation);
      pendingPrompt.current = null;
      form.reset();
      setNotice(
        "Prompt added. It is ready to include in a monitoring schedule.",
      );
      setAddPromptOpen(false);
      refresh();
    } catch (e) {
      setPromptError(
        e instanceof ApiError && (e.status === 0 || e.status >= 500)
          ? "The save could not be confirmed. Retry with the same question and context to safely retrieve the saved prompt."
          : message(e),
      );
    } finally {
      promptInFlight.current = false;
      setBusy(false);
    }
  }
  async function togglePrompt(p: Prompt) {
    if (!project || busy) return;
    setBusy(true);
    setError("");
    setPromptError("");
    try {
      await api.request(path(project) + "/prompts/" + p.id, {
        method: "PATCH",
        body: { active: !p.active },
      });
      setNotice(
        p.active
          ? "Prompt paused for future runs. Already queued runs are preserved."
          : "Prompt resumed for future runs.",
      );
      refresh();
    } catch (e) {
      setPromptError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function stopQuotaRetries() {
    if (!project || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.request<{ stopped: number }>(
        path(project) + "/runs/stop-quota-retries",
        { method: "POST" },
      );
      refresh();
      setNotice(
        `${result.stopped} quota retries stopped. Reserved monitoring credits were released.`,
      );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const sectionKey = `${project?.id}:${reload}`;
  const independentContent = !project ? null : view === "prompts" ? (
    <PromptLibrary
      key={project.id}
      project={project}
      engines={promptData?.engines ?? []}
      prompts={promptData?.prompts ?? []}
      busy={busy}
      hasMore={promptData?.hasMore ?? false}
      refreshing={refreshing}
      loading={!promptData && !error}
      loadError={!promptData && Boolean(error)}
      addPromptOpen={addPromptOpen}
      showArchived={showArchivedPrompts}
      onShowArchived={(value) => {
        setShowArchivedPrompts(value);
        setPromptPages({ projectId: project.id, count: 1 });
      }}
      onLoadMore={() => {
        setRefreshing(true);
        setPromptPages({ projectId: project.id, count: promptPageCount + 1 });
      }}
      onRefresh={refresh}
      onCreate={createPrompt}
      onToggle={togglePrompt}
      onToggleAddPrompt={() => setAddPromptOpen((open) => !open)}
      onError={setPromptError}
    />
  ) : view === "overview" ? (
    <OverviewDashboard key={sectionKey} project={project} />
  ) : view === "answers" ? (
    <AnswerExplorer key={sectionKey} project={project} />
  ) : view === "visibility" ? (
    <VisibilityDashboard key={sectionKey} project={project} />
  ) : view === "citations" ? (
    <CitationIntelligence key={sectionKey} project={project} />
  ) : view === "competitors" ? (
    <CompetitorIntelligence key={sectionKey} project={project} />
  ) : view === "axo" ? (
    <AgentExperience
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "content" ? (
    <ContentIntelligence
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "actions" ? (
    <ActionCenter
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "traffic" ? (
    <TrafficAnalytics
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "reporting" ? (
    <ReportingDashboard
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "billing" ? (
    <BillingDashboard
      key={sectionKey}
      tenantId={project.tenantId}
      project={project}
    />
  ) : view === "operator" ? (
    <OperatorDashboard key={sectionKey} />
  ) : null;
  return (
    <div
      className={`app-shell workspace-shell${sidebarCollapsed ? " sidebar-collapsed" : ""}${view === "overview" ? " overview-shell" : ""}`}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        />
      )}
      <aside
        className={"sidebar" + (menu ? " mobile-open" : "")}
        aria-label="Workspace navigation"
      >
        <div className="sidebar-brand-row">
          <Link
            className="brand"
            href={projectHref("/dashboard")}
            aria-label="Savoir home"
          >
            <span className="brand-mark" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="brand-name">savoir.</span>
          </Link>
          <button
            type="button"
            className="sidebar-collapse-toggle"
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={() => setSidebarCollapsed((collapsed) => !collapsed)}
          >
            {sidebarCollapsed ? (
              <ChevronRight size={16} />
            ) : (
              <ChevronLeft size={16} />
            )}
          </button>
        </div>
        <label className="project-switch">
          <span className="avatar">
            {project?.brandName.slice(0, 1).toUpperCase() ?? "S"}
          </span>
          <span>
            <small>YOUR PROJECT</small>
            <select
              aria-label="Select project"
              title={project?.brandName ?? "Select project"}
              value={selected}
              disabled={!projects.length || busy}
              onChange={(e) => {
                setSelected(e.target.value);
                setAddPromptOpen(false);
                if (user) selectProject(user.id, e.target.value);
                const url = new URL(window.location.href);
                url.searchParams.set("project", e.target.value);
                router.replace(`${url.pathname}${url.search}${url.hash}`, {
                  scroll: false,
                });
                setSnapshot(null);
                setError("");
                setPromptError("");
                setPromptPages({ projectId: e.target.value, count: 1 });
                setShowArchivedPrompts(false);
                setNotice("");
                setRun(null);
                setMenu(false);
              }}
            >
              {!projects.length && <option value="">No project yet</option>}
              {projects.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.brandName}
                </option>
              ))}
            </select>
          </span>
          <ChevronDown size={14} />
        </label>
        <div className="project-links">
          <Link href={projectHref("/projects")}>All projects</Link>
          <Link href={projectHref("/projects/new")}>
            <Plus size={13} /> Add project
          </Link>
        </div>
        {project && (
          <Link
            className="project-settings-link"
            href={projectHref(`/projects/${project.id}/settings`)}
          >
            Project settings
            <ArrowRight size={13} />
          </Link>
        )}
        {nextCursor && (
          <button className="text-button" onClick={more} disabled={busy}>
            Load more projects
          </button>
        )}
        <nav>
          <p className="nav-label">OVERVIEW</p>
          <Nav
            href={projectHref("/dashboard")}
            active={view === "overview"}
            icon={<LayoutDashboard size={17} />}
            label="Overview"
          />
          <p className="nav-label spaced">MEASURE</p>
          <Nav
            href={projectHref("/prompts")}
            active={view === "prompts"}
            icon={<MessageSquareText size={17} />}
            label="Prompts"
          />
          <Nav
            href={projectHref("/monitoring")}
            active={view === "monitoring"}
            icon={<Activity size={17} />}
            label="Monitoring"
          />
          <Nav
            href={projectHref("/answers")}
            active={view === "answers"}
            icon={<FileText size={17} />}
            label="Answer Explorer"
          />
          <Nav
            href={projectHref("/visibility")}
            active={view === "visibility"}
            icon={<BarChart3 size={17} />}
            label="Visibility Analytics"
          />
          <p className="nav-label spaced">INTELLIGENCE</p>
          <Nav
            href={projectHref("/citations")}
            active={view === "citations"}
            icon={<Link2 size={17} />}
            label="Citation Intelligence"
          />
          <Nav
            href={projectHref("/competitors")}
            active={view === "competitors"}
            icon={<Globe2 size={17} />}
            label="Competitor Intelligence"
          />
          <Nav
            href={projectHref("/technical")}
            active={view === "technical"}
            icon={<FileText size={17} />}
            label="Technical AEO Audit"
          />
          <Nav
            href={projectHref("/axo")}
            active={view === "axo"}
            icon={<Bot size={17} />}
            label="Agent Experience (AXO)"
          />
          <Nav
            href={projectHref("/content")}
            active={view === "content"}
            icon={<BookOpen size={17} />}
            label="Content Intelligence"
          />
          <p className="nav-label spaced">OPTIMIZE</p>
          <Nav
            href={projectHref("/actions")}
            active={view === "actions"}
            icon={<ListTodo size={17} />}
            label="Action Center"
          />
          <p className="nav-label spaced">REPORTING</p>
          <Nav
            href={projectHref("/traffic")}
            active={view === "traffic"}
            icon={<TrendingUp size={17} />}
            label="AI Traffic"
          />
          <Nav
            href={projectHref("/reporting")}
            active={view === "reporting"}
            icon={<FileText size={17} />}
            label="Executive Reports"
          />
          <p className="nav-label spaced">MANAGE</p>
          <Nav
            href={projectHref("/billing")}
            active={view === "billing"}
            icon={<CreditCard size={17} />}
            label="Billing & Credits"
          />
          <Nav
            href={projectHref("/operator")}
            active={view === "operator"}
            icon={<Sliders size={17} />}
            label="Operator Console"
          />
        </nav>
        <div className="sidebar-bottom">
          <Link
            href={projectHref("/billing")}
            className="usage-card block hover:opacity-90 transition"
          >
            <div>
              <Coins size={15} />
              <b>Workspace credits</b>
            </div>
            <strong>
              {data?.health.credits?.available?.toLocaleString() ?? "—"}
              <small> available</small>
            </strong>
            <p>
              {data?.health.credits
                ? `${data.health.credits.reserved} reserved · ${data.health.credits.used} used`
                : "Balances appear after project setup."}
            </p>
          </Link>
          <div className="user-row">
            <span className="avatar">
              {user?.name.slice(0, 1).toUpperCase() ?? "S"}
            </span>
            <span>
              <b>{user?.name ?? "Your account"}</b>
              <small>Workspace owner</small>
            </span>
            <button
              className="icon-button"
              aria-label="Sign out"
              onClick={logout}
              disabled={busy || !user}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="icon-button menu-toggle"
              aria-label="Open navigation"
              onClick={() => setMenu(true)}
            >
              <Menu size={18} />
            </button>
            <span>{project?.tenantName ?? "Workspace"}</span>
            <span>/</span>
            <b>{labels[view]}</b>
          </div>
          <div className="top-tools">
            <WorkspaceTools
              sections={{ ...labels, help: "Help & getting started" }}
              projectId={project?.id}
            />
            <span className="pill">
              <span className="dot" />
              {user ? "Signed in" : "Connecting"}
            </span>
            <Link
              className="icon-button"
              href="/help#methodology"
              aria-label="How we measure"
            >
              <CircleHelp size={17} />
            </Link>
            <details
              className="account-menu"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                  event.currentTarget.open = false;
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.currentTarget.open = false;
                  event.currentTarget.querySelector("summary")?.focus();
                }
              }}
            >
              <summary
                className="avatar"
                aria-label="Open account menu"
                title={user?.name ?? "Your account"}
              >
                {user?.name
                  .trim()
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0])
                  .join("")
                  .toUpperCase() ?? "S"}
              </summary>
              <div className="account-menu-popover">
                <div className="account-menu-identity">
                  <strong>{user?.name ?? "Your account"}</strong>
                  <span>{user?.email ?? "Account details unavailable"}</span>
                </div>
                <button
                  type="button"
                  className="account-menu-signout"
                  onClick={logout}
                  disabled={busy || !user}
                >
                  <LogOut size={15} aria-hidden="true" />
                  <span>Sign out</span>
                </button>
              </div>
            </details>
          </div>
        </header>
        <main id="main" className="canvas">
          {!viewsWithDedicatedHeading.has(view) && (
            <div
              className={`page-heading${view === "citations" || view === "competitors" ? " citation-page-heading" : ""}${view === "overview" ? " overview-page-heading" : ""}`}
            >
              <div>
                <p className="eyebrow">
                  {view === "competitors"
                    ? "COMPETITOR INTELLIGENCE"
                    : view === "overview"
                    ? "YOUR AI SEARCH WORKSPACE"
                    : view === "prompts"
                      ? "PROMPT LIBRARY"
                      : view === "answers"
                        ? "ANSWER INTELLIGENCE & CITATIONS"
                        : view === "citations"
                          ? "CITATION INTELLIGENCE & GAPS"
                          : view === "content"
                            ? "CONTENT INTELLIGENCE & BRIEFS"
                            : view === "actions"
                              ? "OPTIMIZATION ACTION CENTER"
                              : view === "traffic"
                                ? "AI TRAFFIC & INTEGRATIONS"
                                : view === "reporting"
                                  ? "EXECUTIVE REPORTING & ALERTS"
                                  : view === "billing"
                                    ? "SUBSCRIPTION & CREDIT LEDGER"
                                    : view === "operator"
                                      ? "INTERNAL OPERATOR CONSOLE"
                                      : "AI ENGINE MONITORING"}
                </p>
                <h1>
                  {view === "competitors"
                    ? "Competitor Intelligence & Gap Analysis"
                    : view === "overview"
                    ? "Your brand, in the answer."
                    : view === "visibility"
                      ? "Normative AI Visibility Intelligence"
                      : view === "citations"
                        ? "Citation Intelligence & Gap Analysis"
                        : view === "content"
                          ? "Content Inventory, Gaps & AEO Briefs"
                          : view === "actions"
                            ? "Prioritized Actions & Closed-Loop Verification"
                            : view === "traffic"
                              ? "AI Referral Traffic & Integrations Stream"
                              : view === "reporting"
                                ? "Executive Intelligence & Incident Response"
                                : view === "billing"
                                  ? "Platform Billing & Credit Ledger"
                                  : view === "operator"
                                    ? "Platform Administration & Tenant Controls"
                                    : view === "prompts"
                                      ? "Track the questions that matter."
                                      : view === "answers"
                                        ? "Explore what AI engines tell the world."
                                        : "Keep a pulse on your presence."}
                </h1>
                <p className="subtitle">
                  {view === "competitors"
                    ? "Compare competitor visibility, explore head-to-head performance, and uncover gaps across AI engines."
                    : view === "overview"
                    ? "A clear view of your AI visibility—and what comes next."
                    : view === "visibility"
                      ? "Composite AI Visibility Score, Share of Voice, and statistical significance across search engines."
                      : view === "citations"
                        ? "Track cited domains, uncover competitor citation gaps, and detect broken brand references across engines."
                        : view === "content"
                          ? "Cluster content against prompt demand, detect coverage gaps against cited competitors, and produce actionable AEO briefs."
                          : view === "actions"
                            ? "Convert findings from technical audits, citation gaps, and content intelligence into high-impact to-do items with copy-ready fixes."
                            : view === "traffic"
                              ? "Classify AI-referred visits from ChatGPT, Gemini, Perplexity, and Claude with conversion multiplier analytics and GSC search prompt opportunities."
                              : view === "reporting"
                                ? "Cross-module executive synthesis, statistical drop detection, automated incident triage, and PDF reporting."
                                : view === "billing"
                                  ? "Manage your subscription tier, buy credit top-up packs, launch Stripe customer portal, and monitor your atomic credit balance ledger."
                                  : view === "operator"
                                    ? "Search tenants, inspect active subscriptions, adjust credits, pause/resume tenants, and monitor platform queues."
                                    : view === "prompts"
                                      ? "Build a focused view of how your audience discovers and compares brands."
                                      : view === "answers"
                                        ? "Analyze brand mentions, competitor ranks, sentiment, and cited sources across engines."
                                        : "Follow your engine health, schedules, and collected answers."}
                </p>
              </div>
              <div className="actions">
                {sidebarCollapsed && (
                  <div className="collapsed-project-actions">
                    <Link className="button" href={projectHref("/projects")}>
                      All projects
                    </Link>
                    <Link
                      className="button"
                      href={projectHref("/projects/new")}
                    >
                      <Plus size={15} />
                      Add project
                    </Link>
                  </div>
                )}
                <button
                  className="button"
                  onClick={refresh}
                  disabled={!project || refreshing}
                  aria-label="Refresh monitoring data"
                >
                  <RefreshCw size={15} className={refreshing ? "spin" : ""} />
                  Refresh
                </button>
                {view === "prompts" ? (
                  <button
                    className="button primary"
                    type="button"
                    disabled={!project || busy}
                    aria-expanded={addPromptOpen}
                    aria-controls="prompt-create"
                    onClick={() => setAddPromptOpen((open) => !open)}
                  >
                    {addPromptOpen ? <X size={16} /> : <Plus size={16} />}
                    {addPromptOpen ? "Close form" : "Add prompt"}
                  </button>
                ) : (
                  <Link
                    className="button primary"
                    href={projectHref("/prompts")}
                  >
                    <Plus size={16} />
                    Add prompt
                  </Link>
                )}
              </div>
            </div>
          )}
          {(error || promptError) && (
            <div className="error-banner" role="alert">
              <span>{promptError || error}</span>
              <button
                className="text-button"
                onClick={() => (project ? refresh() : window.location.reload())}
              >
                Try again
              </button>
            </div>
          )}
          {notice && (
            <p className="notice" role="status">
              <Check size={16} />
              {notice}
            </p>
          )}
          {!booted ? (
            <Loading />
          ) : !user ? (
            <Empty
              icon={<ShieldCheck />}
              title="We could not open your workspace."
              text="Check that the backend is available, then try again."
            />
          ) : !project ? (
            <Empty
              icon={<Plus />}
              title="Your next chapter starts with a project."
              text="Set up your brand domain and start monitoring AI visibility across ChatGPT and Gemini in minutes."
              action={
                <Link className="button primary" href="/onboarding">
                  Start Onboarding Wizard <ArrowRight size={16} />
                </Link>
              }
            />
          ) : view === "technical" ? (
            <TechnicalAudit key={project.id} project={project} />
          ) : independentContent ? (
            independentContent
          ) : !data && !error ? (
            <Loading />
          ) : data &&
            (!error || view === "prompts" || view === "monitoring") ? (
            <>
              <div className="context-row">
                <span>
                  <Globe2 size={14} />
                  {project.domain}
                </span>
                <span className="pill">{project.status}</span>
                <span className="context-note">
                  Workspace data · Connected project
                </span>
              </div>
              {view === "monitoring" && (
                <div className="stats">
                  <Metric
                    primary
                    label="Collection success"
                    value={
                      data.health.success_rate_7d === null
                        ? "—"
                        : `${(data.health.success_rate_7d * 100).toFixed(1)}%`
                    }
                    note="Completed observations · last 7 days"
                    icon={<Activity size={16} />}
                  />
                  <Metric
                    label="Queued & processing"
                    value={String(data.health.backlog)}
                    note="Runs waiting or in progress"
                    icon={<Clock3 size={16} />}
                  />
                  <Metric
                    label="Project credits used"
                    value={String(data.health.credits_used)}
                    note="Successful runs and observed refusals"
                    icon={<ArrowDownLeft size={16} />}
                  />
                  <Metric
                    label="Available credits"
                    value={
                      data.health.credits
                        ? String(data.health.credits.available)
                        : "—"
                    }
                    note="Shared across your workspace"
                    icon={<Coins size={16} />}
                  />
                </div>
              )}
                          {
                <>
                  {view === "monitoring" && (
                    <>
                      <MonitoringControls
                        key={project.id}
                        project={project}
                        data={data}
                        onChanged={refresh}
                        pagination={{
                          prompts:
                            promptPagination.projectId === project.id &&
                            promptPagination.hasMore,
                          schedules:
                            monitoringPagination.projectId === project.id &&
                            monitoringPagination.schedules,
                          loading: refreshing,
                          more: moreMonitoring,
                        }}
                      />
                      <div className="monitoring-engines">
                        <Engines engines={data.engines} />
                      </div>
                    </>
                  )}
                  <section className="panel">
                    <PanelHead
                      title="Recent monitoring runs"
                      description={`${data.runs.length} runs loaded · results are collected samples`}
                      aside={
                        <div className="actions">
                          <span className="pill">{data.runs.length} runs</span>
                          {data.runs.some(
                            (r) =>
                              r.status === "queued" &&
                              [
                                "PROVIDER_RATE_LIMITED",
                                "PROVIDER_QUOTA_REVIEW_REQUIRED",
                              ].includes(r.error_code ?? ""),
                          ) && (
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() => void stopQuotaRetries()}
                            >
                              Stop quota retries
                            </button>
                          )}
                        </div>
                      }
                    />
                    {data.runs.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Prompt / question</th>
                              <th>Engine</th>
                              <th>Status</th>
                              <th>Collected</th>
                              <th>Result</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.runs.map((r) => (
                              <tr key={r.id}>
                                <td>
                                  <b>{r.request.prompt}</b>
                                  <small>
                                    {r.request.geo} · {r.request.language}
                                  </small>
                                </td>
                                <td>
                                  {names[r.request.engine] ?? r.request.engine}
                                </td>
                                <td>
                                  <span
                                    className={"pill run-stage-" + r.status}
                                  >
                                    {runStage(r)}
                                  </span>
                                  {r.status === "queued" &&
                                    r.attempts !== undefined &&
                                    r.attempts > 0 &&
                                    r.available_at && (
                                      <>
                                        <small>
                                          Next retry: {date(r.available_at)}
                                        </small>
                                        <small>
                                          This automatic retry may make a new
                                          provider request and incur provider
                                          charges.
                                        </small>
                                      </>
                                    )}
                                  {r.error_code && (
                                    <ProviderError
                                      code={r.error_code}
                                      engine={r.request.engine}
                                      compact
                                    />
                                  )}
                                </td>
                                <td className="nowrap">{date(r.created_at)}</td>
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() => setRun(r)}
                                  >
                                    View <ArrowRight size={12} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="runs-empty">
                        <MessageSquareText size={25} />
                        <h3>Your first answer is ahead.</h3>
                        <p>
                          Collected runs will appear here once a configured
                          monitoring schedule executes.
                        </p>
                        <Link
                          href={projectHref("/prompts")}
                          className="text-link"
                        >
                          Start with a prompt <ArrowRight size={14} />
                        </Link>
                      </div>
                    )}
                    <div className="table-footer">
                      {view === "monitoring" &&
                        monitoringPagination.projectId === project.id &&
                        monitoringPagination.runs && (
                          <button
                            className="button"
                            disabled={refreshing}
                            onClick={() => moreMonitoring("runs")}
                          >
                            Load more runs
                          </button>
                      )}
                      <span>
                        Last successful run:{" "}
                        {date(data.health.last_successful_run)}
                      </span>
                      <ShieldCheck size={14} />
                    </div>
                  </section>
                </>
              }
            </>
          ) : null}
          <footer className="footnote" id="methodology">
            <span>
              Official API samples may differ from consumer AI apps. Locale is
              simulated.
            </span>
            <span>
              Observed refusals count as completed runs. No ranking guarantees.
            </span>
          </footer>
        </main>
      </div>
      {run && <RunDialog run={run} onClose={() => setRun(null)} />}
    </div>
  );
}
function Nav({
  href,
  active,
  icon,
  label,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={"nav-item" + (active ? " active" : "")}
      aria-current={active ? "page" : undefined}
      aria-label={label}
      title={label}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}
function PanelHead({
  title,
  description,
  aside,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
}) {
  return (
    <header className="panel-head">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {aside}
    </header>
  );
}
function Metric({
  label,
  value,
  note,
  primary,
  icon,
}: {
  label: string;
  value: string;
  note: string;
  primary?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <section className={"metric" + (primary ? " primary-metric" : "")}>
      <div className="metric-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <p>{note}</p>
    </section>
  );
}
function Status({ status }: { status: string }) {
  return (
    <span className={"pill status-" + status}>
      <span className="dot" />
      {status.replaceAll("_", " ")}
    </span>
  );
}
function Engines({ engines }: { engines: Engine[] }) {
  return (
    <section className="panel">
      <PanelHead
        title="Your AI engines"
        description="Collection availability, not visibility performance"
      />
      <div className="engine-list">
        {engines.map((e) => (
          <div className="engine-row" key={e.engine}>
            <span className="engine-mark">
              {e.engine === "gemini" ? (
                <Sparkles size={17} />
              ) : e.engine === "openai" ? (
                "G"
              ) : (
                "Ai"
              )}
            </span>
            <div>
              <b>{names[e.engine] ?? e.engine}</b>
              <small>
                {e.engine === "openrouter"
                  ? "OpenRouter API · free model · no live web search"
                  : e.engine === "gemini"
                  ? "Official API · search grounding"
                  : e.engine === "openai"
                    ? "Official API · web search"
                    : e.engine === "google_ai_mode"
                      ? "Configured SERP provider · separate from Gemini Search grounding"
                      : "Licensed search provider · access required"}
              </small>
              <small>
                Model: {e.observedModel ?? e.model ?? "Not specified"}
              </small>
              {e.observedAt && <small>Observed: {date(e.observedAt)}</small>}
              {e.observedStatus === "refused" && (
                <small>The provider returned a refusal.</small>
              )}
              {e.errorCode && (
                <ProviderError code={e.errorCode} engine={e.engine} />
              )}
            </div>
            <span className="pill">
              {engineStatusLabel(e.configured, e.observationStatus)}
            </span>
          </div>
        ))}
        <p className="engine-note">
          Unavailable engines are never counted as zero visibility.
        </p>
      </div>
    </section>
  );
}
function Loading() {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle className="spin" size={22} />
      <p>Opening your workspace…</p>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel empty-state">
      <span className="icon-tile">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && <div style={{ marginTop: "1.25rem" }}>{action}</div>}
    </section>
  );
}
function RunDialog({ run, onClose }: { run: Run; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="run-title">
      <div className="dialog-head">
        <h2 id="run-title">Collected answer</h2>
        <button
          className="icon-button"
          onClick={() => ref.current?.close()}
          aria-label="Close answer"
        >
          <X size={18} />
        </button>
      </div>
      <div className="dialog-body">
        <Status status={run.status} />
        <h3>{run.request.prompt}</h3>
        <p className="muted">
          {names[run.request.engine]} · {date(run.created_at)} ·{" "}
          {run.request.geo} / {run.request.language}
        </p>
        {run.result && <p>{runGroundingLabel(run.result)}</p>}
        {run.error_code && (
          <ProviderError code={run.error_code} engine={run.request.engine} />
        )}
        <div className="answer-text">
          {run.result?.text ||
            (run.status === "refused"
              ? "The provider declined to answer this prompt."
              : "No answer content is available for this run.")}
        </div>
        <small>
          API output is untrusted source content, displayed as plain text.
        </small>
      </div>
    </dialog>
  );
}
