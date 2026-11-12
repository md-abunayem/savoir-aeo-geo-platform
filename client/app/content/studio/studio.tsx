"use client";

import Link from "next/link";
import Image from "next/image";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Play,
  Pause,
  RefreshCw,
  Sparkles,
  Upload,
  ShieldCheck,
} from "lucide-react";
import { api, ApiError } from "../../../lib/api";
import { selectedProject, selectProject } from "../../../lib/project-selection";
import {
  canApproveDraft,
  canEditDraft,
  scheduleUtc,
  studioFields,
  updateStudioField,
  type StudioDocument,
  type StudioDraft,
  type StudioSnapshot,
} from "../../../lib/content-studio";
import type { ContentBriefRecord, Project, User } from "../../../lib/types";
import styles from "./studio.module.css";

const channels = ["facebook", "instagram", "x", "short_video", "podcast", "blog"] as const;
const channelLabels = {
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X thread",
  short_video: "Video script",
  podcast: "Podcast",
  blog: "Blog",
};
const empty: StudioSnapshot = {
  drafts: [],
  connections: [],
  media: [],
  deliveries: [],
  publishingEnabled: false,
};
const subscribeToTimezone = () => () => {};
const getLocalTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
const getServerTimezone = () => "your local timezone";

export function ContentStudio() {
  const [user, setUser] = useState<User | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [projectId, setProjectId] = useState("");
  const [snapshot, setSnapshot] = useState<StudioSnapshot>(empty),
    [selectedId, setSelectedId] = useState("");
  const [document, setDocument] = useState<StudioDocument | null>(null);
  const [channel, setChannel] = useState<(typeof channels)[number]>("x"),
    [slide, setSlide] = useState(0),
    [playing, setPlaying] = useState(false);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [topic, setTopic] = useState(""),
    [question, setQuestion] = useState(""),
    [brief, setBrief] = useState(""),
    [intent, setIntent] = useState("educational");
  const [token, setToken] = useState(""),
    [siteUrl, setSiteUrl] = useState(""),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const [scheduleTime, setScheduleTime] = useState(""),
    [targets, setTargets] = useState<string[]>([]),
    [mediaIds, setMediaIds] = useState<string[]>([]),
    [notification, setNotification] = useState(false);
  const [importJson, setImportJson] = useState("");
  const [targetMedia, setTargetMedia] = useState<Record<string, string[]>>({});
  const [savedBriefs, setSavedBriefs] = useState<ContentBriefRecord[]>([]);
  const timezone = useSyncExternalStore(
    subscribeToTimezone,
    getLocalTimezone,
    getServerTimezone,
  );
  const loadedRevision = useRef<{ id: string; revision: number } | null>(null);
  const prompter = useRef<HTMLDivElement>(null);
  const base = `/v1/projects/${projectId}/studio`;
  const draft = snapshot.drafts.find((entry) => entry.id === selectedId);
  const dirty = Boolean(
    draft && document && JSON.stringify(document) !== JSON.stringify(draft.document),
  );
  const editable = Boolean(draft && canEditDraft(draft.status));

  useEffect(() => {
    let current = true;
    void api
      .request<{ user: User }>("/v1/auth/me")
      .then(async ({ user: viewer }) => {
        const result = await api.request<{ projects: Project[] }>("/v1/projects");
        if (!current) return;
        setUser(viewer);
        setProjects(result.projects);
        const saved = selectedProject(viewer.id);
        setProjectId(
          result.projects.some((p) => p.id === saved) ? saved : (result.projects[0]?.id ?? ""),
        );
      })
      .catch((problem) => {
        if (current)
          setError(problem instanceof Error ? problem.message : "Sign in to open the studio.");
      });
    return () => {
      current = false;
    };
  }, []);

  const load = useCallback(
    async (preferredId?: string) => {
      setError("");
      const data = await api.request<StudioSnapshot>(`/v1/projects/${projectId}/studio`);
      setSnapshot(data);
      if (preferredId) setSelectedId(preferredId);
      else
        setSelectedId((id) =>
          data.drafts.some((d) => d.id === id) ? id : (data.drafts[0]?.id ?? ""),
        );
    },
    [projectId],
  );
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void api
      .request<StudioSnapshot>(`/v1/projects/${projectId}/studio`)
      .then((data) => {
        if (active) {
          setError("");
          setSnapshot(data);
          setSelectedId(data.drafts[0]?.id ?? "");
        }
      })
      .catch((problem) => {
        if (active) setError(problem.message);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (
      draft &&
      loadedRevision.current?.id === draft.id &&
      loadedRevision.current.revision === draft.revision
    )
      return;
    loadedRevision.current = draft ? { id: draft.id, revision: draft.revision } : null;
    setDocument(draft ? structuredClone(draft.document) : null);
    setSlide(0);
    setPlaying(false);
  }, [draft]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      if (prompter.current) prompter.current.scrollTop += 1;
    }, 40);
    return () => clearInterval(timer);
  }, [playing]);
  useEffect(() => {
    if (
      !projectId ||
      busy ||
      dirty ||
      !snapshot.deliveries.some((delivery) =>
        ["queued", "dispatching", "accepted", "manual_action"].includes(delivery.state),
      )
    )
      return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .request<StudioSnapshot>(`/v1/projects/${projectId}/studio`)
        .then((data) => {
          if (active) setSnapshot(data);
        })
        .catch(() => {
          if (active)
            setError(
              "Delivery status could not refresh. Your saved schedule is retained; use Refresh status to retry.",
            );
        });
    }, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [projectId, busy, dirty, snapshot.deliveries]);

  function resetProjectState() {
    setError("");
    setSelectedId("");
    setDocument(null);
    setTargets([]);
    setMediaIds([]);
    setTargetMedia({});
    setSavedBriefs([]);
    setSnapshot(empty);
  }
  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (problem) {
      setError(
        problem instanceof ApiError || problem instanceof Error
          ? problem.message
          : "Unable to complete this action.",
      );
    } finally {
      setBusy("");
    }
  }
  async function generate() {
    await run("Generating", async () => {
      const result = await api.request<StudioDraft>(base + "/generate", {
        method: "POST",
        body: { topic, question, intent, brief },
        timeoutMs: 180000,
      });
      await load(result.id);
      setMessage("Draft generated. Review each channel before approval.");
    });
  }
  async function command(action: "review" | "approve") {
    if (!draft) return;
    await run(action === "review" ? "Checking facts" : "Approving", async () => {
      await api.request(`${base}/drafts/${draft.id}/${action}`, {
        method: "POST",
        body: { revision: draft.revision },
        timeoutMs: 180000,
      });
      await load(draft.id);
      setMessage(
        action === "review"
          ? "Fact check complete. Review the report below."
          : "This revision is approved and ready to schedule.",
      );
    });
  }
  async function upload(file: File) {
    await run("Uploading", async () => {
      const prepared = await api.request<{ id: string; uploadUrl: string }>(base + "/media", {
        method: "POST",
        body: { mimeType: file.type, sizeBytes: file.size },
      });
      const result = await fetch(prepared.uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type,
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
      if (!result.ok)
        throw new Error("Media upload failed. Check bucket upload permissions and CORS.");
      await api.request(`${base}/media/${prepared.id}/complete`, { method: "POST" });
      await load(draft?.id);
      setMediaIds((ids) => [...ids, prepared.id]);
      setMessage("Public media is ready. Select it for your publishing targets.");
    });
  }
  const connectedChannels = snapshot.connections.flatMap((connection) => connection.channels);
  const selectedMedia = mediaIds
    .map((id) => snapshot.media.find((m) => m.id === id))
    .filter((m) => m !== undefined);
  const noAction = Boolean(busy) || !projectId;
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <Link href="/content" className={styles.back}>
            <ArrowLeft size={16} /> Content intelligence
          </Link>
          <h1>
            Content studio <span>Review → publish</span>
          </h1>
          <p>One brief. Every channel. Your final say.</p>
        </div>
        <div className={styles.project}>
          <label htmlFor="studio-project">Workspace project</label>
          <select
            id="studio-project"
            value={projectId}
            disabled={Boolean(busy)}
            onChange={(event) => {
              resetProjectState();
              setProjectId(event.target.value);
              if (user) selectProject(user.id, event.target.value);
            }}
          >
            <option value="" disabled>
              Select project
            </option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.brandName}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={noAction}
            onClick={() => void run("Refreshing", () => load(draft?.id))}
          >
            <RefreshCw size={15} /> Refresh status
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
          {!user && (
            <>
              {" "}
              <Link href="/login">Sign in</Link>
            </>
          )}
        </div>
      )}
      {(busy || message) && (
        <div role="status" className={styles.message}>
          {busy ? `${busy}…` : message}
        </div>
      )}
      {!projects.length && user && (
        <section className={styles.card}>
          <h2>Create a project to get started</h2>
          <Link href="/projects/new">Create project →</Link>
        </section>
      )}
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <section className={styles.card}>
            <h2>
              <Sparkles size={17} /> Start from a brief
            </h2>
            <button
              disabled={noAction}
              onClick={() =>
                void run("Loading briefs", async () => {
                  const project = projects.find((p) => p.id === projectId);
                  if (!project) return;
                  const briefs = await api.request<ContentBriefRecord[]>(
                    `/v1/tenants/${project.tenantId}/projects/${projectId}/content/briefs`,
                  );
                  setSavedBriefs(briefs);
                  setMessage(
                    briefs.length
                      ? "Choose a saved brief below."
                      : "No saved briefs yet. Paste a brief to start.",
                  );
                })
              }
            >
              Load saved briefs
            </button>
            {savedBriefs.length > 0 && (
              <label>
                Saved brief
                <select
                  defaultValue=""
                  onChange={(event) => {
                    const selected = savedBriefs.find((entry) => entry.id === event.target.value);
                    if (!selected) return;
                    setTopic(selected.title);
                    setQuestion(selected.targetPrompts[0] ?? selected.questionsToAnswer[0] ?? "");
                    setBrief(selected.markdownContent);
                    setIntent(
                      {
                        informational: "educational",
                        commercial: "decision",
                        comparison: "consideration",
                        troubleshooting: "retention",
                      }[selected.primaryIntent] ?? "educational",
                    );
                  }}
                >
                  <option value="" disabled>
                    Choose a brief
                  </option>
                  {savedBriefs.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Topic
              <input value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={500} />
            </label>
            <label>
              Buyer question
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={4000}
              />
            </label>
            <label>
              Intent
              <select value={intent} onChange={(e) => setIntent(e.target.value)}>
                {["educational", "awareness", "consideration", "decision", "retention"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Evidence-backed brief
              <textarea
                rows={7}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                maxLength={20000}
                placeholder="Paste your content brief. Product claims will be checked against approved memory."
              />
            </label>
            <button
              className={styles.primary}
              disabled={noAction || !topic.trim() || question.trim().length < 3 || !brief.trim()}
              onClick={() => void generate()}
            >
              Generate six formats
            </button>
            <details>
              <summary>Import a studio document</summary>
              <label>
                Blueprint JSON
                <textarea
                  rows={5}
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                />
              </label>
              <button
                disabled={noAction || !importJson.trim()}
                onClick={() =>
                  void run("Importing", async () => {
                    const result = await api.request<StudioDraft>(base + "/drafts", {
                      method: "POST",
                      body: { document: JSON.parse(importJson) },
                    });
                    await load(result.id);
                    setImportJson("");
                  })
                }
              >
                Import as unapproved draft
              </button>
            </details>
          </section>
          <section className={styles.card}>
            <h2>
              Draft library <span>{snapshot.drafts.length}</span>
            </h2>
            {snapshot.drafts.length ? (
              snapshot.drafts.map((entry) => (
                <button
                  key={entry.id}
                  disabled={Boolean(busy)}
                  className={`${styles.draft} ${entry.id === selectedId ? styles.activeDraft : ""}`}
                  onClick={() => {
                    if (!dirty || window.confirm("Discard unsaved edits?")) setSelectedId(entry.id);
                  }}
                >
                  <strong>{entry.document.topic}</strong>
                  <small>
                    {entry.status.replaceAll("_", " ")} · revision {entry.revision}
                  </small>
                </button>
              ))
            ) : (
              <p>No drafts yet. Generate or import your first asset set.</p>
            )}
          </section>
        </aside>
        <section className={styles.mainColumn}>
          {draft && document ? (
            <>
              <div className={styles.card}>
                <div className={styles.titleRow}>
                  <div>
                    <span className={styles.eyebrow}>
                      {draft.status.replaceAll("_", " ")} · revision {draft.revision}
                      {dirty ? " · unsaved edits" : ""}
                    </span>
                    <h2>{document.topic}</h2>
                    <p>{document.question}</p>
                  </div>
                  <ShieldCheck size={27} />
                </div>
                <ol className={styles.steps}>
                  {["draft", "in_review", "approved", "scheduled", "published"].map((step) => (
                    <li key={step} aria-current={draft.status === step ? "step" : undefined}>
                      {step.replaceAll("_", " ")}
                    </li>
                  ))}
                </ol>
                <div className={styles.actions}>
                  <button
                    disabled={noAction || !dirty || !editable}
                    onClick={() =>
                      void run("Saving", async () => {
                        await api.request(`${base}/drafts/${draft.id}`, {
                          method: "PUT",
                          body: { revision: draft.revision, document },
                        });
                        await load(draft.id);
                        setMessage("Saved as a new draft revision. Previous approval was cleared.");
                      })
                    }
                  >
                    Save edits
                  </button>
                  <button
                    disabled={noAction || dirty || !["draft", "in_review"].includes(draft.status)}
                    onClick={() => void command("review")}
                  >
                    Submit for review & check facts
                  </button>
                  <button
                    className={styles.primary}
                    disabled={noAction || !canApproveDraft(draft, dirty)}
                    onClick={() => void command("approve")}
                  >
                    <Check size={15} /> Approve revision
                  </button>
                </div>
              </div>
              <nav className={styles.tabs} aria-label="Content formats">
                {channels.map((key) => (
                  <button
                    key={key}
                    aria-pressed={channel === key}
                    onClick={() => {
                      setChannel(key);
                      setPlaying(false);
                    }}
                  >
                    {channelLabels[key]}
                  </button>
                ))}
              </nav>
              <div className={styles.split}>
                <section className={styles.card}>
                  <h2>
                    Edit copy <small>{channelLabels[channel]}</small>
                  </h2>
                  {studioFields(document, channel).map((field) => (
                    <label key={field.path.join(".")} htmlFor={`studio-${field.path.join("-")}`}>
                      {field.label}
                      <textarea
                        id={`studio-${field.path.join("-")}`}
                        aria-label={field.label}
                        rows={field.value.length > 250 ? 7 : 3}
                        value={field.value}
                        disabled={!editable || Boolean(busy)}
                        onChange={(event) =>
                          setDocument(updateStudioField(document, field.path, event.target.value))
                        }
                      />
                    </label>
                  ))}
                  <p className={styles.hint}>
                    Editing clears approval when saved. Scheduled and published revisions are
                    read-only.
                  </p>
                </section>
                <section className={`${styles.card} ${styles.preview}`}>
                  <div className={styles.titleRow}>
                    <h2>Live preview</h2>
                    <small>Mockup · {channelLabels[channel]}</small>
                  </div>
                  {channel === "x" && (
                    <div className={styles.thread}>
                      {document.content.x.thread.map((text, index) => (
                        <article key={index}>
                          <div className={styles.avatar}>
                            {projects.find((p) => p.id === projectId)?.brandName.slice(0, 1)}
                          </div>
                          <div>
                            <strong>{projects.find((p) => p.id === projectId)?.brandName}</strong>
                            <small>
                              {" "}
                              {index + 1}/{document.content.x.thread.length}
                            </small>
                            <p>{text}</p>
                            <div className={styles.socialActions}>♡　↻　↗</div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  {channel === "instagram" && (
                    <div className={styles.instagram}>
                      <div className={styles.carousel}>
                        {selectedMedia[slide]?.mime_type.startsWith("image/") && (
                          <Image
                            src={selectedMedia[slide]!.public_url}
                            alt={`Selected carousel artwork ${slide + 1}`}
                            fill
                            unoptimized
                            className={styles.artwork}
                          />
                        )}
                        <span className={styles.slideNumber}>
                          {Math.min(slide + 1, document.content.instagram.carousel_slides.length)} /{" "}
                          {document.content.instagram.carousel_slides.length}
                        </span>
                        <h3>
                          {
                            document.content.instagram.carousel_slides[
                              Math.min(slide, document.content.instagram.carousel_slides.length - 1)
                            ]
                          }
                        </h3>
                      </div>
                      <div className={styles.carouselControls}>
                        <button
                          aria-label="Previous slide"
                          disabled={slide === 0}
                          onClick={() => setSlide((v) => v - 1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <span>Carousel preview</span>
                        <button
                          aria-label="Next slide"
                          disabled={slide >= document.content.instagram.carousel_slides.length - 1}
                          onClick={() => setSlide((v) => v + 1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      <p>{document.content.instagram.caption}</p>
                      <small>
                        Upload rendered slide images before scheduling. Text previews are not image
                        files.
                      </small>
                    </div>
                  )}
                  {channel === "short_video" && (
                    <>
                      <div className={styles.titleRow}>
                        <strong>Teleprompter</strong>
                        <button aria-pressed={playing} onClick={() => setPlaying((v) => !v)}>
                          {playing ? <Pause size={16} /> : <Play size={16} />}
                          {playing ? "Pause" : "Play"}
                        </button>
                      </div>
                      <div ref={prompter} className={styles.prompter}>
                        <h3>{document.content.short_video.hook}</h3>
                        <p>{document.content.short_video.script}</p>
                      </div>
                      <ol className={styles.scenes}>
                        {document.content.short_video.scenes.map((scene, index) => (
                          <li key={index}>
                            <strong>
                              {scene.duration_seconds}s · {scene.visual}
                            </strong>
                            <p>{scene.voiceover}</p>
                          </li>
                        ))}
                      </ol>
                    </>
                  )}
                  {channel === "facebook" && (
                    <article>
                      <strong>{projects.find((p) => p.id === projectId)?.brandName}</strong>
                      <p>{document.content.facebook.caption}</p>
                      <button disabled>{document.content.facebook.cta}</button>
                    </article>
                  )}
                  {channel === "podcast" && (
                    <article>
                      <h3>{document.content.podcast.title}</h3>
                      <p>{document.content.podcast.script}</p>
                      <hr />
                      <h4>Show notes</h4>
                      <p>{document.content.podcast.show_notes}</p>
                    </article>
                  )}
                  {channel === "blog" && (
                    <article>
                      <h3>{document.content.blog.title}</h3>
                      <p className={styles.answer}>{document.content.blog.answer_first_intro}</p>
                      {document.content.blog.sections.map((section, index) => (
                        <section key={index}>
                          <h4>{section.heading}</h4>
                          <p>{section.body}</p>
                        </section>
                      ))}
                      <hr />
                      <small>{document.content.blog.meta_description}</small>
                    </article>
                  )}
                </section>
              </div>
              <section className={styles.card}>
                <h2>
                  <ShieldCheck size={17} /> Validation report
                </h2>
                {dirty ? (
                  <p>
                    Save and recheck your edits. The previous report applies to the saved revision.
                  </p>
                ) : !draft.validation ? (
                  <p>Submit this draft for review to check product facts and platform limits.</p>
                ) : (
                  <>
                    <p className={draft.validation.passed ? styles.success : styles.error}>
                      {draft.validation.passed
                        ? "Checks passed. Human approval is still required."
                        : "Changes required before approval."}
                    </p>
                    {draft.validation.flaggedClaims.map((flag, index) => (
                      <article key={index} className={styles.flag}>
                        <strong>
                          {flag.code} · {flag.path}
                        </strong>
                        <blockquote>{flag.claim}</blockquote>
                        <p>{flag.reason}</p>
                      </article>
                    ))}
                    {draft.validation.suggestions.map((suggestion) => (
                      <p key={suggestion}>→ {suggestion}</p>
                    ))}
                  </>
                )}
              </section>
            </>
          ) : (
            <section className={`${styles.card} ${styles.empty}`}>
              <Sparkles size={34} />
              <h2>Your next campaign starts here</h2>
              <p>
                Turn a reviewed brief into channel-specific drafts, inspect the previews, then
                approve the exact revision you want to publish.
              </p>
            </section>
          )}
        </section>
      </div>
      <div className={styles.settings}>
        <section className={styles.card}>
          <h2>Publishing accounts</h2>
          <p>Credentials are encrypted on the server and never returned to the browser.</p>
          <details>
            <summary>Connect Buffer with an access token</summary>
            <label>
              Buffer access token
              <input
                type="password"
                autoComplete="new-password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </label>
            <button
              disabled={noAction || !token.trim()}
              onClick={() =>
                void run("Connecting Buffer", async () => {
                  await api.request(base + "/connections/buffer", {
                    method: "POST",
                    body: { accessToken: token },
                  });
                  setToken("");
                  await load(draft?.id);
                  setMessage("Buffer channels connected.");
                })
              }
            >
              Connect Buffer
            </button>
          </details>
          <details>
            <summary>Connect WordPress</summary>
            <label>
              Site URL
              <input
                type="url"
                placeholder="https://your-site.com"
                value={siteUrl}
                onChange={(e) => setSiteUrl(e.target.value)}
              />
            </label>
            <label>
              Username
              <input value={username} onChange={(e) => setUsername(e.target.value)} />
            </label>
            <label>
              Application password
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <p>Install the Savoir Article Schema plugin on WordPress first to publish JSON-LD.</p>
            <button
              disabled={noAction || !siteUrl || !username || !password}
              onClick={() =>
                void run("Connecting WordPress", async () => {
                  await api.request(base + "/connections/wordpress", {
                    method: "POST",
                    body: { siteUrl, username, applicationPassword: password },
                  });
                  setPassword("");
                  await load(draft?.id);
                })
              }
            >
              Connect WordPress
            </button>
          </details>
          {snapshot.connections.map((c) => (
            <p key={c.id}>
              <Check size={14} /> {c.provider}: {c.channels.length} connected channel(s)
            </p>
          ))}
        </section>
        <section className={styles.card}>
          <h2>
            <Upload size={17} /> Public media
          </h2>
          <p>
            Upload finished artwork or MP4 video. These files will be publicly accessible for Buffer
            ingestion.
          </p>
          <label>
            Upload file
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4"
              disabled={noAction}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
                e.target.value = "";
              }}
            />
          </label>
          {snapshot.media.map((asset) => (
            <label key={asset.id} className={styles.checkbox}>
              <input
                type="checkbox"
                checked={mediaIds.includes(asset.id)}
                onChange={(e) =>
                  setMediaIds((ids) =>
                    e.target.checked ? [...ids, asset.id] : ids.filter((id) => id !== asset.id),
                  )
                }
              />
              {asset.mime_type} · {(asset.size_bytes / 1048576).toFixed(1)} MB{" "}
              <small>{asset.id.slice(0, 8)}</small>
            </label>
          ))}
          <small>
            These selections control the preview. Choose attachments per destination below. One
            image per slide, or one MP4 reel. Video files for Shorts must meet YouTube’s short-form
            requirements.
          </small>
        </section>
        <section className={styles.card}>
          <h2>Schedule approved content</h2>
          <p>Times use your browser’s local timezone: {timezone}.</p>
          {!snapshot.publishingEnabled && (
            <p className={styles.error}>
              Publishing must be enabled on the server before scheduling.
            </p>
          )}
          {connectedChannels.map((c) => {
            const key = `${c.platform}:${c.id}`;
            return (
              <div key={key}>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={targets.includes(key)}
                    disabled={Boolean(busy) || c.disconnected}
                    onChange={(e) =>
                      setTargets((list) =>
                        e.target.checked ? [...list, key] : list.filter((id) => id !== key),
                      )
                    }
                  />
                  <span>
                    {c.name}
                    <small>
                      {c.platform}
                      {c.reminders ? " · mobile approval required" : ""}
                    </small>
                  </span>
                </label>
                {targets.includes(key) &&
                  c.platform !== "wordpress" &&
                  snapshot.media.length > 0 && (
                    <fieldset className={styles.attachments}>
                      <legend>Attachments for {c.name}</legend>
                      <small>Selection order sets carousel order.</small>
                      {snapshot.media
                        .filter(
                          (asset) =>
                            !["tiktok", "youtube"].includes(c.platform) ||
                            asset.mime_type === "video/mp4",
                        )
                        .map((asset) => (
                          <label className={styles.checkbox} key={asset.id}>
                            <input
                              type="checkbox"
                              checked={targetMedia[key]?.includes(asset.id) ?? false}
                              disabled={Boolean(busy)}
                              onChange={(event) =>
                                setTargetMedia((current) => ({
                                  ...current,
                                  [key]: event.target.checked
                                    ? [...(current[key] ?? []), asset.id]
                                    : (current[key] ?? []).filter((id) => id !== asset.id),
                                }))
                              }
                            />
                            {asset.mime_type} · {asset.id.slice(0, 8)}
                          </label>
                        ))}
                    </fieldset>
                  )}
              </div>
            );
          })}
          {!connectedChannels.length && <p>Connect a publishing account to select destinations.</p>}
          <label>
            Publication time
            <input
              type="datetime-local"
              value={scheduleTime}
              onChange={(e) => setScheduleTime(e.target.value)}
            />
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={notification}
              onChange={(e) => setNotification(e.target.checked)}
            />
            Use mobile reminders where supported
          </label>
          <button
            className={styles.primary}
            disabled={
              noAction ||
              !snapshot.publishingEnabled ||
              draft?.status !== "approved" ||
              dirty ||
              !targets.length ||
              !scheduleTime
            }
            onClick={() =>
              void run("Scheduling", async () => {
                if (!draft) return;
                const selectedTargets = connectedChannels
                  .filter((c) => targets.includes(`${c.platform}:${c.id}`))
                  .map((c) => ({
                    platform: c.platform,
                    channelId: c.id,
                    mediaIds:
                      c.platform === "wordpress"
                        ? []
                        : (targetMedia[`${c.platform}:${c.id}`] ?? []),
                    schedulingType: notification || c.reminders ? "notification" : "automatic",
                  }));
                await api.request(`${base}/drafts/${draft.id}/schedule`, {
                  method: "POST",
                  body: {
                    revision: draft.revision,
                    scheduledTime: scheduleUtc(scheduleTime),
                    targets: selectedTargets,
                  },
                });
                await load(draft.id);
                setMessage("Scheduled. The worker will recheck eligibility before dispatch.");
              })
            }
          >
            Schedule selected channels
          </button>
        </section>
      </div>
      <section className={styles.card}>
        <h2>Delivery activity & notifications</h2>
        <p>
          Refresh to check delivery progress. Buffer acceptance and mobile reminders do not confirm
          publication.
        </p>
        {snapshot.deliveries.length ? (
          snapshot.deliveries.map((delivery) => (
            <article key={delivery.id} className={styles.delivery}>
              <strong>
                {delivery.platform} · {delivery.state.replaceAll("_", " ")}
              </strong>
              {delivery.notice && (
                <p
                  role={
                    delivery.state === "manual_action" || delivery.state === "uncertain"
                      ? "status"
                      : undefined
                  }
                >
                  {delivery.notice}
                </p>
              )}
              {delivery.remote_url?.startsWith("https://") && (
                <a href={delivery.remote_url} target="_blank" rel="noreferrer">
                  View published post ↗
                </a>
              )}
            </article>
          ))
        ) : (
          <p>No scheduled deliveries yet.</p>
        )}
      </section>
    </main>
  );
}
