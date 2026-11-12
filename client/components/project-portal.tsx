"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Plus,
  Settings,
  Activity,
  FolderOpen,
  RefreshCw,
  Trash2,
  LoaderCircle,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import { ProviderError } from "./provider-error";
import { engineStatusLabel } from "../lib/provider-status";
import {
  selectProject,
  selectedProject,
  projectRequestKey,
  clearProjectRequest,
} from "../lib/project-selection";
import type { Project, User } from "../lib/types";
import styles from "./project-portal.module.css";

type Market = { country: string; language: string };
type Competitor = {
  id?: string;
  name: string;
  domain: string;
  aliases: string[];
  rationale?: string;
};
type Prompt = { id?: string; body: string; active: boolean };
type Connections = {
  engines: {
    engine: string;
    name: string;
    model: string;
    configured: boolean;
    requiresGrounding: boolean;
    observationStatus?: "succeeded" | "failed" | "refused" | "uncertain" | null;
    observedStatus?: string | null;
    observedAt?: string | null;
    observedModel?: string | null;
    errorCode?: string | null;
  }[];
  firecrawl: { configured: boolean };
  dailyCallLimit: number;
  note: string;
};
type Detail = {
  project: Project & {
    description: string;
    aliases: string[];
    markets: Market[];
  };
  competitors: Competitor[];
  prompts: Prompt[];
  schedules: {
    id: string;
    status: string;
    config: {
      engine: string;
      model: string;
      cadence?: string;
      intervalMinutes: number;
      samples: number;
    };
    next_run_at: string;
  }[];
  runs: {
    id: string;
    status: string;
    request: { engine: string; prompt: string; model: string };
    error_code: string | null;
    created_at: string;
    available_at: string;
    attempts: number;
    answer_processed: boolean;
    result: { modelVersion?: string } | null;
  }[];
  counts: { pending: number; succeeded: number; failed: number };
  answers: number;
  credits: { available: number; reserved: number; used: number } | null;
  audit: {
    id: string;
    status: string;
    pages_crawled: number;
    pages_limit: number;
    overall_score: number;
    error_message: string | null;
  } | null;
  launch: {
    runIds: string[];
    scheduleIds: string[];
    auditId?: string;
    auditError?: string;
  } | null;
};
type ConnectionTestResult = {
  projectId: string;
  status: "succeeded" | "failed" | "uncertain";
  generationStatus: "succeeded" | "refused" | null;
  engine: string;
  model: string;
  modelVersion: string | null;
  latencyMs: number | null;
  groundingObserved: boolean;
  citationsCount: number;
  testedAt: string;
  errorCode?: string;
  platformCreditsApplied: false;
};
type Form = {
  domain: string;
  brandName: string;
  description: string;
  aliases: string[];
  markets: Market[];
  competitors: Competitor[];
  prompts: Prompt[];
  engines: string[];
  mode: "save" | "once" | "schedule";
  cadence: "daily" | "weekly";
  samples: number;
  crawl: boolean;
  pagesLimit: number;
};
const empty: Form = {
  domain: "",
  brandName: "",
  description: "",
  aliases: [],
  markets: [{ country: "US", language: "en" }],
  competitors: [],
  prompts: [],
  engines: [],
  mode: "save",
  cadence: "daily",
  samples: 1,
  crawl: false,
  pagesLimit: 1,
};
const steps = [
  "Website & brand",
  "Competitors & markets",
  "Monitoring prompts",
  "Engines & schedule",
  "Review",
  "Launch",
];
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Something went wrong. Please try again.";
const endpoint = (id: string) => `/v1/project-management/${id}`;
const showDate = (value: string) => new Date(value).toLocaleString();
function runStage(run: Detail["runs"][number]) {
  if (run.status === "queued")
    return run.attempts > 0 ? "Queued · automatic retry" : "Queued";
  if (run.status === "processing") return "Calling provider";
  if (run.status === "succeeded" || run.status === "refused")
    return run.answer_processed ? "Completed" : "Processing answer";
  if (run.status === "failed") return "Failed";
  return "Uncertain";
}

