"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Activity,
  ArrowRight,
  Clock3,
  Edit2,
  FileUp,
  Play,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Tag,
  X,
} from "lucide-react";
import { api } from "../lib/api";
import { clearProjectRequest, projectRequestKey } from "../lib/project-selection";
import type { Engine, Project, Prompt } from "../lib/types";

type Summary = {
  total: number;
  active: number;
  paused: number;
  archived: number;
  answers_30d: number;
  avg_visibility: number | null;
};
type PromptAnswer = {
  id: string;
  engine: string;
  geo: string;
  language: string;
  text: string;
  created_at: string;
  sources: { url: string; domain: string; sourceType: string }[];
};
type PromptVersion = { version: number; body: string; persona: string; created_at: string };
type Suggestion = { body: string; persona: string; tags: string[] };

function engineLabel(engine: string) {
  const labels: Record<string, string> = {
    openrouter: "OpenRouter",
    gemini: "Gemini",
    openai: "ChatGPT",
    google_ai_overviews: "AI Overviews",
    google_ai_mode: "AI Mode",
  };
  return labels[engine] ?? engine;
}

function endpoint(project: Project) {
  return `/v1/tenants/${project.tenantId}/projects/${project.id}/monitoring`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function parseCsv(text: string): Suggestion[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(field.trim());
      field = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (!rows.length) return [];

  const header = rows[0].map((cell) => cell.toLowerCase());
  const bodyIndex = header.findIndex((cell) => ["question", "prompt", "body", "text"].includes(cell));
  const hasHeader = bodyIndex >= 0;
  const columns = hasHeader
    ? {
        body: bodyIndex,
        persona: header.findIndex((cell) => ["persona", "context"].includes(cell)),
        tags: header.findIndex((cell) => cell === "tags"),
      }
    : { body: 0, persona: -1, tags: -1 };
  return rows
    .slice(hasHeader ? 1 : 0)
    .filter((cells) => cells[columns.body]?.trim())
    .map((cells) => ({
      body: cells[columns.body]!.trim(),
      persona: columns.persona >= 0 ? cells[columns.persona]?.trim() ?? "" : "",
      tags: columns.tags >= 0
        ? (cells[columns.tags] ?? "").split(/[|;]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 10)
        : [],
    }));
}

export function PromptLibrary({
  project,
  engines,
  prompts,
  busy,
  addPromptOpen,
  hasMore,
  refreshing,
  loading,
  loadError,
  showArchived,
  onShowArchived,
  onLoadMore,
  onRefresh,
  onCreate,
  onToggle,
  onToggleAddPrompt,
  onError,
}: {
  project: Project;
  engines: Engine[];
  prompts: Prompt[];
  busy: boolean;
  addPromptOpen: boolean;
  hasMore: boolean;
  refreshing: boolean;
  loading: boolean;
  loadError: boolean;
  showArchived: boolean;
  onShowArchived: (value: boolean) => void;
  onLoadMore: () => void;
  onRefresh: () => void;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onToggle: (prompt: Prompt) => void;
  onToggleAddPrompt: () => void;
  onError: (value: string) => void;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [engineFilter, setEngineFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [working, setWorking] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<Prompt | null>(null);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [detailTab, setDetailTab] = useState<"answers" | "sources" | "versions">("answers");
  const [answers, setAnswers] = useState<PromptAnswer[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [loadedDetailKey, setLoadedDetailKey] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const base = endpoint(project);
  const defaultEngine = engines.find((engine) => engine.configured)?.engine ?? "gemini";
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return prompts
      .filter((prompt) => `${prompt.body} ${prompt.persona} ${(prompt.tags ?? []).join(" ")}`.toLowerCase().includes(query))
      .filter((prompt) => tagFilter === "all" || (prompt.tags ?? []).includes(tagFilter))
      .filter((prompt) => engineFilter === "all" || (prompt.engines ?? []).includes(engineFilter))
      .filter((prompt) => statusFilter === "all"
        || (statusFilter === "active" && prompt.active && !prompt.archived_at)
        || (statusFilter === "paused" && !prompt.active && !prompt.archived_at)
        || (statusFilter === "archived" && Boolean(prompt.archived_at)))
      .sort((a, b) => sort === "az" ? a.body.localeCompare(b.body)
        : sort === "za" ? b.body.localeCompare(a.body)
        : sort === "oldest" ? (a.created_at ?? "").localeCompare(b.created_at ?? "")
        : (b.created_at ?? "").localeCompare(a.created_at ?? ""));
  }, [prompts, search, sort, statusFilter, tagFilter, engineFilter]);
  const selectedPrompt = detail && filtered.some((prompt) => prompt.id === detail.id)
    ? filtered.find((prompt) => prompt.id === detail.id) ?? null
    : filtered[0] ?? null;
  const detailId = selectedPrompt?.id;
  const detailResource = detailTab === "versions" ? "versions" : "answers";
  const detailRequestKey = detailId
    ? `${project.id}:${detailId}:${detailResource}`
    : "";
  const detailLoading = Boolean(selectedPrompt && loadedDetailKey !== detailRequestKey);

  useEffect(() => {
    let disposed = false;
    api.request<Summary>(base + "/prompts/summary").then((result) => {
        if (!disposed) setSummary(result);
    }).catch((error: unknown) => {
        if (!disposed) onError(errorText(error));
    });
    return () => { disposed = true; };
  }, [base, prompts, onError]);

  useEffect(() => {
    if (!detailId) return;
    let disposed = false;
    api.request<PromptVersion[] | PromptAnswer[]>(`${base}/prompts/${detailId}/${detailResource}`)
        .then((result) => {
          if (disposed) return;
          if (detailResource === "versions") setVersions(result as PromptVersion[]);
          else setAnswers(result as PromptAnswer[]);
        })
        .catch((error: unknown) => {
          if (!disposed) onError(errorText(error));
        })
        .finally(() => {
          if (!disposed) setLoadedDetailKey(detailRequestKey);
        });
    return () => { disposed = true; };
  }, [base, detailId, detailResource, detailRequestKey, onError]);
  const availableTags = useMemo(
    () => [...new Set(prompts.flatMap((prompt) => prompt.tags ?? []))].sort((a, b) => a.localeCompare(b)),
    [prompts],
  );
  const availableEngines = useMemo(
    () => [...new Set(prompts.flatMap((prompt) => prompt.engines ?? []))].sort((a, b) => a.localeCompare(b)),
    [prompts],
  );
  const allVisibleSelected = filtered.length > 0 && filtered.every((prompt) => selectedIds.includes(prompt.id));
  const flatSources = answers.flatMap((answer) => answer.sources.map((source) => ({
    ...source,
    answerId: answer.id,
    engine: answer.engine,
  })));

  async function addSuggestions() {
    setWorking(true);
    onError("");
    try {
      const result = await api.request<{ billable: false; suggestions: Suggestion[] }>(base + "/prompts/suggestions");
      setSuggestions(result.suggestions);
      setSuggestionsOpen(true);
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
    }
  }

  async function addSuggestion(suggestion: Suggestion) {
    setWorking(true);
    onError("");
    const operation = `prompt-suggestion:${suggestion.body}`;
    try {
      await api.request(base + "/prompts", {
        method: "POST",
        body: suggestion,
        headers: {
          "Idempotency-Key": projectRequestKey(project.id, operation, suggestion),
        },
      });
      clearProjectRequest(project.id, operation);
      setSuggestions((items) => items.filter((item) => item.body !== suggestion.body));
      setNotice("Suggested prompt added.");
      onRefresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
    }
  }

  async function importCsv(file: File | undefined) {
    if (!file) return;
    setWorking(true);
    onError("");
    const operation = "prompt-import";
    try {
      const parsed = parseCsv(await file.text());
      if (!parsed.length) throw new Error("The CSV must include a prompt/question column or a first column of questions.");
      if (parsed.length > 100) throw new Error("Import up to 100 prompts per CSV.");
      const payload = { prompts: parsed };
      const result = await api.request<{ created: number; skipped: number }>(base + "/prompts/import", {
        method: "POST",
        body: payload,
        headers: {
          "Idempotency-Key": projectRequestKey(project.id, operation, payload),
        },
      });
      clearProjectRequest(project.id, operation);
      setNotice(`${result.created} prompts imported; ${result.skipped} duplicates skipped.`);
      onRefresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function bulk(
    action: "pause" | "resume" | "archive" | "restore" | "add-tag",
    promptIds = selectedIds,
  ) {
    if (!promptIds.length) return;
    setWorking(true);
    onError("");
    try {
      await api.request(base + "/prompts/bulk", {
        method: "POST",
        body: { promptIds, action, ...(action === "add-tag" ? { tag: tag.trim() } : {}) },
      });
      setSelectedIds((ids) => ids.filter((id) => !promptIds.includes(id)));
      setTag("");
      setNotice(`${promptIds.length} ${promptIds.length === 1 ? "prompt" : "prompts"} updated.`);
      onRefresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
    }
  }

  async function runNow(prompt: Prompt) {
    setWorking(true);
    onError("");
    try {
      const payload = { engine: defaultEngine, promptIds: [prompt.id], geos: ["US"], languages: ["en"], samples: 1 };
      const operation = `prompt-run:${prompt.id}`;
      await api.request(base + "/runs", {
        method: "POST",
        body: payload,
        headers: { "Idempotency-Key": projectRequestKey(project.id, operation, payload) },
      });
      clearProjectRequest(project.id, operation);
      setNotice("A run was queued for this prompt.");
      onRefresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
    }
  }

  function openDetails(prompt: Prompt) {
    setDetail(prompt);
    setDetailTab("answers");
  }

  async function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const payload = {
      body: String(form.get("body") ?? "").trim(),
      persona: String(form.get("persona") ?? "").trim(),
      tags: String(form.get("tags") ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 10),
    };
    if (!payload.body) {
      onError("Enter a question before saving.");
      return;
    }
    setWorking(true);
    onError("");
    try {
      await api.request(`${base}/prompts/${editing.id}`, { method: "PATCH", body: payload });
      setEditing(null);
      setNotice("Prompt updated. Its previous version remains in history.");
      onRefresh();
    } catch (error) {
      onError(errorText(error));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="prompt-library">
      {notice && <div className="notice" role="status">{notice}</div>}
      <header className="prompt-page-heading">
        <div>
          <p className="eyebrow">PROMPT LIBRARY</p>
          <h1>Track the questions that matter.</h1>
          <p className="subtitle">Build a focused view of how your audience discovers and compares brands.</p>
        </div>
        <div className="prompt-page-actions">
          <button type="button" className="button" onClick={() => fileInput.current?.click()} disabled={working}>
            <FileUp size={15} /> Import CSV
          </button>
          <button type="button" className="button" onClick={addSuggestions} disabled={working}>
            <Sparkles size={15} /> Suggest prompts
          </button>
          <button
            type="button"
            className="button primary"
            disabled={busy}
            aria-expanded={addPromptOpen}
            aria-controls="prompt-create"
            onClick={onToggleAddPrompt}
          >
            {addPromptOpen ? <X size={15} /> : <Plus size={15} />}
            {addPromptOpen ? "Close form" : "Add prompt"}
          </button>
          <button type="button" className="button" onClick={onRefresh} disabled={refreshing} aria-label="Refresh prompt data">
            <RotateCcw size={15} className={refreshing ? "spin" : ""} />
          </button>
          <input
            ref={fileInput}
            className="prompt-file-input"
            type="file"
            accept=".csv,text/csv"
            aria-label="Import prompts from CSV"
            onChange={(event) => void importCsv(event.target.files?.[0])}
          />
        </div>
      </header>
      <section className="prompt-summary-grid" aria-label="Prompt summary">
        <article className="prompt-summary-card"><span>Prompts loaded</span><strong>{summary?.total ?? prompts.length}</strong><small>{project.brandName} · connected</small></article>
        <article className="prompt-summary-card"><span>Active</span><strong>{summary?.active ?? prompts.filter((prompt) => prompt.active && !prompt.archived_at).length}</strong><small>Collecting samples</small></article>
        <article className="prompt-summary-card"><span>Paused</span><strong>{summary?.paused ?? prompts.filter((prompt) => !prompt.active && !prompt.archived_at).length}</strong><small>Resume to collect data</small></article>
        <article className="prompt-summary-card"><span>Avg. visibility</span><strong>{summary?.avg_visibility == null ? "—" : `${summary.avg_visibility.toFixed(1)}%`}</strong><small>{summary?.answers_30d ?? 0} answers collected in the last 30 days</small></article>
      </section>

      {suggestionsOpen && (
        <section className="panel prompt-suggestions">
          <div className="prompt-subhead">
            <div><h3>Local suggestions</h3><p>Generated from your project name and domain. No AI request or usage charge.</p></div>
            <button type="button" className="icon-button" aria-label="Close suggestions" onClick={() => setSuggestionsOpen(false)}><X size={16} /></button>
          </div>
          {suggestions.length ? suggestions.map((suggestion) => (
            <div className="prompt-suggestion" key={suggestion.body}>
              <span>{suggestion.body}</span>
              <button type="button" className="text-button" disabled={working} onClick={() => void addSuggestion(suggestion)}><Plus size={14} /> Add</button>
            </div>
          )) : <p className="table-empty">No new suggestions; your library already covers these topics.</p>}
        </section>
      )}

      <section className="panel prompt-create" id="prompt-create" hidden={!addPromptOpen}>
        <div className="panel-head">
          <div><h2>Add a monitoring prompt</h2><p>Use a natural question. Avoid personal or confidential information.</p></div>
          <span className="pill">No AI call</span>
        </div>
        <form onSubmit={onCreate}>
          <label>
            Question
            <textarea name="body" placeholder="Which brands are recommended for…?" required maxLength={4000} rows={2} />
          </label>
          <div className="prompt-form-grid">
            <label>Persona or context <span className="muted">(optional)</span><input name="persona" placeholder="e.g. a first-time buyer" maxLength={1000} /></label>
            <label>Tags <span className="muted">(comma-separated)</span><input name="tags" placeholder="comparison, buyer research" maxLength={300} /></label>
            <button className="button primary" disabled={busy || working}><Plus size={16} /> Add prompt</button>
          </div>
        </form>
      </section>

      <div className="prompt-workspace-grid">
      <section className="panel prompt-table-panel">
        <div className="prompt-table-heading">
          <div>
            <h2>Your prompts</h2>
            <p>Results per prompt across every engine you track.</p>
          </div>
        </div>
        <div className="prompt-controls">
          <label className="search-field">
            <Search size={16} />
            <input aria-label="Search loaded prompts" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search prompts or tags" />
          </label>
          <label className="prompt-select-label">Status
            <select aria-label="Filter prompts by status" value={statusFilter} onChange={(event) => {
              const status = event.target.value;
              if (status === "archived" && !showArchived) onShowArchived(true);
              setStatusFilter(status);
            }}>
              <option value="all">All statuses</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option>
            </select>
          </label>
          <label className="prompt-select-label">Engine
            <select aria-label="Filter prompts by engine" value={engineFilter} onChange={(event) => setEngineFilter(event.target.value)}>
              <option value="all">All engines</option>
              {availableEngines.map((engine) => <option key={engine} value={engine}>{engineLabel(engine)}</option>)}
            </select>
          </label>
          <label className="prompt-select-label">Sort
            <select aria-label="Sort prompts" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recent">Recently created</option><option value="oldest">Oldest</option><option value="az">A to Z</option><option value="za">Z to A</option>
            </select>
          </label>
          <label className="prompt-archive-toggle"><input aria-label="Include archived" type="checkbox" checked={showArchived} onChange={(event) => onShowArchived(event.target.checked)} /> Include archived</label>
          <Link className="button prompt-schedule-link" href={`/monitoring?project=${encodeURIComponent(project.id)}#schedules`}><Activity size={14} /> Manage schedules</Link>
        </div>
        {availableTags.length > 0 && (
          <div className="prompt-tag-filters" aria-label="Filter prompts by tag">
            <button type="button" className={tagFilter === "all" ? "selected" : ""} aria-pressed={tagFilter === "all"} onClick={() => setTagFilter("all")}>All</button>
            {availableTags.map((item) => (
              <button type="button" className={tagFilter === item ? "selected" : ""} aria-pressed={tagFilter === item} key={item} onClick={() => setTagFilter(tagFilter === item ? "all" : item)}>{item}</button>
            ))}
          </div>
        )}

        {selectedIds.length > 0 && (
          <div className="prompt-bulk-bar">
            <span>{selectedIds.length} selected</span>
            <button type="button" className="text-button" disabled={working} onClick={() => void bulk("pause")}>Pause</button>
            <button type="button" className="text-button" disabled={working} onClick={() => void bulk("resume")}>Resume</button>
            <label className="prompt-tag-control"><input aria-label="Tag to add" value={tag} onChange={(event) => setTag(event.target.value)} placeholder="Add tag" /><button type="button" className="text-button" disabled={working || !tag.trim()} onClick={() => void bulk("add-tag")}><Tag size={14} /> Tag</button></label>
            {showArchived
              ? <button type="button" className="text-button" disabled={working} onClick={() => void bulk("restore")}><RotateCcw size={14} /> Restore</button>
              : <button type="button" className="text-button" disabled={working} onClick={() => void bulk("archive")}>Archive</button>}
          </div>
        )}

        {filtered.length ? (
          <div className="table-wrap">
            <table className="prompt-table">
              <thead><tr>
                <th><input aria-label="Select all visible prompts" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedIds(event.target.checked ? [...new Set([...selectedIds, ...filtered.map((prompt) => prompt.id)])] : selectedIds.filter((id) => !filtered.some((prompt) => prompt.id === id)))} /></th>
                <th>Prompt</th><th>Visibility</th><th>Cited</th><th>Engines</th><th>Status</th><th>Actions</th>
              </tr></thead>
              <tbody>{filtered.map((prompt) => (
                <tr key={prompt.id} className={selectedPrompt?.id === prompt.id ? "selected" : undefined}>
                  <td><input aria-label={`Select prompt ${prompt.body}`} type="checkbox" checked={selectedIds.includes(prompt.id)} onChange={(event) => setSelectedIds((ids) => event.target.checked ? [...ids, prompt.id] : ids.filter((id) => id !== prompt.id))} /></td>
                  <td className="prompt-question-cell">
                    <button type="button" className="prompt-question" onClick={() => openDetails(prompt)}>{prompt.body}</button>
                    {prompt.persona && <small>{prompt.persona}</small>}
                    {prompt.tags?.length ? <div className="prompt-tags">{prompt.tags.map((item) => <span key={item}>{item}</span>)}</div> : null}
                    <small>v{prompt.version} · Updated {prompt.updated_at ? new Date(prompt.updated_at).toLocaleDateString() : "—"}</small>
                  </td>
                  <td className="prompt-visibility-cell">
                    {prompt.visibility == null ? <span>—</span> : <><b>{prompt.visibility.toFixed(1)}%</b><progress max={100} value={prompt.visibility} aria-label={`${prompt.visibility.toFixed(1)}% visibility`} /><small>{prompt.answer_count ?? 0} answers</small></>}
                  </td>
                  <td>{prompt.answer_count ? prompt.cited_count ?? 0 : "—"}</td>
                  <td>
                    {prompt.engines?.length ? <div className="prompt-engine-list">{prompt.engines.map((engine) => <span className="prompt-engine-chip" key={engine} title={engine}>{engineLabel(engine)}</span>)}</div> : "—"}
                  </td>
                  <td><span className={`pill ${prompt.archived_at ? "status-paused" : prompt.active ? "status-active" : ""}`}>{prompt.archived_at ? "Archived" : prompt.active ? "Active" : "Paused"}</span></td>
                  <td className="prompt-row-actions">
                    <button type="button" className="text-button" onClick={() => setEditing(prompt)}><Edit2 size={13} /> Edit</button>
                    <button type="button" className="text-button" disabled={busy || working || Boolean(prompt.archived_at)} onClick={() => onToggle(prompt)}>{prompt.active ? "Pause" : "Resume"}</button>
                    <button type="button" className="text-button" disabled={working || Boolean(prompt.archived_at)} onClick={() => void runNow(prompt)}><Play size={13} /> Run now</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="table-empty">{prompts.length
          ? "No prompts match these filters."
          : loading
            ? "Loading prompts…"
            : loadError
              ? "Prompt data is unavailable. Use Refresh to try again."
              : "No prompts yet. Add a question, import a CSV, or try local suggestions."}</p>}
        <div className="prompt-table-footer">
          <span>{filtered.length} shown · {summary?.total ?? prompts.length} total</span>
          {hasMore && <button className="button" disabled={busy || refreshing} onClick={onLoadMore}>Load more prompts</button>}
        </div>
      </section>

      {selectedPrompt && (
          <aside className="prompt-detail panel" aria-label="Prompt details">
            <div className="prompt-detail-heading">
              <div><p className="eyebrow">PROMPT DETAIL</p><h2 id="prompt-detail-title">{selectedPrompt.body}</h2></div>
            </div>
            <div className="prompt-detail-meta">
              <span className={`pill ${selectedPrompt.archived_at ? "status-paused" : selectedPrompt.active ? "status-active" : ""}`}>{selectedPrompt.archived_at ? "Archived" : selectedPrompt.active ? "Active" : "Paused"}</span>
              <span className="pill">v{selectedPrompt.version}</span>
              {(selectedPrompt.tags ?? []).map((item) => <span className="pill" key={item}>{item}</span>)}
            </div>
            {selectedPrompt.persona && <p className="prompt-detail-persona">{selectedPrompt.persona}</p>}
            <div className="prompt-detail-actions">
              <button type="button" className="text-button" disabled={busy || working || Boolean(selectedPrompt.archived_at)} onClick={() => onToggle(selectedPrompt)}>{selectedPrompt.active ? "Pause" : "Resume"}</button>
              <button type="button" className="text-button" disabled={working} onClick={() => void bulk(selectedPrompt.archived_at ? "restore" : "archive", [selectedPrompt.id])}>{selectedPrompt.archived_at ? <><RotateCcw size={13} /> Restore prompt</> : "Archive prompt"}</button>
              <button type="button" className="text-button" onClick={() => setEditing(selectedPrompt)}><Edit2 size={13} /> Edit</button>
            </div>
            <nav className="prompt-detail-tabs" aria-label="Prompt detail sections">
              <button type="button" aria-current={detailTab === "answers" ? "page" : undefined} onClick={() => setDetailTab("answers")}>Answers</button>
              <button type="button" aria-current={detailTab === "sources" ? "page" : undefined} onClick={() => setDetailTab("sources")}>Sources ({flatSources.length})</button>
              <button type="button" aria-current={detailTab === "versions" ? "page" : undefined} onClick={() => setDetailTab("versions")}>Versions</button>
            </nav>
            {detailLoading ? <p className="table-empty">Loading prompt details…</p> : detailTab === "versions" ? (
              versions.length ? <div className="prompt-version-list">{versions.map((version) => <article key={version.version}><b>Version {version.version}</b><time><Clock3 size={13} /> {new Date(version.created_at).toLocaleString()}</time><p>{version.body}</p>{version.persona && <small>{version.persona}</small>}</article>)}</div> : <p className="table-empty">No version history yet.</p>
            ) : detailTab === "sources" ? (
              flatSources.length ? <div className="prompt-source-list">{flatSources.map((source, index) => <a key={`${source.answerId}-${index}`} href={source.url} target="_blank" rel="noreferrer"><b>{source.domain || source.url}</b><small>{source.engine} · {source.sourceType}</small></a>)}</div> : <p className="table-empty">No sources have been collected for this prompt yet.</p>
            ) : (
              answers.length ? <div className="prompt-answer-list">{answers.map((answer) => <article key={answer.id}><div><b>{answer.engine}</b><time>{new Date(answer.created_at).toLocaleString()}</time></div><p>{answer.text}</p><small>{answer.geo} · {answer.language} · {answer.sources.length} sources</small></article>)}</div> : <p className="table-empty">No answers yet. Run this prompt to collect its first response.</p>
            )}
            <div className="prompt-detail-footer">
              <Link className="text-link" href={`/answers?project=${encodeURIComponent(project.id)}`}><ArrowRight size={14} /> Open Answer Explorer</Link>
              <button type="button" className="button primary" disabled={working || Boolean(selectedPrompt.archived_at)} onClick={() => void runNow(selectedPrompt)}><Play size={14} /> Run now</button>
            </div>
          </aside>
      )}
      </div>
      {editing && (
        <div className="prompt-detail-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
          <section className="prompt-edit panel" role="dialog" aria-modal="true" aria-labelledby="prompt-edit-title">
            <div className="prompt-detail-heading">
              <div><p className="eyebrow">EDIT PROMPT</p><h2 id="prompt-edit-title">Update question and context</h2></div>
              <button type="button" className="icon-button" aria-label="Close prompt editor" onClick={() => setEditing(null)}><X size={17} /></button>
            </div>
            <form onSubmit={saveEdit}>
              <label>Question<textarea name="body" required maxLength={4000} rows={3} defaultValue={editing.body} /></label>
              <label>Persona or context<input name="persona" maxLength={1000} defaultValue={editing.persona} /></label>
              <label>Tags <span className="muted">(comma-separated)</span><input name="tags" maxLength={300} defaultValue={editing.tags?.join(", ") ?? ""} /></label>
              <div className="prompt-detail-footer">
                <button type="button" className="button" disabled={working} onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="button primary" disabled={working}><Edit2 size={14} /> Save changes</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
