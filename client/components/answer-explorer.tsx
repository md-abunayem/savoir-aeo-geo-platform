"use client";

import { useState, useEffect } from "react";
import {
  Search,
  Download,
  Columns2,
  ExternalLink,
  Flag,
  Check,
  X,
  Copy,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  Clock,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
} from "lucide-react";
import { api } from "../lib/api";
import { groundingStatusLabel } from "../lib/provider-status";
import type { Project, AnswerItem, MentionItem } from "../lib/types";

const ENGINE_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  gemini: "Gemini",
  google_ai_overviews: "AI Overviews",
  google_ai_mode: "AI Mode",
  openrouter: "OpenRouter / GPT-6 Luna",
};

interface AnswerExplorerProps {
  project: Project;
}

export function AnswerExplorer({ project }: AnswerExplorerProps) {
  const [answers, setAnswers] = useState<AnswerItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Filters
  const [search, setSearch] = useState("");
  const [engine, setEngine] = useState("");
  const [brandMentioned, setBrandMentioned] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [citationDomain, setCitationDomain] = useState("");

  // Modals & Active Details
  const [activeAnswerId, setActiveAnswerId] = useState<string | null>(null);
  const [detailAnswer, setDetailAnswer] = useState<AnswerItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"text" | "mentions" | "citations" | "claims" | "raw">("text");

  // Flag Modal
  const [flaggingAnswer, setFlaggingAnswer] = useState<AnswerItem | null>(null);
  const [flagReason, setFlagReason] = useState("inaccurate");
  const [flagNote, setFlagNote] = useState("");
  const [flagSubmitting, setFlagSubmitting] = useState(false);

  // Compare Modal
  const [comparePromptId, setComparePromptId] = useState<string | null>(null);
  const [compareData, setCompareData] = useState<{
    type: string;
    engines: AnswerItem[];
  } | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);

  useEffect(() => {
    let disposed = false;
    async function load() {
      try {
        const params = new URLSearchParams();
        if (engine) params.set("engine", engine);
        if (brandMentioned) params.set("brandMentioned", brandMentioned);
        if (sentiment) params.set("sentiment", sentiment);
        if (search.trim()) params.set("search", search.trim());
        if (citationDomain.trim()) params.set("citationDomain", citationDomain.trim());
        params.set("limit", "25");

        const endpoint = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers?${params.toString()}`;
        const res = await api.request<{ answers: AnswerItem[]; total: number }>(endpoint);

        if (!disposed) {
          setAnswers(res.answers || []);
          setTotal(res.total || 0);
          setLoading(false);
        }
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : "Failed to load answers");
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      disposed = true;
    };
  }, [project, engine, brandMentioned, sentiment, search, citationDomain]);

  // Load Answer Details
  const openDetail = async (id: string) => {
    setActiveAnswerId(id);
    setDetailLoading(true);
    setActiveTab("text");
    try {
      const endpoint = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers/${id}`;
      const res = await api.request<AnswerItem>(endpoint);
      setDetailAnswer(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load answer details");
    } finally {
      setDetailLoading(false);
    }
  };

  // Compare cross-engine
  const openCompare = async (promptId?: string) => {
    if (!promptId) return;
    setComparePromptId(promptId);
    setCompareLoading(true);
    try {
      const endpoint = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers/compare?promptId=${promptId}`;
      const res = await api.request<{ type: string; engines: AnswerItem[] }>(endpoint);
      setCompareData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate comparison");
    } finally {
      setCompareLoading(false);
    }
  };

  // Flag Answer
  const handleFlagSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flaggingAnswer) return;
    setFlagSubmitting(true);
    try {
      const endpoint = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers/${flaggingAnswer.id}/flag`;
      await api.request(endpoint, {
        method: "POST",
        body: {
          reason: flagReason,
          note: flagNote,
          tags: ["user_flag"],
        },
      });
      setNotice("Answer successfully flagged for review");
      setFlaggingAnswer(null);
      setFlagNote("");
      if (activeAnswerId === flaggingAnswer.id) {
        openDetail(flaggingAnswer.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit flag");
    } finally {
      setFlagSubmitting(false);
    }
  };

  // Review mention
  const handleReviewMention = async (mentionId: string, status: "verified" | "false_positive") => {
    if (!detailAnswer) return;
    try {
      const endpoint = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers/${detailAnswer.id}/mentions/${mentionId}`;
      await api.request(endpoint, {
        method: "PATCH",
        body: { reviewStatus: status },
      });
      setDetailAnswer((prev) => {
        if (!prev || !prev.mentions) return prev;
        return {
          ...prev,
          mentions: prev.mentions.map((m) => (m.id === mentionId ? { ...m, reviewStatus: status } : m)),
        };
      });
      setNotice(`Mention marked as ${status.replace("_", " ")}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update mention");
    }
  };

  // Export CSV
  const handleExportCsv = () => {
    const params = new URLSearchParams();
    if (engine) params.set("engine", engine);
    if (brandMentioned) params.set("brandMentioned", brandMentioned);
    if (sentiment) params.set("sentiment", sentiment);
    if (search.trim()) params.set("search", search.trim());
    params.set("format", "csv");
    const url = `/v1/tenants/${project.tenantId}/projects/${project.id}/answers?${params.toString()}`;
    window.open(url, "_blank");
  };

  // Render Highlighted Text
  const renderHighlightedText = (text: string, mentions: MentionItem[] = []) => {
    if (!mentions.length) return <span>{text}</span>;

    // Build replacement segments
    const sorted = [...mentions].sort((a, b) => text.indexOf(a.matchedText) - text.indexOf(b.matchedText));
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;

    for (let i = 0; i < sorted.length; i++) {
      const m = sorted[i];
      const matchIndex = text.indexOf(m.matchedText, lastIndex);
      if (matchIndex === -1) continue;

      if (matchIndex > lastIndex) {
        parts.push(text.slice(lastIndex, matchIndex));
      }

      const isBrand = m.entityType === "brand";
      parts.push(
        <span
          key={`${m.id}-${i}`}
          className={`mention-highlight ${isBrand ? "brand" : "competitor"}`}
          title={`${m.entityName} (${m.entityType}) - Sentiment: ${m.sentiment > 0 ? "+1 Positive" : m.sentiment < 0 ? "-1 Negative" : "0 Neutral"}`}
        >
          {m.matchedText}
        </span>,
      );

      lastIndex = matchIndex + m.matchedText.length;
    }

    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex));
    }

    return <span>{parts}</span>;
  };

  return (
    <div className="answers-container">
      {notice && (
        <div className="notice" role="status" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="icon-button" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert" style={{ display: "flex", justifyContent: "space-between" }}>
          <span>{error}</span>
          <button onClick={() => setError("")} className="icon-button" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="answers-filter-bar">
        <div className="search-input" style={{ position: "relative", display: "flex", alignItems: "center" }}>
          <Search size={16} style={{ position: "absolute", left: 12, color: "var(--muted)" }} />
          <input
            type="search"
            placeholder="Search answers & claims (full-text search)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 36 }}
          />
        </div>

        <select value={engine} onChange={(e) => setEngine(e.target.value)} aria-label="Filter by engine">
          <option value="">All Engines</option>
          <option value="openai">ChatGPT</option>
          <option value="gemini">Gemini</option>
          <option value="google_ai_overviews">Google AI Overviews</option>
          <option value="google_ai_mode">Google AI Mode</option>
          <option value="openrouter">OpenRouter / GPT-6 Luna (web search)</option>
        </select>

        <select
          value={brandMentioned}
          onChange={(e) => setBrandMentioned(e.target.value)}
          aria-label="Filter by brand mentioned"
        >
          <option value="">Brand: All</option>
          <option value="true">Brand Mentioned (Yes)</option>
          <option value="false">Brand Mentioned (No)</option>
        </select>

        <select value={sentiment} onChange={(e) => setSentiment(e.target.value)} aria-label="Filter by sentiment">
          <option value="">Sentiment: All</option>
          <option value="1">Positive (+1)</option>
          <option value="0">Neutral (0)</option>
          <option value="-1">Negative (-1)</option>
        </select>

        <input
          type="text"
          placeholder="Filter cited domain..."
          value={citationDomain}
          onChange={(e) => setCitationDomain(e.target.value)}
          style={{ width: 170 }}
        />

        <button className="primary-button" onClick={handleExportCsv} title="Export CSV" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Download size={15} /> Export CSV
        </button>
      </div>

      {/* Total & Summary Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingInline: 4 }}>
        <p className="muted" style={{ margin: 0 }}>
          Showing <strong>{answers.length}</strong> of <strong>{total}</strong> captured AI answers for{" "}
          <strong>{project.brandName}</strong>
        </p>
      </div>

      {/* Answers Grid / List */}
      {loading ? (
        <div className="panel" style={{ textAlign: "center", padding: "3rem" }}>
          <p className="muted">Loading answers…</p>
        </div>
      ) : answers.length === 0 ? (
        <div className="panel empty-state" style={{ textAlign: "center", padding: "3rem" }}>
          <Info size={32} style={{ color: "var(--muted)", margin: "0 auto 12px" }} />
          <h3>No answers match the selected filters</h3>
          <p className="muted">Try adjusting your filters or execute new monitoring runs to populate answers.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {answers.map((ans) => {
            const engineKey = ans.engine || "gemini";
            const engineName = ENGINE_LABELS[engineKey] || engineKey;
            const isBrand = ans.brandMentioned;

            return (
              <article
                key={ans.id}
                className="answer-card"
                onClick={() => openDetail(ans.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && openDetail(ans.id)}
              >
                <div className="answer-card-header">
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span className={`badge-engine ${engineKey}`}>{engineName}</span>
                      <span className="disclosure-badge">
                        {ans.sourceType === "licensed_serp" ? "SERP AI Surface" : "Official API"}
                      </span>
                      <span className="disclosure-badge">
                        {groundingStatusLabel(ans.groundingStatus)}
                      </span>
                      <span className="muted" style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                        <Clock size={12} /> {new Date(ans.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                      <span className="muted" style={{ fontSize: 11 }}>
                        {ans.geo} / {ans.language}
                      </span>
                    </div>
                    <h3 className="answer-prompt">{ans.promptText || "General Research Prompt"}</h3>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: 8 }} onClick={(e) => e.stopPropagation()}>
                    {ans.promptId && (
                      <button
                        className="text-button"
                        onClick={() => openCompare(ans.promptId)}
                        title="Compare answers across engines"
                        style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 }}
                      >
                        <Columns2 size={14} /> Compare Engines
                      </button>
                    )}
                    <button
                      className="icon-button"
                      onClick={() => setFlaggingAnswer(ans)}
                      title="Flag answer as inaccurate"
                      aria-label="Flag answer"
                    >
                      <Flag size={15} />
                    </button>
                    <ChevronRight size={18} style={{ color: "var(--muted)" }} />
                  </div>
                </div>

                {/* Answer Snippet Preview */}
                <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                  {ans.text}
                </p>

                {/* Badges / Metrics Bar */}
                <div className="answer-meta">
                  <span className={`mention-pill ${isBrand ? "brand-yes" : "brand-no"}`}>
                    {isBrand ? (
                      <>
                        <Check size={12} style={{ display: "inline", verticalAlign: "middle", marginRight: 3 }} />
                        {project.brandName} Mentioned ({ans.brandPosition ? `#${ans.brandPosition}` : "1st"})
                      </>
                    ) : (
                      "No Brand Mention"
                    )}
                  </span>

                  {ans.brandSentiment !== null && ans.brandSentiment !== undefined && (
                    <span
                      className={`sentiment-pill ${
                        ans.brandSentiment > 0 ? "positive" : ans.brandSentiment < 0 ? "negative" : "neutral"
                      }`}
                    >
                      {ans.brandSentiment > 0 ? (
                        <>
                          <TrendingUp size={12} /> Positive (+1)
                        </>
                      ) : ans.brandSentiment < 0 ? (
                        <>
                          <TrendingDown size={12} /> Negative (-1)
                        </>
                      ) : (
                        <>
                          <Minus size={12} /> Neutral (0)
                        </>
                      )}
                    </span>
                  )}

                  {ans.citationsCount > 0 && (
                    <span className="muted" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <ExternalLink size={12} /> {ans.citationsCount} citation{ans.citationsCount > 1 ? "s" : ""}
                      {ans.citationDomains?.length > 0 && (
                        <small>({ans.citationDomains.slice(0, 3).join(", ")})</small>
                      )}
                    </span>
                  )}

                  {ans.flagsCount > 0 && (
                    <span style={{ color: "#a63c35", fontSize: 11, display: "inline-flex", alignItems: "center", gap: 3 }}>
                      <AlertTriangle size={12} /> {ans.flagsCount} Flag{ans.flagsCount > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Answer Detail Modal */}
      {activeAnswerId && (
        <dialog
          open
          style={{
            position: "fixed",
            inset: 0,
            width: "90vw",
            maxWidth: 880,
            maxHeight: "88vh",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 0,
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            zIndex: 100,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Header */}
          <div className="dialog-head" style={{ padding: "16px 20px", borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span className={`badge-engine ${detailAnswer?.engine || "gemini"}`}>
                  {ENGINE_LABELS[detailAnswer?.engine || ""] || detailAnswer?.engine}
                </span>
                <span className="disclosure-badge">
                  {detailAnswer?.sourceType === "licensed_serp" ? "Licensed SERP Capture" : "Official API"}
                </span>
                <small className="muted">{detailAnswer?.geo} / {detailAnswer?.language}</small>
              </div>
              <h2 style={{ fontSize: 17, margin: 0 }}>{detailAnswer?.promptText || "Answer Detail"}</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {detailAnswer && (
                <button
                  className="icon-button"
                  onClick={() => setFlaggingAnswer(detailAnswer)}
                  title="Flag as inaccurate"
                >
                  <Flag size={16} />
                </button>
              )}
              <button
                className="icon-button"
                onClick={() => {
                  setActiveAnswerId(null);
                  setDetailAnswer(null);
                }}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Nav Tabs */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)", background: "var(--soft)", paddingInline: 16 }}>
            {[
              { id: "text", label: "Answer & Mentions Highlighted" },
              { id: "mentions", label: `Entities (${detailAnswer?.mentions?.length || 0})` },
              { id: "citations", label: `Citations (${detailAnswer?.citations?.length || 0})` },
              { id: "claims", label: `Brand Claims (${detailAnswer?.claims?.length || 0})` },
              { id: "raw", label: "Raw Response" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                style={{
                  padding: "10px 14px",
                  fontSize: 13,
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  borderBottom: activeTab === tab.id ? "2px solid var(--brand)" : "none",
                  color: activeTab === tab.id ? "var(--brand)" : "var(--muted)",
                  background: "transparent",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="dialog-body" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {detailLoading ? (
              <p className="muted">Loading details…</p>
            ) : !detailAnswer ? (
              <p className="error">Answer not found</p>
            ) : activeTab === "text" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ background: "#fbfcfb", border: "1px solid var(--line)", borderRadius: 8, padding: 16, lineHeight: 1.7, fontSize: 14, whiteSpace: "pre-wrap" }}>
                  {renderHighlightedText(detailAnswer.text, detailAnswer.mentions)}
                </div>

                <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mention-highlight brand" style={{ padding: "1px 6px" }}>
                      {project.brandName}
                    </span>
                    <span className="muted">Your Tracked Brand</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="mention-highlight competitor" style={{ padding: "1px 6px" }}>
                      Competitor
                    </span>
                    <span className="muted">Tracked Competitors</span>
                  </div>
                </div>

                {detailAnswer.sourceDisclosure && (
                  <div style={{ padding: 12, background: "var(--soft)", borderRadius: 6, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
                    <ShieldCheck size={16} />
                    <span>{detailAnswer.sourceDisclosure.disclosureNote}</span>
                  </div>
                )}
                <p className="disclosure-badge" aria-live="polite">
                  {groundingStatusLabel(detailAnswer.groundingStatus)}
                </p>
                {detailAnswer.groundingStatus === "unknown" && (
                  <p className="muted">
                    This record does not include stored grounding evidence.
                  </p>
                )}
                <section aria-label="Provider citations">
                  <h3>Provider citations</h3>
                  {detailAnswer.providerCitations?.length ? (
                    <ul>
                      {detailAnswer.providerCitations.map((citation, index) => (
                        <li key={`${citation.url}-${index}`}>
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {citation.title || citation.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No provider citations were stored.</p>
                  )}
                </section>
                <section aria-label="URLs written in the answer">
                  <h3>URLs written in answer text</h3>
                  {detailAnswer.answerTextUrls?.length ? (
                    <ul>
                      {detailAnswer.answerTextUrls.map((citation, index) => (
                        <li key={`${citation.url}-${index}`}>
                          <a
                            href={citation.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {citation.title || citation.url}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted">No URLs were found in the answer text.</p>
                  )}
                </section>
              </div>
            ) : activeTab === "mentions" ? (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Entity</th>
                      <th>Type</th>
                      <th>Mention Position</th>
                      <th>List Rank</th>
                      <th>Sentiment</th>
                      <th>Confidence</th>
                      <th>Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailAnswer.mentions || []).map((m) => (
                      <tr key={m.id}>
                        <td>
                          <strong>{m.entityName}</strong>
                          <br />
                          <small className="muted">Matched: &quot;{m.matchedText}&quot;</small>
                        </td>
                        <td>
                          <span className={`mention-pill ${m.entityType === "brand" ? "brand-yes" : "competitor"}`}>
                            {m.entityType.toUpperCase()}
                          </span>
                        </td>
                        <td>#{m.positionIndex}</td>
                        <td>{m.listRank ? `#${m.listRank}` : "—"}</td>
                        <td>
                          <span className={`sentiment-pill ${m.sentiment > 0 ? "positive" : m.sentiment < 0 ? "negative" : "neutral"}`}>
                            {m.sentiment > 0 ? "+1 Positive" : m.sentiment < 0 ? "-1 Negative" : "0 Neutral"}
                          </span>
                        </td>
                        <td>{(m.confidence * 100).toFixed(0)}% ({m.label || "Observed"})</td>
                        <td>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              className="text-button"
                              onClick={() => handleReviewMention(m.id, "verified")}
                              title="Mark Verified"
                              style={{ color: m.reviewStatus === "verified" ? "#165b38" : "inherit" }}
                            >
                              Verify
                            </button>
                            <button
                              className="text-button"
                              onClick={() => handleReviewMention(m.id, "false_positive")}
                              title="Mark False Positive"
                              style={{ color: m.reviewStatus === "false_positive" ? "#a63c35" : "inherit" }}
                            >
                              False Pos
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : activeTab === "citations" ? (
              <div>
                <p className="muted">
                  Provider citations are reported separately from URLs written
                  in the answer text. Recorded citations below may include both.
                </p>
                <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Domain</th>
                      <th>Source Type (CIT-FR-002)</th>
                      <th>URL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detailAnswer.citations || []).map((c, idx) => (
                      <tr key={idx}>
                        <td>#{c.orderIndex || idx + 1}</td>
                        <td>
                          <strong>{c.domain}</strong>
                          {c.anchorText && <small className="muted"><br />{c.anchorText}</small>}
                        </td>
                        <td>
                          <span className="disclosure-badge" style={{ textTransform: "capitalize" }}>
                            {c.sourceType.replace("_", " ")}
                          </span>
                        </td>
                        <td>
                          <a
                            href={c.normalizedUrl || c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--brand)" }}
                          >
                            <span style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {c.normalizedUrl || c.url}
                            </span>
                            <ExternalLink size={13} />
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            ) : activeTab === "claims" ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {(detailAnswer.claims || []).map((cl) => (
                  <div key={cl.id} style={{ background: "var(--soft)", padding: 14, borderRadius: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className="badge-engine" style={{ textTransform: "uppercase" }}>{cl.theme}</span>
                      <small className="muted">Label: {cl.label} ({(cl.confidence * 100).toFixed(0)}% confidence)</small>
                    </div>
                    <p style={{ margin: 0, fontSize: 13 }}>&ldquo;{cl.claimText}&rdquo;</p>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
                  <button
                    className="text-button"
                    onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(detailAnswer.rawResponse || detailAnswer, null, 2));
                      setNotice("Raw JSON copied to clipboard");
                    }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                  >
                    <Copy size={13} /> Copy JSON
                  </button>
                </div>
                <pre style={{ background: "#111827", color: "#f3f4f6", padding: 14, borderRadius: 8, fontSize: 12, overflowX: "auto" }}>
                  {JSON.stringify(detailAnswer.rawResponse || detailAnswer, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </dialog>
      )}

      {/* Flag Modal */}
      {flaggingAnswer && (
        <dialog
          open
          style={{
            position: "fixed",
            inset: 0,
            maxWidth: 480,
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            zIndex: 120,
          }}
        >
          <div className="dialog-head" style={{ marginBottom: 14 }}>
            <h2>Flag Answer (ANS-FR-007)</h2>
            <button className="icon-button" onClick={() => setFlaggingAnswer(null)}>
              <X size={18} />
            </button>
          </div>
          <form onSubmit={handleFlagSubmit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <label>
              Reason
              <select value={flagReason} onChange={(e) => setFlagReason(e.target.value)}>
                <option value="inaccurate">Inaccurate Claims / Facts</option>
                <option value="misleading">Misleading Brand Information</option>
                <option value="outdated">Outdated Pricing or Features</option>
                <option value="competitor_bias">Unfair Competitor Bias</option>
                <option value="hallucination">Hallucination / Fabricated Sources</option>
                <option value="other">Other Issue</option>
              </select>
            </label>

            <label>
              Notes / Evidence
              <textarea
                rows={3}
                placeholder="Explain what is inaccurate or misleading in this answer..."
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
              />
            </label>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
              <button type="button" className="text-button" onClick={() => setFlaggingAnswer(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button" disabled={flagSubmitting}>
                {flagSubmitting ? "Submitting…" : "Submit Flag"}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {/* Cross-Engine Compare Modal (ANS-FR-005) */}
      {comparePromptId && (
        <dialog
          open
          style={{
            position: "fixed",
            inset: 0,
            width: "92vw",
            maxWidth: 1100,
            maxHeight: "88vh",
            background: "var(--panel)",
            border: "1px solid var(--line)",
            borderRadius: 12,
            padding: 20,
            boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            zIndex: 110,
            overflowY: "auto",
          }}
        >
          <div className="dialog-head" style={{ marginBottom: 16 }}>
            <h2>Cross-Engine Answer Comparison (ANS-FR-005)</h2>
            <button className="icon-button" onClick={() => setComparePromptId(null)}>
              <X size={18} />
            </button>
          </div>

          {compareLoading ? (
            <p className="muted">Loading comparison across engines…</p>
          ) : !compareData || !compareData.engines.length ? (
            <p className="muted">No other engine runs found for this prompt yet.</p>
          ) : (
            <div>
              <p className="muted" style={{ marginBottom: 16 }}>
                Prompt: <strong>{compareData.engines[0]?.promptText}</strong>
              </p>
              <div className="compare-grid">
                {compareData.engines.map((eng) => (
                  <div key={eng.id} className="compare-column">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span className={`badge-engine ${eng.engine}`}>
                        {ENGINE_LABELS[eng.engine] || eng.engine}
                      </span>
                      <small className="muted">{eng.latencyMs ? `${eng.latencyMs}ms` : ""}</small>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11 }}>
                      <span className={`mention-pill ${eng.brandMentioned ? "brand-yes" : "brand-no"}`}>
                        {eng.brandMentioned ? "Brand Mentioned" : "No Brand Mention"}
                      </span>
                      {eng.brandSentiment !== null && eng.brandSentiment !== undefined && (
                        <span className={`sentiment-pill ${eng.brandSentiment > 0 ? "positive" : eng.brandSentiment < 0 ? "negative" : "neutral"}`}>
                          Sentiment: {eng.brandSentiment > 0 ? "+1" : eng.brandSentiment < 0 ? "-1" : "0"}
                        </span>
                      )}
                    </div>

                    <div style={{ background: "#fff", padding: 12, borderRadius: 6, border: "1px solid var(--line)", fontSize: 13, lineHeight: 1.6, flex: 1, maxHeight: 300, overflowY: "auto", whiteSpace: "pre-wrap" }}>
                      {renderHighlightedText(eng.text, eng.mentions)}
                    </div>

                    <small className="muted">
                      {eng.citations?.length || 0} citations · Source: {eng.sourceType}
                    </small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </dialog>
      )}
    </div>
  );
}