export function ProjectPortal({
  view,
  projectId,
}: {
  view: "projects" | "new" | "settings" | "progress" | "connections";
  projectId?: string;
}) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [cursor, setCursor] = useState<string | null>(null);
  const [connections, setConnections] = useState<Connections | null>(null),
    [detail, setDetail] = useState<Detail | null>(null);
  const [engineObservationSnapshot, setEngineObservationSnapshot] = useState<{
    projectId: string;
    engines: Connections["engines"];
  } | null>(null);
  const [testEngine, setTestEngine] = useState<
    Connections["engines"][number] | null
  >(null);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(
    null,
  );
  const [testPending, setTestPending] = useState(false);
  const testInFlight = useRef(false);
  const testKeys = useRef(new Map<string, string>());
  const testDialogRef = useRef<HTMLDialogElement>(null);
  const [summaries, setSummaries] = useState<
    Record<
      string,
      {
        lastRunAt: string | null;
        lastAuditStatus: string | null;
        lastAuditScore: number | null;
      }
    >
  >({});
  const [form, setForm] = useState<Form>(empty),
    [step, setStep] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState(""),
    [loadedId, setLoadedId] = useState("");
  const engineObservations =
    engineObservationSnapshot?.projectId === selected
      ? engineObservationSnapshot.engines
      : [];
  const [archiveConfirm, setArchiveConfirm] = useState(false),
    [savedProject, setSavedProject] = useState("");
  const update = (changes: Partial<Form>) =>
    setForm((old) => ({ ...old, ...changes }));
  const loadDetail = useCallback(async () => {
    if (projectId) {
      const value = await api.request<Detail>(endpoint(projectId));
      setDetail(value);
      return value;
    }
  }, [projectId]);
  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        const account = await api.request<{ user: User }>("/v1/auth/me");
        const [list, providers] = await Promise.all([
          api.request<{ projects: Project[]; nextCursor: string | null }>(
            "/v1/projects?limit=100",
          ),
          api.request<Connections>("/v1/project-management/connections"),
        ]);
        if (cancelled) return;
        setUser(account.user);
        setProjects(list.projects);
        setCursor(list.nextCursor);
        setConnections(providers);
        if (view === "projects") {
          const result = await api.request<typeof summaries>(
            "/v1/project-management/summaries",
          );
          if (!cancelled) setSummaries(result);
        }
        const active =
          projectId ||
          selectedProject(account.user.id) ||
          list.projects.find((p) => p.status === "active")?.id ||
          list.projects[0]?.id ||
          "";
        setSelected(active);
        if (projectId) selectProject(account.user.id, projectId);
        if (projectId) {
          const value = await api.request<Detail>(endpoint(projectId));
          if (cancelled) return;
          setDetail(value);
          setForm({
            ...empty,
            mode: "once",
            domain: value.project.domain,
            brandName: value.project.brandName,
            description: value.project.description,
            aliases: value.project.aliases,
            markets: value.project.markets,
            competitors: value.competitors.map((c) => ({
              ...c,
              rationale: c.rationale ?? "",
            })),
            prompts: value.prompts,
            engines: [...new Set(value.schedules.map((s) => s.config.engine))],
            cadence:
              value.schedules[0]?.config.intervalMinutes === 10080
                ? "weekly"
                : "daily",
            samples: value.schedules[0]?.config.samples ?? 1,
          });
          setLoadedId(projectId);
        } else if (view === "new") {
          const draft = await api.request<{
            step: number;
            data: Partial<Form> & { selfService?: boolean };
          } | null>("/v1/onboarding/draft");
          if (!cancelled && draft?.data.selfService) {
            setForm({ ...empty, ...draft.data });
            setStep(Math.max(0, Math.min(5, draft.step - 1)));
            setNotice("Your saved draft has been restored.");
          }
        }
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) router.replace("/login");
        else if (!cancelled) setError(message(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [projectId, view, router]);
  useEffect(() => {
    if (view !== "progress" || !projectId) return;
    let stopped = false;
    async function poll() {
      try {
        if (document.visibilityState === "visible") await loadDetail();
      } catch (e) {
        if (!stopped) setError(message(e));
      }
    }
    const timer = setInterval(() => void poll(), 5000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [view, projectId, loadDetail]);
  useEffect(() => {
    if (view !== "connections" || !selected) return;
    const project = projects.find((item) => item.id === selected);
    if (!project) return;
    let cancelled = false;
    api
      .request<Connections["engines"]>(
        `/v1/tenants/${project.tenantId}/projects/${project.id}/monitoring/engines`,
      )
      .then((engines) => {
        if (!cancelled)
          setEngineObservationSnapshot({ projectId: project.id, engines });
      })
      .catch((e) => {
        if (!cancelled) setError(message(e));
      });
    return () => {
      cancelled = true;
    };
  }, [view, selected, projects]);
  useEffect(() => {
    const dialog = testDialogRef.current;
    if (!dialog) return;
    if (testEngine && !dialog.open) dialog.showModal();
    else if (!testEngine && dialog.open) dialog.close();
  }, [testEngine]);
  async function perform(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function runConnectionTest(engine: string) {
    if (!selected || testInFlight.current) return;
    const project = projects.find((item) => item.id === selected);
    if (!project) {
      setError("Choose a project before testing a provider connection.");
      return;
    }
    testInFlight.current = true;
    setTestPending(true);
    setError("");
    setTestResult(null);
    const testIdentity = `${project.id}:${engine}`;
    let key = testKeys.current.get(testIdentity);
    if (!key) {
      key = crypto.randomUUID();
      testKeys.current.set(testIdentity, key);
    }
    try {
      const result = await api.request<ConnectionTestResult>(
        `/v1/tenants/${project.tenantId}/projects/${project.id}/monitoring/canary`,
        {
          method: "POST",
          body: { engine },
          headers: { "Idempotency-Key": key },
          timeoutMs: 75000,
        },
      );
      if (result.errorCode !== "CONNECTION_TEST_UNCONFIRMED")
        testKeys.current.delete(testIdentity);
      setTestResult({ ...result, projectId: project.id });
      setTestEngine(null);
    } catch (e) {
      setError(
        e instanceof ApiError && (e.status === 0 || e.status >= 500)
          ? "The connection test outcome could not be confirmed. It may still be running. Confirm again to retrieve this test safely; the same test will not make another provider request."
          : message(e),
      );
    } finally {
      testInFlight.current = false;
      setTestPending(false);
    }
  }
  async function saveDraft(next = step) {
    await api.request("/v1/onboarding/draft", {
      method: "PUT",
      body: { step: next + 1, data: { ...form, selfService: true } },
    });
  }
  async function next() {
    await perform(async () => {
      validateStep();
      await saveDraft(Math.min(step + 1, 5));
      setStep((s) => Math.min(s + 1, 5));
    });
  }
  function validateStep() {
    if (!form.domain.trim() || !form.brandName.trim())
      throw new Error("Enter a website and brand name.");
    try {
      const domain = form.domain.trim();
      const url = new URL(
        domain.includes("://") ? domain : `https://${domain}`,
      );
      if (
        !["http:", "https:"].includes(url.protocol) ||
        !url.hostname.includes(".") ||
        url.username ||
        url.password
      )
        throw new Error("Invalid website");
    } catch {
      throw new Error("Enter a valid website domain or HTTP(S) URL.");
    }
    if (
      form.markets.some(
        (m) =>
          !/^[A-Z]{2}$/.test(m.country) ||
          !/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(m.language),
      )
    )
      throw new Error(
        "Use a two-letter country code and a language code such as US and en.",
      );
    if (form.competitors.some((c) => !c.name.trim() || !c.domain.trim()))
      throw new Error("Complete or remove empty competitors.");
    if (form.prompts.some((p) => p.body.trim().length < 3))
      throw new Error("Each prompt needs at least three characters.");
  }
  function launchBody() {
    return {
      mode: form.mode === "schedule" ? "schedule" : "once",
      engines: form.engines,
      cadence: form.cadence,
      samples: form.samples,
      crawl: form.crawl,
      pagesLimit: form.pagesLimit,
    };
  }
  function checkLaunch() {
    if (form.mode === "schedule" && !form.engines.length)
      throw new Error(
        "Select an AI engine to schedule monitoring. Website crawls run once.",
      );
    if (!form.engines.length && !form.crawl)
      throw new Error("Select at least one AI engine or website crawl.");
    if (form.engines.length && !form.prompts.some((p) => p.active))
      throw new Error(
        "Add an active monitoring prompt before using an AI engine.",
      );
    if (
      form.engines.some(
        (id) => !connections?.engines.find((e) => e.engine === id)?.configured,
      )
    )
      throw new Error(
        "Selected engines are not configured. Ask your administrator to enable monitoring and configure their provider API keys, or deselect them. You can save the project without running.",
      );
    if (form.crawl && !connections?.firecrawl.configured)
      throw new Error(
        "Firecrawl is not configured. Turn off crawling to continue.",
      );
  }
  async function create() {
    await perform(async () => {
      if (!user) return;
      validateStep();
      if (form.mode !== "save") checkLaunch();
      const payload = {
        domain: form.domain,
        brandName: form.brandName,
        description: form.description,
        aliases: form.aliases,
        markets: form.markets,
        competitors: form.competitors.map(
          ({ name, domain, aliases, rationale }) => ({
            name,
            domain,
            aliases,
            rationale,
          }),
        ),
        prompts: form.prompts.map((p) => ({ text: p.body, persona: "" })),
        region: "us",
      };
      const result = await api.request<{ projectId: string; tenantId: string }>(
        "/v1/project-management",
        {
          method: "POST",
          body: payload,
          headers: {
            "Idempotency-Key": projectRequestKey(user.id, "create", payload),
          },
        },
      );
      setSavedProject(result.projectId);
      selectProject(user.id, result.projectId);
      if (form.mode !== "save") {
        const body = launchBody();
        await api.request(endpoint(result.projectId) + "/launch", {
          method: "POST",
          body,
          headers: {
            "Idempotency-Key": projectRequestKey(
              user.id,
              `launch:${result.projectId}`,
              body,
            ),
          },
        });
        clearProjectRequest(user.id, `launch:${result.projectId}`);
      }
      await api
        .request("/v1/onboarding/draft", { method: "DELETE" })
        .catch(() => undefined);
      router.push(
        `/projects/${result.projectId}/${form.mode === "save" ? "settings" : "progress"}`,
      );
    });
  }
  async function saveSettings() {
    await perform(async () => {
      if (!projectId) return;
      validateStep();
      const value = await api.request<Detail>(endpoint(projectId), {
        method: "PATCH",
        body: {
          brandName: form.brandName,
          description: form.description,
          aliases: form.aliases,
          markets: form.markets,
          competitors: form.competitors,
          prompts: form.prompts,
        },
      });
      setDetail(value);
      setForm((old) => ({
        ...old,
        competitors: value.competitors.map((c) => ({
          ...c,
          rationale: c.rationale ?? "",
        })),
        prompts: value.prompts,
      }));
      setNotice(
        "Settings saved. Existing run history is unchanged. Relaunch to apply markets and prompts to a replacement schedule.",
      );
    });
  }
  async function launch() {
    await perform(async () => {
      if (!projectId || !user) return;
      checkLaunch();
      if (view === "settings") {
        validateStep();
        const value = await api.request<Detail>(endpoint(projectId), {
          method: "PATCH",
          body: {
            brandName: form.brandName,
            description: form.description,
            aliases: form.aliases,
            markets: form.markets,
            competitors: form.competitors,
            prompts: form.prompts,
          },
        });
        setForm((old) => ({
          ...old,
          competitors: value.competitors.map((c) => ({
            ...c,
            rationale: c.rationale ?? "",
          })),
          prompts: value.prompts,
        }));
      }
      const body = launchBody();
      await api.request(endpoint(projectId) + "/launch", {
        method: "POST",
        body,
        headers: {
          "Idempotency-Key": projectRequestKey(
            user.id,
            `launch:${projectId}`,
            body,
          ),
        },
      });
      clearProjectRequest(user.id, `launch:${projectId}`);
      router.push(`/projects/${projectId}/progress`);
      await loadDetail();
      setNotice("Launch accepted. Progress updates automatically.");
    });
  }
  async function changeStatus(status: string) {
    await perform(async () => {
      if (!projectId) return;
      await api.request(endpoint(projectId) + "/status", {
        method: "PATCH",
        body: { status },
      });
      await loadDetail();
      setArchiveConfirm(false);
      setNotice(
        status === "active"
          ? "Project active. Monitoring schedules remain paused until you launch again."
          : `Project ${status}. Future scheduled monitoring is paused; in-flight work may finish.`,
      );
    });
  }
  async function analyze() {
    await perform(async () => {
      if (!form.domain.trim()) throw new Error("Enter a domain first.");
      const result = await api.request<{
        domain: string;
        brandProfile: {
          brandName: string;
          description: string;
          aliases: string[];
        };
        source: string;
        isEstimated: boolean;
      }>("/v1/onboarding/analyze-domain", {
        method: "POST",
        body: { domain: form.domain, brandName: form.brandName || undefined },
      });
      update({
        domain: result.domain,
        brandName: form.brandName || result.brandProfile.brandName,
        description: form.description || result.brandProfile.description,
        aliases: form.aliases.length
          ? form.aliases
          : result.brandProfile.aliases,
      });
      setNotice(
        `Suggestions from ${result.source.replaceAll("_", " ")}${result.isEstimated ? " (estimated)" : ""}. Review the brand details before saving.`,
      );
    });
  }
  const combinations =
    form.prompts.filter((p) => p.active).length *
    form.engines.length *
    form.markets.length *
    form.samples;
  const monthly =
    combinations * (form.cadence === "weekly" ? Math.ceil(30 / 7) : 30);
  const visit = (path: string, id = selected) => {
    if (user && id) selectProject(user.id, id);
    return `${path}${id ? `?project=${id}` : ""}`;
  };
  const projectLink = (path: string, id = projectId ?? selected) =>
    `${path}${id ? `?project=${id}` : ""}`;
  const brandFields = (
    <div className={styles.fields}>
      <label>
        Website
        <input
          required
          value={form.domain}
          disabled={view === "settings"}
          placeholder="https://yourbrand.com"
          onChange={(e) => update({ domain: e.target.value })}
        />
      </label>
      {view === "new" && (
        <button
          type="button"
          className={styles.secondary}
          disabled={busy || !form.domain}
          onClick={() => void analyze()}
        >
          <Globe size={16} />
          Suggest details from website
        </button>
      )}
      <label>
        Brand name
        <input
          required
          maxLength={150}
          value={form.brandName}
          onChange={(e) => update({ brandName: e.target.value })}
          placeholder="Your brand"
        />
      </label>
      <label>
        Description
        <textarea
          rows={3}
          maxLength={1000}
          value={form.description}
          onChange={(e) => update({ description: e.target.value })}
        />
      </label>
      <label>
        Brand aliases <small>Separate with commas</small>
        <input
          key={form.aliases.join(",")}
          defaultValue={form.aliases.join(", ")}
          onBlur={(e) =>
            update({
              aliases: e.target.value
                .split(",")
                .map((v) => v.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
      {view === "settings" && (
        <p className={styles.muted}>
          The domain identifies this project. Create a new project to analyze
          another website.
        </p>
      )}
    </div>
  );
  const marketFields = (
    <>
      <h3>Target markets</h3>
      <p className={styles.muted}>
        AI prompts use these locations as simulated context, not physical search
        locations.
      </p>
      {form.markets.map((market, index) => (
        <div className={styles.row} key={index}>
          <label>
            Country code
            <input
              maxLength={2}
              value={market.country}
              onChange={(e) =>
                update({
                  markets: form.markets.map((m, i) =>
                    i === index
                      ? { ...m, country: e.target.value.toUpperCase() }
                      : m,
                  ),
                })
              }
            />
          </label>
          <label>
            Language code
            <input
              maxLength={10}
              value={market.language}
              onChange={(e) =>
                update({
                  markets: form.markets.map((m, i) =>
                    i === index ? { ...m, language: e.target.value } : m,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Remove market ${index + 1}`}
            disabled={form.markets.length === 1}
            onClick={() =>
              update({ markets: form.markets.filter((_, i) => i !== index) })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.textButton}
        disabled={form.markets.length >= 10}
        onClick={() =>
          update({
            markets: [...form.markets, { country: "", language: "en" }],
          })
        }
      >
        <Plus size={15} />
        Add market
      </button>
      <h3>
        Competitors <span className={styles.muted}>(optional)</span>
      </h3>
      {form.competitors.length === 0 && (
        <p className={styles.muted}>
          Add brands you want to compare. You can do this later.
        </p>
      )}
      {form.competitors.map((comp, index) => (
        <div className={styles.row} key={comp.id ?? index}>
          <label>
            Name
            <input
              value={comp.name}
              onChange={(e) =>
                update({
                  competitors: form.competitors.map((c, i) =>
                    i === index ? { ...c, name: e.target.value } : c,
                  ),
                })
              }
            />
          </label>
          <label>
            Domain
            <input
              value={comp.domain}
              placeholder="competitor.com"
              onChange={(e) =>
                update({
                  competitors: form.competitors.map((c, i) =>
                    i === index ? { ...c, domain: e.target.value } : c,
                  ),
                })
              }
            />
          </label>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Remove competitor ${index + 1}`}
            onClick={() =>
              update({
                competitors: form.competitors.filter((_, i) => i !== index),
              })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.textButton}
        disabled={form.competitors.length >= 25}
        onClick={() =>
          update({
            competitors: [
              ...form.competitors,
              { name: "", domain: "", aliases: [], rationale: "" },
            ],
          })
        }
      >
        <Plus size={15} />
        Add competitor
      </button>
    </>
  );
  const promptFields = (
    <>
      <p className={styles.muted}>
        These questions will be sent to your selected AI engines. Suggestions
        are editable templates, not measured search demand.
      </p>
      <button
        type="button"
        className={styles.secondary}
        disabled={form.prompts.length > 97}
        onClick={() =>
          update({
            prompts: [
              ...form.prompts,
              ...[
                `What products or services does ${form.brandName || "this brand"} at ${form.domain || "this website"} offer?`,
                `What are the strengths and limitations of ${form.brandName || "this brand"}? Cite sources when available.`,
                `Which alternatives are comparable to ${form.brandName || "this brand"}? Explain the differences.`,
              ]
                .filter((body) => !form.prompts.some((p) => p.body === body))
                .map((body) => ({ body, active: true })),
            ],
          })
        }
      >
        <Plus size={16} />
        Add three suggested prompts
      </button>
      {form.prompts.map((prompt, index) => (
        <div className={styles.promptRow} key={prompt.id ?? index}>
          <label>
            Prompt {index + 1}
            <textarea
              rows={2}
              maxLength={500}
              value={prompt.body}
              onChange={(e) =>
                update({
                  prompts: form.prompts.map((p, i) =>
                    i === index ? { ...p, body: e.target.value } : p,
                  ),
                })
              }
            />
          </label>
          {view === "settings" && (
            <label className={styles.check}>
              <input
                type="checkbox"
                checked={prompt.active}
                onChange={(e) =>
                  update({
                    prompts: form.prompts.map((p, i) =>
                      i === index ? { ...p, active: e.target.checked } : p,
                    ),
                  })
                }
              />
              Active
            </label>
          )}
          <button
            type="button"
            className={styles.iconButton}
            aria-label={`Remove prompt ${index + 1}`}
            onClick={() =>
              update({ prompts: form.prompts.filter((_, i) => i !== index) })
            }
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className={styles.textButton}
        disabled={form.prompts.length >= 100}
        onClick={() =>
          update({ prompts: [...form.prompts, { body: "", active: true }] })
        }
      >
        <Plus size={15} />
        Add custom prompt
      </button>
    </>
  );
  const engineFields = (
    <>
      <p>
        Choose engines for your project. You can save your selections now;
        engines must be configured before running or scheduling monitoring.
      </p>
      <div className={styles.engineGrid}>
        {connections?.engines.map((engine) => (
          <label className={styles.engine} key={engine.engine}>
            <input
              type="checkbox"
              checked={form.engines.includes(engine.engine)}
              onChange={(e) =>
                update({
                  engines: e.target.checked
                    ? [...form.engines, engine.engine]
                    : form.engines.filter((id) => id !== engine.engine),
                })
              }
            />
            <span>
              <strong>{engine.name}</strong>
              <small>
                {engine.configured
                  ? "Configured, not tested"
                  : "Setup required before running · ask your administrator"}
              </small>
              <small>{engine.model}</small>
              {engine.requiresGrounding && (
                <small>
                  Uses web-search grounding; separate provider quota may apply.
                </small>
              )}
            </span>
          </label>
        ))}
      </div>
      <div className={styles.row}>
        <label>
          Frequency
          <select
            value={form.cadence}
            onChange={(e) =>
              update({ cadence: e.target.value as Form["cadence"] })
            }
          >
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </select>
        </label>
        <label>
          Samples per prompt
          <select
            value={form.samples}
            onChange={(e) => update({ samples: Number(e.target.value) })}
          >
            {[1, 2, 3, 4, 5].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <label className={styles.check}>
        <input
          type="checkbox"
          checked={form.crawl}
          disabled={!connections?.firecrawl.configured}
          onChange={(e) => update({ crawl: e.target.checked })}
        />
        Run a website audit with Firecrawl{" "}
        {connections?.firecrawl.configured ? "" : "(not configured)"}
      </label>
      {form.crawl && (
        <label>
          Crawl scope
          <select
            value={form.pagesLimit}
            onChange={(e) => update({ pagesLimit: Number(e.target.value) })}
          >
            <option value={1}>Homepage only · 1 page</option>
            <option value={5}>Up to 5 linked pages</option>
            <option value={10}>Up to 10 linked pages</option>
          </select>
        </label>
      )}
      <div className={styles.callout}>
        <strong>{combinations} monitoring credits per collection</strong>
        <p>
          {monthly} estimated credits per 30 days if scheduled. One credit
          covers one prompt × engine × market × sample. Provider bills and
          Firecrawl credits are separate.
        </p>
        <p>
          The configured call limit is {connections?.dailyCallLimit ?? "—"} per
          engine per day. Larger batches may span days. Retries also consume
          provider calls.
        </p>
      </div>
    </>
  );
  const launchFields = (
    <>
      <div className={styles.choices}>
        {(view === "new"
          ? ["save", "once", "schedule"]
          : ["once", "schedule"]
        ).map((mode) => (
          <label key={mode}>
            <input
              type="radio"
              name="launch-mode"
              value={mode}
              checked={form.mode === mode}
              onChange={() => update({ mode: mode as Form["mode"] })}
            />
            <span>
              <strong>
                {mode === "save"
                  ? "Save without running"
                  : mode === "once"
                    ? "Run initial analysis"
                    : "Schedule monitoring"}
              </strong>
              <small>
                {mode === "save"
                  ? "No external calls. Configure or launch later."
                  : mode === "once"
                    ? "Collect selected AI answers and/or run the selected crawl once."
                    : "Start monitoring now, then repeat at your chosen frequency. The crawl runs once."}
              </small>
            </span>
          </label>
        ))}
      </div>
      {view !== "new" && (
        <p className={styles.muted}>
          Scheduling replaces this project’s existing schedules. Historical runs
          remain available.
        </p>
      )}
    </>
  );
  return (
    <div className={styles.page}>
      <aside className={styles.sidebar}>
        <Link href="/projects" className={styles.logo}>
          savoir<span>.</span>
        </Link>
        <p className={styles.eyebrow}>YOUR WORKSPACE</p>
        <nav>
          <Link
            className={view === "projects" ? styles.active : ""}
            href="/projects"
          >
            <FolderOpen size={17} />
            Projects
          </Link>
          <Link
            className={view === "new" ? styles.active : ""}
            href="/projects/new"
          >
            <Plus size={17} />
            Add project
          </Link>
          <Link
            className={view === "connections" ? styles.active : ""}
            href="/connections"
          >
            <Globe size={17} />
            Connection status
          </Link>
        </nav>
        {projects.length > 0 && (
          <>
            <label className={styles.projectSelect}>
              Current project
              <select
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  if (user) selectProject(user.id, e.target.value);
                  if (view === "settings" || view === "progress")
                    router.push(`/projects/${e.target.value}/${view}`);
                }}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.brandName}
                    {p.status === "archived" ? " (archived)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <nav>
              <Link
                href={projectLink("/dashboard", selected)}
                onClick={() => visit("/dashboard")}
              >
                <Activity size={17} />
                Results overview
              </Link>
              <Link href={projectLink("/technical", selected)}>
                Technical audit
              </Link>
              <Link href={projectLink("/monitoring", selected)}>
                AI monitoring
              </Link>
              <Link href={projectLink("/answers", selected)}>
                Answer Explorer
              </Link>
              {selected && (
                <Link href={`/projects/${selected}/settings`}>
                  <Settings size={17} />
                  Project settings
                </Link>
              )}
            </nav>
          </>
        )}
        <div className={styles.account}>
          {user?.email ?? "Loading account…"}
        </div>
      </aside>
      <main className={styles.main}>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>PROJECT WORKSPACE</p>
            <h1>
              {view === "projects"
                ? "Your projects"
                : view === "new"
                  ? "Add a project"
                  : view === "connections"
                    ? "Connection status"
                    : view === "settings"
                      ? `${detail?.project.brandName ?? "Project"} settings`
                      : `${detail?.project.brandName ?? "Analysis"} progress`}
            </h1>
            <p className={styles.muted}>
              {view === "projects"
                ? "Create, configure, and analyze brands from one place."
                : view === "new"
                  ? "Set up your brand, review the scope, then choose when to collect data."
                  : view === "progress"
                    ? "Live collection status. Completed results stay available even if another step fails."
                    : view === "settings"
                      ? "Manage this project without changing historical observations."
                      : "Configuration and observed results are separate. Keys stay on the server."}
            </p>
          </div>
          {view === "projects" && (
            <Link className={styles.primary} href="/projects/new">
              <Plus size={17} />
              Add project
            </Link>
          )}
          {projectId && (
            <Link
              className={styles.secondary}
              href={`/projects/${projectId}/${view === "settings" ? "progress" : "settings"}`}
            >
              {view === "settings" ? "View progress" : "Project settings"}
            </Link>
          )}
        </header>
        {error && (
          <div role="alert" className={styles.error}>
            {error}
            {savedProject && (
              <p>
                The project was saved.{" "}
                <Link href={`/projects/${savedProject}/progress`}>
                  Open it and retry the analysis
                </Link>
                .
              </p>
            )}
          </div>
        )}
        {notice && (
          <div role="status" className={styles.notice}>
            {notice}
          </div>
        )}
        {loading ? (
          <div className={styles.card}>
            <LoaderCircle size={22} />
            Loading your workspace…
          </div>
        ) : (
          <>
            {view === "projects" && (
              <>
                <div className={styles.toolbar}>
                  <input
                    aria-label="Search projects"
                    placeholder="Search brand or domain…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <span>{projects.length} loaded projects</span>
                </div>
                <div className={styles.projectGrid}>
                  {projects
                    .filter((p) =>
                      `${p.brandName} ${p.domain}`
                        .toLowerCase()
                        .includes(query.toLowerCase()),
                    )
                    .map((p) => (
                      <article className={styles.card} key={p.id}>
                        <div className={styles.cardTop}>
                          <span className={styles.brandIcon}>
                            {p.brandName.charAt(0)}
                          </span>
                          <span className={styles.badge}>{p.status}</span>
                        </div>
                        <h2>{p.brandName}</h2>
                        <p className={styles.muted}>{p.domain}</p>
                        <p className={styles.muted}>
                          Latest AI result:{" "}
                          {summaries[p.id]?.lastRunAt
                            ? new Date(
                                summaries[p.id].lastRunAt!,
                              ).toLocaleString()
                            : "None yet"}
                        </p>
                        <p className={styles.muted}>
                          Website audit:{" "}
                          {summaries[p.id]?.lastAuditStatus ?? "Not started"}
                          {summaries[p.id]?.lastAuditScore != null
                            ? ` · ${summaries[p.id].lastAuditScore}/100`
                            : ""}
                        </p>
                        <div className={styles.cardLinks}>
                          <Link href={`/projects/${p.id}/progress`}>
                            Latest results <ArrowRight size={15} />
                          </Link>
                          <Link href={`/projects/${p.id}/settings`}>
                            Settings
                          </Link>
                        </div>
                      </article>
                    ))}
                </div>
                {!projects.length && (
                  <section className={styles.empty}>
                    <Globe size={40} />
                    <h2>Your first project starts with a website.</h2>
                    <p>
                      Add a domain, review suggested details, and choose an
                      analysis.
                    </p>
                    <Link href="/projects/new" className={styles.primary}>
                      Add your first project
                    </Link>
                  </section>
                )}
                {cursor && (
                  <button
                    disabled={busy}
                    className={styles.secondary}
                    onClick={() =>
                      void perform(async () => {
                        const list = await api.request<{
                          projects: Project[];
                          nextCursor: string | null;
                        }>(`/v1/projects?limit=100&after=${cursor}`);
                        setProjects((p) => [...p, ...list.projects]);
                        setCursor(list.nextCursor);
                      })
                    }
                  >
                    Load more projects
                  </button>
                )}
              </>
            )}
            {view === "new" && (
              <>
                <ol className={styles.steps}>
                  {steps.map((title, index) => (
                    <li
                      key={title}
                      className={
                        step === index
                          ? styles.current
                          : step > index
                            ? styles.done
                            : ""
                      }
                    >
                      <span>
                        {step > index ? <Check size={14} /> : index + 1}
                      </span>
                      {title}
                    </li>
                  ))}
                </ol>
                <section className={styles.card}>
                  <p className={styles.eyebrow}>STEP {step + 1} OF 6</p>
                  <h2>{steps[step]}</h2>
                  {step === 0 && brandFields}
                  {step === 1 && marketFields}
                  {step === 2 && promptFields}
                  {step === 3 && engineFields}
                  {step === 4 && (
                    <>
                      <dl className={styles.review}>
                        <dt>Brand</dt>
                        <dd>{form.brandName}</dd>
                        <dt>Website</dt>
                        <dd>{form.domain}</dd>
                        <dt>Markets</dt>
                        <dd>
                          {form.markets
                            .map((m) => `${m.country} / ${m.language}`)
                            .join(", ")}
                        </dd>
                        <dt>Competitors</dt>
                        <dd>
                          {form.competitors.map((c) => c.name).join(", ") ||
                            "None selected"}
                        </dd>
                        <dt>Prompts</dt>
                        <dd>{form.prompts.length}</dd>
                        <dt>Engines</dt>
                        <dd>
                          {form.engines
                            .map(
                              (id) =>
                                connections?.engines.find(
                                  (e) => e.engine === id,
                                )?.name ?? id,
                            )
                            .join(", ") || "None selected"}
                        </dd>
                        <dt>Website audit</dt>
                        <dd>
                          {form.crawl
                            ? `Up to ${form.pagesLimit} page(s)`
                            : "Not selected"}
                        </dd>
                        <dt>Monitoring credits</dt>
                        <dd>
                          {combinations} per collection · {monthly} per 30 days
                          if scheduled
                        </dd>
                      </dl>
                      <p className={styles.muted}>
                        Review the scope before launching. A configured provider
                        can still reject requests because of quota, billing, or
                        model access.
                      </p>
                    </>
                  )}
                  {step === 5 && launchFields}
                  <footer className={styles.footer}>
                    <button
                      className={styles.secondary}
                      disabled={busy || step === 0}
                      onClick={() => setStep((s) => s - 1)}
                    >
                      <ArrowLeft size={16} />
                      Back
                    </button>
                    <button
                      className={styles.textButton}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await saveDraft();
                          setNotice(
                            "Draft saved. You can return to Add project later.",
                          );
                        })
                      }
                    >
                      Save draft
                    </button>
                    {step < 5 ? (
                      <button
                        className={styles.primary}
                        disabled={busy}
                        onClick={() => void next()}
                      >
                        {busy ? "Saving…" : "Continue"}
                        <ArrowRight size={16} />
                      </button>
                    ) : (
                      <button
                        className={styles.primary}
                        disabled={busy}
                        onClick={() => void create()}
                      >
                        {busy
                          ? "Saving project…"
                          : form.mode === "save"
                            ? "Save project"
                            : "Save and launch"}
                      </button>
                    )}
                  </footer>
                </section>
              </>
            )}
            {view === "settings" && detail && loadedId === projectId && (
              <div className={styles.stack}>
                <section className={styles.card}>
                  <h2>Brand details</h2>
                  {brandFields}
                  <h2>Competitors & markets</h2>
                  {marketFields}
                  <h2>Monitoring prompts</h2>
                  {promptFields}
                  <div className={styles.footer}>
                    <button
                      className={styles.primary}
                      disabled={busy}
                      onClick={() => void saveSettings()}
                    >
                      {busy ? "Saving…" : "Save settings"}
                    </button>
                  </div>
                </section>
                <section className={styles.card}>
                  <h2>Launch analysis</h2>
                  <p className={styles.muted}>
                    Launching also saves the settings above before starting.
                    Provider calls may incur charges.
                  </p>
                  {engineFields}
                  {launchFields}
                  <button
                    className={styles.primary}
                    disabled={busy || detail.project.status !== "active"}
                    onClick={() => void launch()}
                  >
                    Launch selected analysis
                  </button>
                </section>
                <section className={styles.card}>
                  <h2>Project lifecycle</h2>
                  <p>
                    Status: <strong>{detail.project.status}</strong>. Pausing
                    stops future scheduled collections. Restoring does not
                    automatically resume schedules.
                  </p>
                  <div className={styles.row}>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() =>
                        void changeStatus(
                          detail.project.status === "active"
                            ? "paused"
                            : "active",
                        )
                      }
                    >
                      {detail.project.status === "active"
                        ? "Pause project"
                        : "Restore / resume project"}
                    </button>
                    <button
                      className={styles.danger}
                      disabled={busy || detail.project.status === "archived"}
                      onClick={() => setArchiveConfirm(true)}
                    >
                      Archive project
                    </button>
                  </div>
                  {archiveConfirm && (
                    <div className={styles.callout}>
                      <p>
                        Archive {detail.project.brandName}? Results remain
                        available and schedules will be paused.
                      </p>
                      <button
                        className={styles.danger}
                        disabled={busy}
                        onClick={() => void changeStatus("archived")}
                      >
                        Confirm archive
                      </button>
                      <button
                        className={styles.textButton}
                        onClick={() => setArchiveConfirm(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </section>
              </div>
            )}
            {view === "progress" && detail && (
              <div className={styles.stack}>
                <div className={styles.progressGrid}>
                  <section className={styles.card}>
                    <Globe size={23} />
                    <h2>Website crawl</h2>
                    <strong>{detail.audit?.status ?? "Not started"}</strong>
                    <p>
                      {detail.audit
                        ? `${detail.audit.pages_crawled} of up to ${detail.audit.pages_limit} pages collected`
                        : "Run a website audit from Project settings."}
                    </p>
                    {detail.audit?.error_message && (
                      <p className={styles.error}>
                        {detail.audit.error_message}
                      </p>
                    )}
                    {detail.launch?.auditError && (
                      <p className={styles.error}>{detail.launch.auditError}</p>
                    )}
                    {detail.audit?.status === "completed" && (
                      <Link href={projectLink("/technical")}>
                        Open technical audit →
                      </Link>
                    )}
                  </section>
                  <section className={styles.card}>
                    <Activity size={23} />
                    <h2>AI monitoring</h2>
                    <strong>
                      {detail.counts.pending} pending ·{" "}
                      {detail.counts.succeeded} succeeded
                    </strong>
                    <p>
                      {detail.counts.failed} failed or uncertain.{" "}
                      {
                        detail.schedules.filter((s) => s.status === "active")
                          .length
                      }{" "}
                      active schedules.
                    </p>
                    <Link href={projectLink("/monitoring")}>
                      Open monitoring →
                    </Link>
                  </section>
                  <section className={styles.card}>
                    <Check size={23} />
                    <h2>Answer processing</h2>
                    <strong>{detail.answers} parsed answers</strong>
                    <p>
                      {detail.counts.succeeded > detail.answers
                        ? "Some completed responses are still being processed."
                        : "Answer details appear after successful collection and parsing."}
                    </p>
                    <Link href={projectLink("/answers")}>
                      Open Answer Explorer →
                    </Link>
                  </section>
                </div>
                <section className={styles.card}>
                  <div className={styles.cardTop}>
                    <h2>Recent AI runs</h2>
                    <button
                      className={styles.secondary}
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          await loadDetail();
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Refresh
                    </button>
                  </div>
                  {!detail.runs.length ? (
                    <p className={styles.muted}>
                      No AI runs yet. Saving a project does not make provider
                      calls.
                    </p>
                  ) : (
                    <div className={styles.tableWrap}>
                      <table>
                        <thead>
                          <tr>
                            <th>Prompt / engine</th>
                            <th>Status</th>
                            <th>Observed result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.runs.map((run) => (
                            <tr key={run.id}>
                              <td>
                                {run.request.prompt}
                                <small>
                                  {run.request.engine} · {run.request.model} ·{" "}
                                  {showDate(run.created_at)}
                                </small>
                              </td>
                              <td>
                                <span className={styles.badge}>
                                  {runStage(run)}
                                </span>
                                {run.status === "queued" &&
                                  run.attempts > 0 && (
                                    <>
                                      <small>
                                        Next retry: {showDate(run.available_at)}
                                      </small>
                                      <small>
                                        This automatic retry may make a new
                                        provider request and incur provider
                                        charges.
                                      </small>
                                    </>
                                  )}
                              </td>
                              <td>
                                {run.error_code
                                  ? <ProviderError code={run.error_code} engine={run.request.engine} />
                                  : run.status === "succeeded"
                                    ? run.answer_processed
                                      ? "Answer collected"
                                      : "Provider response received; answer processing is pending."
                                    : run.status === "refused"
                                      ? "The provider returned a refusal."
                                    : run.status === "queued"
                                      ? run.attempts > 0
                                        ? "Automatic retry is scheduled; no request is currently running."
                                        : "Waiting for a worker or provider availability."
                                      : run.status === "processing"
                                        ? "A provider request is in progress."
                                        : run.status === "uncertain"
                                          ? "The provider outcome could not be confirmed; no automatic paid retry was made."
                                          : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className={styles.muted}>
                    Pending runs require the monitoring worker. Provider
                    failures are shown as failures, never replaced with sample
                    answers.
                  </p>
                </section>
                <section className={styles.card}>
                  <h2>Run again or retry</h2>
                  <p className={styles.muted}>
                    A retry is a new collection and may incur provider charges.
                    Resolve quota or model errors first.
                  </p>
                  {engineFields}
                  {launchFields}
                  <button
                    className={styles.primary}
                    disabled={busy || detail.project.status !== "active"}
                    onClick={() => void launch()}
                  >
                    Start new collection
                  </button>
                </section>
              </div>
            )}
            {view === "connections" && connections && (
              <>
                <div className={styles.callout}>
                  {connections.note}
                  <p>
                    Monitoring platform credits and external provider charges
                    are separate. A connection test uses no platform credits,
                    but may consume provider quota or incur provider charges.
                  </p>
                  {selected ? (
                    <p>
                      Observations below are limited to the selected project:{" "}
                      {projects.find((item) => item.id === selected)?.brandName}
                    </p>
                  ) : (
                    <p>Select a project to view its observed engine status.</p>
                  )}
                </div>
                <div className={styles.projectGrid}>
                  <section className={styles.card}>
                    <Globe size={24} />
                    <h2>Firecrawl</h2>
                    <span className={styles.badge}>
                      {connections.firecrawl.configured
                        ? "Configured"
                        : "Not configured"}
                    </span>
                    <p>
                      Website extraction and technical audits. Check a project’s
                      latest crawl for an observed success or failure.
                    </p>
                  </section>
                  {connections.engines.map((configuredEngine) => {
                    const observation =
                      engineObservations.find(
                        (item) => item.engine === configuredEngine.engine,
                      );
                    const engine = observation
                      ? { ...configuredEngine, ...observation }
                      : configuredEngine;
                    return (
                    <section className={styles.card} key={engine.engine}>
                      <Activity size={24} />
                      <h2>{engine.name}</h2>
                      <span className={styles.badge}>
                        {engineStatusLabel(
                          engine.configured,
                          engine.observationStatus,
                        )}
                      </span>
                      <p>Model: {engine.observedModel ?? engine.model}</p>
                      {engine.observedAt && (
                        <p>Observed: {showDate(engine.observedAt)}</p>
                      )}
                      <p>
                        {engine.engine === "openrouter"
                          ? "Free OpenRouter model answers without live web search. URLs in generated text are not proof of retrieval."
                          : engine.engine === "google_ai_mode"
                          ? "Google AI Mode is not available through the configured Serper provider."
                          : engine.requiresGrounding
                            ? "Monitoring requests Search grounding through this provider path."
                            : "Uses its configured provider path; availability depends on that provider."}
                      </p>
                      {engine.observedStatus === "refused" && (
                        <p>The provider returned a refusal.</p>
                      )}
                      {engine.errorCode && (
                        <ProviderError
                          code={engine.errorCode}
                          engine={engine.engine}
                        />
                      )}
                      <button
                        type="button"
                        className={styles.secondary}
                        disabled={!selected || !engine.configured || testPending}
                        onClick={() => {
                          setTestEngine(engine);
                          setTestResult(null);
                          setError("");
                        }}
                      >
                        Test connection
                      </button>
                    </section>
                    );
                  })}
                </div>
                <p className={styles.muted}>
                  This page never makes provider requests automatically. Test
                  requests are separate from customer monitoring history.
                </p>
                {testResult && testResult.projectId === selected && (
                  <section className={styles.card} aria-live="polite">
                    <h2>Connection test result</h2>
                    <p>
                      {testResult.generationStatus === "refused"
                        ? "The provider returned a refusal; no answer was generated."
                        : testResult.status === "succeeded"
                        ? "Generation succeeded."
                        : testResult.status === "uncertain"
                          ? "The result is uncertain; the provider may have processed the request."
                          : "Generation failed."}
                    </p>
                    <p>
                      Search grounding evidence:{" "}
                      {testResult.generationStatus === "refused"
                        ? "not assessed because no answer was generated"
                        : testResult.groundingObserved
                        ? `found (${testResult.citationsCount} provider source${testResult.citationsCount === 1 ? "" : "s"})`
                        : testResult.generationStatus
                          ? "no grounding sources returned"
                          : "not confirmed"}
                    </p>
                    <p>
                      Model: {testResult.modelVersion ?? testResult.model} ·
                      Latency: {testResult.latencyMs === null ? "not confirmed" : `${testResult.latencyMs} ms`} · Tested:{" "}
                      {showDate(testResult.testedAt)}
                    </p>
                    {testResult.generationStatus === "refused" && (
                      <p>The provider returned a refusal, not a generated answer.</p>
                    )}
                    {testResult.errorCode && (
                      <ProviderError
                        code={testResult.errorCode}
                        engine={testResult.engine}
                      />
                    )}
                    <p className={styles.muted}>
                      No platform credits were used. External provider charges
                      may apply.
                    </p>
                  </section>
                )}
                {testEngine && (
                  <dialog
                    ref={testDialogRef}
                    className={styles.testDialog}
                    aria-labelledby="test-title"
                    onCancel={(event) => {
                      if (testPending) event.preventDefault();
                    }}
                    onClose={() => setTestEngine(null)}
                  >
                    <section className={styles.card}>
                      <h2 id="test-title">Test provider connection?</h2>
                      {error && (
                        <p className={styles.error} role="alert">
                          {error}
                        </p>
                      )}
                      <p>
                        Engine: {testEngine.name} · Model: {testEngine.model}
                      </p>
                      <p>
                        Search grounding:{" "}
                        {testEngine.requiresGrounding
                          ? "requested"
                          : testEngine.engine.startsWith("google_ai_")
                            ? "source evidence depends on the configured SERP provider"
                            : "not requested"}
                      </p>
                      <p>
                        This minimal test may consume provider quota or incur
                        provider charges. It does not use Savoir platform
                        credits and will not be added to monitoring results.
                      </p>
                      <div className={styles.row}>
                        <button
                          type="button"
                          className={styles.secondary}
                          disabled={testPending}
                          onClick={() => setTestEngine(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className={styles.primary}
                          disabled={testPending}
                          onClick={() => void runConnectionTest(testEngine.engine)}
                        >
                          {testPending ? "Testing…" : "Confirm test"}
                        </button>
                      </div>
                    </section>
                  </dialog>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
