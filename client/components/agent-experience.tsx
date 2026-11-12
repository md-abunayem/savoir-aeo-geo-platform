"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  FileCode2,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  RefreshCw,
  Search,
  Sparkles,
  ShieldCheck,
  Save,
  Globe,
  FileText,
  Layers,
  ExternalLink,
} from "lucide-react";
import { api, ApiError } from "../lib/api";
import styles from "./workspace-sections.module.css";
import type {
  Project,
  PolicyPreset,
  AgentPolicyRecord,
  RobotsComparisonResult,
  LlmsValidationResult,
  AxoDraftsResult,
} from "../lib/types";

interface AgentExperienceProps {
  tenantId: string;
  project: Project;
}

export function AgentExperience({ tenantId, project }: AgentExperienceProps) {
  const [activeTab, setActiveTab] = useState<"robots" | "llms" | "drafts">("robots");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generatingPolicy, setGeneratingPolicy] = useState(false);
  const [validating, setValidating] = useState(false);
  const [generatingDrafts, setGeneratingDrafts] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Policy state
  const [policy, setPolicy] = useState<AgentPolicyRecord | null>(null);
  const [preset, setPreset] = useState<PolicyPreset>("search_only");
  const [robotsContent, setRobotsContent] = useState<string>("");
  const [customDirectives, setCustomDirectives] = useState<string>("");
  const [botRules, setBotRules] = useState<Record<string, boolean>>({});
  const [comparison, setComparison] = useState<RobotsComparisonResult | null>(null);

  // LLMS.txt validator state
  const [validateUrl, setValidateUrl] = useState<string>(`https://${project.domain}/llms.txt`);
  const [validationTargetUrl, setValidationTargetUrl] = useState<string | null>(null);
  const [llmsValidation, setLlmsValidation] = useState<LlmsValidationResult | null>(null);
  const [fullTxtAvailable, setFullTxtAvailable] = useState<boolean>(false);
  const [rawLlmsContent, setRawLlmsContent] = useState<string>("");

  // Drafts & Schemas state
  const [drafts, setDrafts] = useState<AxoDraftsResult | null>(null);
  const [activeSchemaTab, setActiveSchemaTab] = useState<"organization" | "product" | "faqPage" | "article">("organization");

  const basePath = `/v1/tenants/${tenantId}/projects/${project.id}/axo`;

  // Fetch initial policy
  useEffect(() => {
    let ignore = false;
    const fetchPolicy = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await api.request<AgentPolicyRecord>(`${basePath}/policy`);
        if (!ignore && res) {
          setPolicy(res);
          setPreset(res.policyPreset || "search_only");
          setRobotsContent(res.robotsTxtContent || "");
          setCustomDirectives(res.customDirectives || "");
          setBotRules(res.botRules || {});
          if (res.llmsValidation && (res.llmsValidation as LlmsValidationResult).score !== undefined) {
            setLlmsValidation(res.llmsValidation as LlmsValidationResult);
          }
          if (res.schemaTemplates && Object.keys(res.schemaTemplates).length > 0) {
            setDrafts({
              llmsTxt: res.llmsTxtDraft || "",
              llmsFullTxt: res.llmsFullTxtDraft || "",
              schemas: res.schemaTemplates as AxoDraftsResult["schemas"],
            });
          }
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof ApiError ? err.message : "Failed to load agent policy");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    fetchPolicy();
    return () => {
      ignore = true;
    };
  }, [basePath]);

  // Handle Preset Selection & Generation
  const handlePresetChange = async (newPreset: PolicyPreset) => {
    setPreset(newPreset);
    setGeneratingPolicy(true);
    setError(null);
    try {
      const res = await api.request<{
        preset: PolicyPreset;
        generatedContent: string;
        comparison: RobotsComparisonResult;
      }>(`${basePath}/robots/generate`, {
        method: "POST",
        body: {
          preset: newPreset,
          customBotRules: botRules,
          customDirectives,
        },
      });
      if (res) {
        setRobotsContent(res.generatedContent);
        setComparison(res.comparison);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to generate robots.txt policy");
    } finally {
      setGeneratingPolicy(false);
    }
  };

  // Toggle single bot rule in custom mode
  const handleBotRuleToggle = async (botId: string) => {
    const updated = { ...botRules, [botId]: !botRules[botId] };
    setBotRules(updated);
    setPreset("custom");
    setGeneratingPolicy(true);
    setError(null);

    try {
      const res = await api.request<{
        preset: PolicyPreset;
        generatedContent: string;
        comparison: RobotsComparisonResult;
      }>(`${basePath}/robots/generate`, {
        method: "POST",
        body: {
          preset: "custom",
          customBotRules: updated,
          customDirectives,
        },
      });
      if (res) {
        setRobotsContent(res.generatedContent);
        setComparison(res.comparison);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update robots.txt preview");
    } finally {
      setGeneratingPolicy(false);
    }
  };

  // Save Policy to DB
  const handleSavePolicy = async () => {
    setSaving(true);
    setError(null);
    setSuccessMessage(null);
    try {
      const res = await api.request<AgentPolicyRecord>(`${basePath}/policy`, {
        method: "POST",
        body: {
          policyPreset: preset,
          robotsTxtContent: robotsContent,
          botRules,
          trainingBotsDisallowed: preset === "search_only" || preset === "strict_copyright",
          searchBotsAllowed: preset !== "strict_copyright",
          customDirectives,
          llmsTxtDraft: drafts?.llmsTxt || policy?.llmsTxtDraft,
          llmsFullTxtDraft: drafts?.llmsFullTxt || policy?.llmsFullTxtDraft,
          llmsValidation: llmsValidation || policy?.llmsValidation || {},
          schemaTemplates: drafts?.schemas || policy?.schemaTemplates || {},
        },
      });
      if (res) {
        setPolicy(res);
        setSuccessMessage("Agent policy and robots.txt directives saved successfully!");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save agent policy");
    } finally {
      setSaving(false);
    }
  };

  // Live validate LLMS.txt
  const handleValidateLlms = async () => {
    setValidating(true);
    setError(null);
    try {
      const res = await api.request<{
        url: string;
        statusCode: number;
        rawContent: string;
        validation: LlmsValidationResult;
        fullTxtAvailable: boolean;
      }>(`${basePath}/llms/validate`, {
        method: "POST",
        body: { targetUrl: validateUrl },
      });
      if (res) {
        setLlmsValidation(res.validation);
        setValidationTargetUrl(validateUrl);
        setFullTxtAvailable(res.fullTxtAvailable);
        setRawLlmsContent(res.rawContent);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to validate /llms.txt");
    } finally {
      setValidating(false);
    }
  };

  // 1-Click Generate Drafts & Schemas
  const handleGenerateDrafts = async () => {
    setGeneratingDrafts(true);
    setError(null);
    try {
      const res = await api.request<AxoDraftsResult>(`${basePath}/drafts/generate`, {
        method: "POST",
      });
      if (res) {
        setDrafts(res);
        setSuccessMessage("Synthesized LLMS.txt and Schema.org templates from crawl data!");
        setTimeout(() => setSuccessMessage(null), 3000);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to synthesize drafts");
    } finally {
      setGeneratingDrafts(false);
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

  if (loading) {
    return (
      <div className={`${styles.page} ${styles.loadingState}`} aria-live="polite">
        <RefreshCw className="w-8 h-8 text-primary animate-spin mx-auto" />
        <p className="text-xs text-muted-foreground">Loading Agent Experience Optimization configuration...</p>
      </div>
    );
  }

  return (
    <div className={`${styles.page} space-y-8 max-w-6xl mx-auto pb-16`}>
      {/* Top Header */}
      <header className={`${styles.header} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
        <div className={styles.headerCopy}>
          <p className={styles.eyebrow}>Agent experience</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <span>Agent Experience Optimization</span>
          </h1>
          <p className={`${styles.description} text-xs text-muted-foreground mt-1`}>
            Review how AI crawlers can access {project.domain}, validate its llms.txt file, and prepare structured content drafts.
          </p>
        </div>

        <div className={`${styles.headerActions} flex items-center gap-2.5`}>
          <button
            type="button"
            onClick={handleSavePolicy}
            disabled={saving}
            className={`${styles.primaryButton} inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all disabled:opacity-50`}
          >
            {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            <span>Save Configuration</span>
          </button>
        </div>
      </header>

      {/* Notifications */}
      {error && (
        <div role="alert" className="p-3 text-xs bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 rounded-xl flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {successMessage && (
        <div role="status" className="p-3 text-xs bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 rounded-xl flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}
      {generatingPolicy && (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
          Updating the robots.txt preview…
        </p>
      )}

      <section className={styles.summaryGrid} aria-label="Agent experience summary">
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>LLMS readability score</span>
          <strong className={styles.summaryValue}>
            {llmsValidation && llmsValidation.status !== "missing"
              ? `${llmsValidation.score} / 100`
              : "Not available"}
          </strong>
          <span className={styles.summaryNote}>
            {llmsValidation && llmsValidation.status !== "missing"
              ? "Modeled from the latest validation"
              : "Validate the target file to measure readability"}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Validation status</span>
          <strong className={styles.summaryValue}>
            {llmsValidation && llmsValidation.status !== "missing"
              ? llmsValidation.status
              : "Not available"}
          </strong>
          <span className={styles.summaryNote}>
            {llmsValidation?.status === "missing"
              ? "No usable llms.txt content was returned"
              : validationTargetUrl
                ? `Checked ${validationTargetUrl}`
                : llmsValidation
                  ? "Previously saved result; target URL not available"
                : "No validation has been run"}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Sections found</span>
          <strong className={styles.summaryValue}>
            {llmsValidation && llmsValidation.status !== "missing"
              ? llmsValidation.sections.length
              : "Not available"}
          </strong>
          <span className={styles.summaryNote}>From the latest llms.txt check</span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Curated links</span>
          <strong className={styles.summaryValue}>
            {llmsValidation && llmsValidation.status !== "missing"
              ? llmsValidation.totalLinks
              : "Not available"}
          </strong>
          <span className={styles.summaryNote}>Provider-independent document check</span>
        </div>
      </section>

      {/* Tab Navigation */}
      <div className={`${styles.tabs} flex items-center gap-1 border-b border-border`} role="tablist" aria-label="Agent Experience sections">
        <button
          type="button"
          id="axo-robots-tab"
          role="tab"
          aria-selected={activeTab === "robots"}
          aria-controls="axo-robots-panel"
          onClick={() => setActiveTab("robots")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "robots"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Bot className="w-4 h-4" />
          <span>Robots.txt AI Policy Builder</span>
        </button>

        <button
          type="button"
          id="axo-llms-tab"
          role="tab"
          aria-selected={activeTab === "llms"}
          aria-controls="axo-llms-panel"
          onClick={() => setActiveTab("llms")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "llms"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>LLMS.txt Validator & Inspector</span>
          {llmsValidation && (
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                llmsValidation.score >= 80
                  ? "bg-emerald-500/10 text-emerald-600"
                  : llmsValidation.score >= 50
                    ? "bg-amber-500/10 text-amber-600"
                    : "bg-rose-500/10 text-rose-600"
              }`}
            >
              {llmsValidation.score}
            </span>
          )}
        </button>

        <button
          type="button"
          id="axo-drafts-tab"
          role="tab"
          aria-selected={activeTab === "drafts"}
          aria-controls="axo-drafts-panel"
          onClick={() => setActiveTab("drafts")}
          className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold border-b-2 transition-colors ${
            activeTab === "drafts"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Draft & Schema Generator</span>
        </button>
      </div>

      {/* TAB 1: ROBOTS.TXT AI POLICY BUILDER */}
      {activeTab === "robots" && (
        <div id="axo-robots-panel" role="tabpanel" aria-labelledby="axo-robots-tab" className="space-y-6">
          {/* Policy Preset Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {[
              {
                id: "search_only",
                title: "Search Only (Recommended)",
                badge: "Balanced",
                desc: "Allows real-time answer & citation bots (ChatGPT Search, Perplexity, AI Overviews) while blocking model training crawlers.",
              },
              {
                id: "maximum_visibility",
                title: "Maximum Visibility",
                badge: "Open",
                desc: "Allows all search and training bots to ingest and train on all public content across foundation models.",
              },
              {
                id: "strict_copyright",
                title: "Strict Copyright",
                badge: "Restricted",
                desc: "Disallows all AI search & training bots. Permits standard traditional web search crawlers only.",
              },
              {
                id: "custom",
                title: "Custom Directives",
                badge: "Granular",
                desc: "Explicit per-bot overrides tailored to your organization's legal and distribution policies.",
              },
            ].map((p) => {
              const selected = preset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handlePresetChange(p.id as PolicyPreset)}
                  disabled={generatingPolicy}
                  aria-busy={generatingPolicy}
                  className={`text-left p-4 rounded-2xl border transition-all ${
                    selected
                      ? "border-primary bg-primary/5 shadow-sm ring-1 ring-primary"
                      : "border-border bg-card hover:bg-muted/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-foreground">{p.title}</span>
                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {p.badge}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{p.desc}</p>
                </button>
              );
            })}
          </div>

          {/* Policy Summary Banner */}
          {comparison && (
            <div className="p-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4" />
                  <span>AI Posture Impact Analysis</span>
                </span>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-600 font-medium">
                    Search Bots Allowed: {comparison.searchBotsAllowed}
                  </span>
                  <span className="text-muted-foreground">•</span>
                  <span className="text-amber-600 font-medium">
                    Training Crawlers Blocked: {comparison.trainingBotsBlocked}
                  </span>
                </div>
              </div>
              <p className="text-xs text-foreground/80 leading-relaxed">{comparison.netImpact}</p>
            </div>
          )}

          {/* Two-Column Editor & Comparison */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Generated Robots.txt */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileCode2 className="w-4 h-4 text-primary" />
                  <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Generated Robots.txt
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleCopy("robots", robotsContent)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                >
                  {copiedKey === "robots" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedKey === "robots" ? "Copied" : "Copy"}</span>
                </button>
              </div>

              <textarea
                value={robotsContent}
                onChange={(e) => setRobotsContent(e.target.value)}
                rows={18}
                className="w-full font-mono text-xs p-3.5 rounded-xl border border-border bg-muted/40 text-foreground resize-y focus:outline-none focus:ring-1 focus:ring-primary leading-relaxed"
                spellCheck={false}
              />

              <div className="space-y-1.5">
                <label className="text-[11px] font-semibold text-muted-foreground">Custom Additional Directives:</label>
                <input
                  type="text"
                  placeholder="e.g. Disallow: /staging/ or Crawl-delay: 5"
                  value={customDirectives}
                  onChange={(e) => setCustomDirectives(e.target.value)}
                  className="w-full text-xs px-3 py-2 rounded-xl border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            </div>

            {/* AI Bot Rules Matrix */}
            <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-primary" />
                  <span>Monitored AI Bots Status</span>
                </span>
                <span className="text-[11px] text-muted-foreground">Toggle to customize</span>
              </div>

              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {/* Search Bots */}
                <div className="space-y-2">
                  <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    Real-Time Search & Answer Grounding Bots (Allowed for Citations)
                  </div>
                  {[
                    { id: "OAI-SearchBot", name: "OAI-SearchBot", owner: "OpenAI Search" },
                    { id: "ChatGPT-User", name: "ChatGPT-User", owner: "ChatGPT Live" },
                    { id: "Googlebot", name: "Googlebot", owner: "Google & AI Overviews" },
                    { id: "PerplexityBot", name: "PerplexityBot", owner: "Perplexity AI" },
                    { id: "Bingbot", name: "Bingbot", owner: "Microsoft Copilot" },
                    { id: "Applebot", name: "Applebot", owner: "Apple Intelligence" },
                    { id: "YouBot", name: "YouBot", owner: "You.com" },
                  ].map((bot) => {
                    const isAllowed = botRules[bot.id] !== undefined ? botRules[bot.id] : preset !== "strict_copyright";
                    return (
                      <div
                        key={bot.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-foreground">{bot.name}</div>
                          <div className="text-[11px] text-muted-foreground">{bot.owner}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleBotRuleToggle(bot.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            isAllowed
                              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                          }`}
                        >
                          {isAllowed ? "Allow: /" : "Disallow: /"}
                        </button>
                      </div>
                    );
                  })}
                </div>

                {/* Training Bots */}
                <div className="space-y-2 pt-2 border-t border-border">
                  <div className="text-[11px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-wider">
                    AI Model Training Crawlers (Scraping Content for Foundation Models)
                  </div>
                  {[
                    { id: "GPTBot", name: "GPTBot", owner: "OpenAI Foundation Training" },
                    { id: "Google-Extended", name: "Google-Extended", owner: "Google Gemini Training" },
                    { id: "ClaudeBot", name: "ClaudeBot", owner: "Anthropic Claude Training" },
                    { id: "CCBot", name: "CCBot", owner: "Common Crawl Dataset" },
                    { id: "Bytespider", name: "Bytespider", owner: "ByteDance Doubao" },
                    { id: "Diffbot", name: "Diffbot", owner: "Diffbot Knowledge Graph" },
                    { id: "FacebookBot", name: "FacebookBot", owner: "Meta Llama Training" },
                    { id: "Amazonbot", name: "Amazonbot", owner: "Amazon Bedrock Training" },
                    { id: "Cohere-ai", name: "Cohere-ai", owner: "Cohere Model Training" },
                  ].map((bot) => {
                    const isAllowed = botRules[bot.id] !== undefined ? botRules[bot.id] : preset === "maximum_visibility";
                    return (
                      <div
                        key={bot.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-border bg-muted/20 text-xs"
                      >
                        <div>
                          <div className="font-semibold text-foreground">{bot.name}</div>
                          <div className="text-[11px] text-muted-foreground">{bot.owner}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleBotRuleToggle(bot.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-colors ${
                            isAllowed
                              ? "bg-emerald-500/10 text-emerald-600 border border-emerald-500/20"
                              : "bg-rose-500/10 text-rose-600 border border-rose-500/20"
                          }`}
                        >
                          {isAllowed ? "Allow: /" : "Disallow: /"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: LLMS.TXT VALIDATOR & INSPECTOR */}
      {activeTab === "llms" && (
        <div id="axo-llms-panel" role="tabpanel" aria-labelledby="axo-llms-tab" className="space-y-6">
          {/* Target Input Card */}
          <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Globe className="w-4 h-4 text-primary" />
                  <span>Live Specification Validator</span>
                </span>
                <p className="text-xs text-muted-foreground">
                  Validates /llms.txt against the official specification structure (H1 Title, Blockquote Summary, H2 Sections, Markdown Link List).
                </p>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="url"
                  value={validateUrl}
                  onChange={(e) => setValidateUrl(e.target.value)}
                  className="text-xs px-3 py-2 rounded-xl border border-border bg-background text-foreground w-72 focus:outline-none focus:ring-1 focus:ring-primary"
                />
                <button
                  type="button"
                  onClick={handleValidateLlms}
                  disabled={validating}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                >
                  {validating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Inspect</span>
                </button>
              </div>
            </div>

            {/* Quick Badges */}
            {fullTxtAvailable && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 text-xs font-medium border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>/llms-full.txt detected on domain</span>
              </div>
            )}
          </div>

          {/* Validation Report */}
          {llmsValidation && (
            <div className="space-y-6">
              {/* Score & Key Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-4 rounded-2xl border border-border bg-card flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-muted-foreground">Readability Score</span>
                  <div className="text-3xl font-black mt-2 text-foreground flex items-baseline gap-1">
                    <span>{llmsValidation.score}</span>
                    <span className="text-xs text-muted-foreground">/ 100</span>
                  </div>
                  <span
                    className={`mt-2 text-[10px] font-bold px-2 py-0.5 rounded-full inline-block w-fit ${
                      llmsValidation.status === "valid"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : llmsValidation.status === "warning"
                          ? "bg-amber-500/10 text-amber-600"
                          : "bg-rose-500/10 text-rose-600"
                    }`}
                  >
                    {llmsValidation.status.toUpperCase()}
                  </span>
                </div>

                <div className="p-4 rounded-2xl border border-border bg-card">
                  <span className="text-[11px] font-semibold text-muted-foreground">H1 Title</span>
                  <div className="text-sm font-bold mt-2 truncate text-foreground">
                    {llmsValidation.title || <span className="text-rose-500">Missing</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">Single top heading</div>
                </div>

                <div className="p-4 rounded-2xl border border-border bg-card">
                  <span className="text-[11px] font-semibold text-muted-foreground">Categorized Sections</span>
                  <div className="text-2xl font-bold mt-2 text-foreground">{llmsValidation.sections.length}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">H2 headings found</div>
                </div>

                <div className="p-4 rounded-2xl border border-border bg-card">
                  <span className="text-[11px] font-semibold text-muted-foreground">Total Curated Links</span>
                  <div className="text-2xl font-bold mt-2 text-foreground">{llmsValidation.totalLinks}</div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {llmsValidation.internalLinksCount} internal • {llmsValidation.externalLinksCount} external
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-border bg-card">
                  <span className="text-[11px] font-semibold text-muted-foreground">Broken / Bad Links</span>
                  <div
                    className={`text-2xl font-bold mt-2 ${
                      llmsValidation.brokenLinksCount > 0 ? "text-rose-500" : "text-emerald-500"
                    }`}
                  >
                    {llmsValidation.brokenLinksCount}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {llmsValidation.brokenLinksCount === 0 ? "All URLs valid" : "Malformed link targets"}
                  </div>
                </div>
              </div>

              {/* Issues & Warnings List */}
              {llmsValidation.issues.length > 0 && (
                <div className="p-5 rounded-2xl border border-border bg-card space-y-3">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    <span>Compliance Issues & Recommendations ({llmsValidation.issues.length})</span>
                  </div>

                  <div className="space-y-2">
                    {llmsValidation.issues.map((issue, idx) => {
                      const findingType =
                        issue.severity === "critical" || issue.severity === "high"
                          ? "Verified finding"
                          : issue.severity === "medium" || issue.severity === "low"
                            ? "Suggestion"
                            : "Informational note";
                      return (
                        <article
                          key={`${issue.code}-${issue.line ?? idx}`}
                          className={`${styles.itemCard} p-3 rounded-xl border text-xs`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="font-semibold text-foreground">{issue.message}</div>
                              <div className="text-[11px] text-muted-foreground">
                                <strong>{findingType}</strong> · {issue.severity} severity
                              </div>
                            </div>
                            <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-background/50 shrink-0">
                              {issue.severity}
                            </span>
                          </div>
                          <div className="grid gap-1 mt-3 text-[11px] text-muted-foreground sm:grid-cols-2">
                            <p><strong>Affected page:</strong> {validationTargetUrl || "Not available"}</p>
                            <p><strong>Recommended action:</strong> Review the reported line and correct the issue where needed.</p>
                          </div>
                          <details className={styles.disclosure}>
                            <summary>Technical evidence</summary>
                            <div className="text-[11px] text-muted-foreground">
                              <code>{issue.code}</code>
                              {issue.line ? ` · Line ${issue.line}` : ""}
                              <p><strong>Evidence:</strong> {issue.message}</p>
                            </div>
                          </details>
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}
              {llmsValidation.issues.length === 0 && (
                <div className={`${styles.emptyState} p-6`}>
                  <CheckCircle2 className="w-5 h-5 text-primary" />
                  <strong className="text-sm text-foreground">No findings in this validation</strong>
                  <span className="text-xs text-muted-foreground">
                    This result only reflects the checked llms.txt document.
                  </span>
                </div>
              )}

              {/* Sections & Links Explorer */}
              {llmsValidation.sections.length > 0 && (
                <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-primary" />
                    <span>Structured Section Tree</span>
                  </div>

                  <div className="space-y-4">
                    {llmsValidation.sections.map((sec, sIdx) => (
                      <div key={sIdx} className="p-3.5 rounded-xl border border-border bg-muted/20 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground">## {sec.title}</span>
                          <span className="text-[11px] text-muted-foreground">{sec.links.length} links</span>
                        </div>
                        <div className="space-y-1.5">
                          {sec.links.map((link, lIdx) => (
                            <div
                              key={lIdx}
                              className="p-2 rounded-lg bg-background border border-border/60 text-xs flex items-center justify-between gap-3"
                            >
                              <div className="truncate">
                                <a
                                  href={link.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="font-medium text-primary hover:underline inline-flex items-center gap-1"
                                >
                                  <span>{link.title}</span>
                                  <ExternalLink className="w-3 h-3 opacity-60" />
                                </a>
                                {link.description && (
                                  <span className="text-muted-foreground text-[11px] ml-2">
                                    : {link.description}
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground shrink-0">
                                {link.isInternal ? "Internal" : "External"}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Raw Content Viewer */}
              {rawLlmsContent && (
                <div className="p-5 rounded-2xl border border-border bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileCode2 className="w-4 h-4 text-primary" />
                      <span>Raw /llms.txt Content</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy("raw_llms", rawLlmsContent)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                    >
                      {copiedKey === "raw_llms" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === "raw_llms" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <pre className="font-mono text-xs p-3.5 rounded-xl border border-border bg-muted/40 overflow-x-auto text-foreground whitespace-pre-wrap max-h-80">
                    {rawLlmsContent}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: DRAFT & SCHEMA GENERATOR */}
      {activeTab === "drafts" && (
        <div id="axo-drafts-panel" role="tabpanel" aria-labelledby="axo-drafts-tab" className="space-y-6">
          {/* Header Action Banner */}
          <div className="p-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4" />
                <span>AI Drafts & Schema Synthesizer</span>
              </span>
              <p className="text-xs text-foreground/80 max-w-2xl">
                Automatically synthesizes an official specification /llms.txt draft, comprehensive /llms-full.txt, and copy-pasteable Schema.org JSON-LD templates based on crawled technical pages and monitoring prompts.
              </p>
            </div>

            <button
              type="button"
              onClick={handleGenerateDrafts}
              disabled={generatingDrafts}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-semibold shadow-sm transition-all disabled:opacity-50 shrink-0"
            >
              {generatingDrafts ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>Synthesize Drafts</span>
            </button>
          </div>

          {/* Drafts Content Display */}
          {drafts && (
            <div className="space-y-6">
              {/* Draft LLMS.txt & LLMS-Full.txt Split */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Draft /llms.txt */}
                <div className="p-5 rounded-2xl border border-border bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileText className="w-4 h-4 text-primary" />
                      <span>Draft /llms.txt</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy("draft_llms", drafts.llmsTxt)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                    >
                      {copiedKey === "draft_llms" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === "draft_llms" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <textarea
                    value={drafts.llmsTxt}
                    readOnly
                    rows={16}
                    className="w-full font-mono text-xs p-3.5 rounded-xl border border-border bg-muted/40 text-foreground resize-none leading-relaxed"
                  />
                </div>

                {/* Draft /llms-full.txt */}
                <div className="p-5 rounded-2xl border border-border bg-card space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <Layers className="w-4 h-4 text-primary" />
                      <span>Draft /llms-full.txt</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy("draft_full", drafts.llmsFullTxt)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border hover:bg-muted text-foreground transition-colors"
                    >
                      {copiedKey === "draft_full" ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedKey === "draft_full" ? "Copied" : "Copy"}</span>
                    </button>
                  </div>
                  <textarea
                    value={drafts.llmsFullTxt}
                    readOnly
                    rows={16}
                    className="w-full font-mono text-xs p-3.5 rounded-xl border border-border bg-muted/40 text-foreground resize-none leading-relaxed"
                  />
                </div>
              </div>

              {/* Schema.org Templates */}
              <div className="p-5 rounded-2xl border border-border bg-card space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <FileCode2 className="w-4 h-4 text-primary" />
                      <span>Schema.org JSON-LD Structured Data Templates</span>
                    </span>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Copy and insert into the &lt;head&gt; of your pages to maximize entity grounding for search bots.
                    </p>
                  </div>

                  <a
                    href="https://search.google.com/test/rich-results"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs text-primary font-medium hover:underline shrink-0"
                  >
                    <span>Google Rich Results Test</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                </div>

                {/* Subtabs for Schema Types */}
                <div className="flex items-center gap-2 border-b border-border pb-2">
                  {(["organization", "product", "faqPage", "article"] as const).map((sType) => (
                    <button
                      key={sType}
                      type="button"
                      onClick={() => setActiveSchemaTab(sType)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg capitalize transition-colors ${
                        activeSchemaTab === sType
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {sType === "faqPage" ? "FAQPage" : sType}
                    </button>
                  ))}
                </div>

                {/* Active Schema JSON Preview */}
                <div className="relative">
                  <div className="absolute top-3 right-3 z-10">
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(
                          `schema_${activeSchemaTab}`,
                          JSON.stringify(drafts.schemas[activeSchemaTab] || {}, null, 2)
                        )
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-background/80 hover:bg-muted text-foreground transition-colors shadow-sm"
                    >
                      {copiedKey === `schema_${activeSchemaTab}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      <span>{copiedKey === `schema_${activeSchemaTab}` ? "Copied" : "Copy JSON-LD"}</span>
                    </button>
                  </div>

                  <pre className="font-mono text-xs p-4 rounded-xl border border-border bg-muted/40 overflow-x-auto text-foreground max-h-96">
                    {JSON.stringify(drafts.schemas[activeSchemaTab] || {}, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
