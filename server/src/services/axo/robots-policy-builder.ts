/**
 * AXO-FR-003, AXO-FR-004, AXO-FR-005: Robots.txt AI Policy Builder
 *
 * Distinguishes strictly between:
 * 1. Real-Time Search & Answer Grounding Bots (necessary for citations and live AI queries)
 * 2. AI Model Training Crawlers (harvesting data for foundation model training)
 */

export interface BotMetadata {
  id: string;
  name: string;
  owner: string;
  category: "search" | "training";
  purpose: string;
  citationImpact: string;
}

export const SEARCH_ANSWER_BOTS: BotMetadata[] = [
  {
    id: "OAI-SearchBot",
    name: "OAI-SearchBot",
    owner: "OpenAI",
    category: "search",
    purpose: "SearchGPT and ChatGPT Search real-time web indexer",
    citationImpact: "Critical for ChatGPT Search and citation attribution in ChatGPT answers.",
  },
  {
    id: "ChatGPT-User",
    name: "ChatGPT-User",
    owner: "OpenAI",
    category: "search",
    purpose: "Live ChatGPT user browsing and on-demand citation retrieval",
    citationImpact: "Essential for live link clicks and grounded answers in ChatGPT conversations.",
  },
  {
    id: "Googlebot",
    name: "Googlebot",
    owner: "Google",
    category: "search",
    purpose: "Google Web Search and AI Overviews real-time grounding crawler",
    citationImpact:
      "Directly determines presence in Google Search, AI Overviews, and Gemini grounding.",
  },
  {
    id: "PerplexityBot",
    name: "PerplexityBot",
    owner: "Perplexity AI",
    category: "search",
    purpose: "Perplexity conversational answer engine real-time indexer",
    citationImpact: "Determines Perplexity citations, source cards, and follow-up query links.",
  },
  {
    id: "Bingbot",
    name: "Bingbot",
    owner: "Microsoft",
    category: "search",
    purpose: "Microsoft Bing and Copilot search engine crawler",
    citationImpact: "Powers Microsoft Copilot answer citations and Bing AI search grounding.",
  },
  {
    id: "Applebot",
    name: "Applebot",
    owner: "Apple",
    category: "search",
    purpose: "Apple Intelligence, Siri, and Spotlight web grounding agent",
    citationImpact: "Powers generative summaries and conversational answers on iOS/macOS devices.",
  },
  {
    id: "YouBot",
    name: "YouBot",
    owner: "You.com",
    category: "search",
    purpose: "You.com conversational search crawler",
    citationImpact: "Grounds citations in You.com multi-model AI responses.",
  },
];

export const TRAINING_BOTS: BotMetadata[] = [
  {
    id: "GPTBot",
    name: "GPTBot",
    owner: "OpenAI",
    category: "training",
    purpose: "OpenAI foundation model pre-training and fine-tuning scraper",
    citationImpact:
      "Used for general model knowledge; blocking does NOT hurt ChatGPT Search citations.",
  },
  {
    id: "Google-Extended",
    name: "Google-Extended",
    owner: "Google",
    category: "training",
    purpose: "Google Gemini and Vertex AI training data harvesting crawler",
    citationImpact:
      "Blocking protects proprietary IP without affecting Google Search or AI Overviews indexing.",
  },
  {
    id: "ClaudeBot",
    name: "ClaudeBot",
    owner: "Anthropic",
    category: "training",
    purpose: "Anthropic Claude model training crawler",
    citationImpact: "Harvests training data for Claude models.",
  },
  {
    id: "CCBot",
    name: "CCBot",
    owner: "Common Crawl",
    category: "training",
    purpose: "Common Crawl open web scraper used by multiple foundation model creators",
    citationImpact:
      "Open-source scrape repository; blocking prevents uncredited training inclusion.",
  },
  {
    id: "Bytespider",
    name: "Bytespider",
    owner: "ByteDance",
    category: "training",
    purpose: "ByteDance AI training and content scraper",
    citationImpact: "High-volume scraper for Doubao and ByteDance LLMs.",
  },
  {
    id: "Diffbot",
    name: "Diffbot",
    owner: "Diffbot",
    category: "training",
    purpose: "Commercial web graph and entity relationship extractor",
    citationImpact: "Builds commercial knowledge graphs for third-party AI systems.",
  },
  {
    id: "FacebookBot",
    name: "FacebookBot",
    owner: "Meta",
    category: "training",
    purpose: "Meta Llama and AI training crawler",
    citationImpact: "Harvests web data for open weights model training.",
  },
  {
    id: "Amazonbot",
    name: "Amazonbot",
    owner: "Amazon",
    category: "training",
    purpose: "Amazon Bedrock and Alexa model training crawler",
    citationImpact: "Harvests content for Amazon AI models.",
  },
  {
    id: "Cohere-ai",
    name: "Cohere-ai",
    owner: "Cohere",
    category: "training",
    purpose: "Cohere enterprise language model training crawler",
    citationImpact: "Harvests enterprise and web content for Cohere Command models.",
  },
];

export const ALL_AI_BOTS = [...SEARCH_ANSWER_BOTS, ...TRAINING_BOTS];

export type PolicyPreset = "search_only" | "maximum_visibility" | "strict_copyright" | "custom";

export interface GenerateRobotsOptions {
  preset: PolicyPreset;
  customBotRules?: Record<string, boolean>; // botId -> true (allow) | false (disallow)
  customDirectives?: string; // extra custom lines (e.g., Disallow: /admin)
  sitemapUrl?: string;
  domain?: string;
  llmsTxtUrl?: string;
}

export interface BotDiffItem {
  bot: string;
  name: string;
  category: "search" | "training";
  existingStatus: "allowed" | "disallowed" | "unspecified";
  proposedStatus: "allowed" | "disallowed";
  hasChanged: boolean;
  impact: string;
}

export interface RobotsComparisonResult {
  searchBotsAllowed: number;
  searchBotsBlocked: number;
  trainingBotsAllowed: number;
  trainingBotsBlocked: number;
  diffs: BotDiffItem[];
  netImpact: string;
}

export class RobotsPolicyBuilder {
  /**
   * Generates a compliant robots.txt string based on the chosen preset or custom configuration.
   */
  generateRobotsTxt(options: GenerateRobotsOptions): string {
    const {
      preset,
      customBotRules = {},
      customDirectives,
      sitemapUrl,
      domain,
      llmsTxtUrl,
    } = options;

    const lines: string[] = [];
    const dateStr = new Date().toISOString().split("T")[0];

    lines.push("# =======================================================================");
    lines.push("# Robots.txt AI Policy");
    lines.push(`# Generated by AEO-GEO Agent Experience Optimization on ${dateStr}`);
    lines.push(`# Policy Preset: ${preset.toUpperCase()}`);
    lines.push("# =======================================================================");
    lines.push("");

    if (preset === "search_only") {
      lines.push("# -----------------------------------------------------------------------");
      lines.push("# 1. REAL-TIME AI SEARCH & ANSWER GROUNDING BOTS (ALLOWED)");
      lines.push(
        "# These bots enable citations in SearchGPT, Perplexity, Copilot, & AI Overviews.",
      );
      lines.push("# -----------------------------------------------------------------------");
      for (const bot of SEARCH_ANSWER_BOTS) {
        lines.push(`User-agent: ${bot.id}`);
        lines.push("Allow: /");
        lines.push("");
      }

      lines.push("# -----------------------------------------------------------------------");
      lines.push("# 2. AI MODEL TRAINING CRAWLERS (DISALLOWED)");
      lines.push(
        "# Blocking these scrapers protects your content from uncredited training datasets",
      );
      lines.push("# without sacrificing live search or citation visibility.");
      lines.push("# -----------------------------------------------------------------------");
      for (const bot of TRAINING_BOTS) {
        lines.push(`User-agent: ${bot.id}`);
        lines.push("Disallow: /");
        lines.push("");
      }
    } else if (preset === "maximum_visibility") {
      lines.push("# -----------------------------------------------------------------------");
      lines.push("# MAXIMUM VISIBILITY PRESET");
      lines.push("# Allows all real-time search bots AND foundation model training crawlers");
      lines.push("# to maximize presence across all AI pipelines and knowledge stores.");
      lines.push("# -----------------------------------------------------------------------");
      for (const bot of ALL_AI_BOTS) {
        lines.push(`User-agent: ${bot.id}`);
        lines.push("Allow: /");
        lines.push("");
      }
    } else if (preset === "strict_copyright") {
      lines.push("# -----------------------------------------------------------------------");
      lines.push("# STRICT COPYRIGHT PRESET");
      lines.push("# Disallows all AI-specific crawlers, both real-time grounding and training.");
      lines.push("# Standard search engine bots (Googlebot, Bingbot) remain permitted.");
      lines.push("# -----------------------------------------------------------------------");
      // Allow general web search
      lines.push("User-agent: Googlebot");
      lines.push("Allow: /");
      lines.push("");
      lines.push("User-agent: Bingbot");
      lines.push("Allow: /");
      lines.push("");

      // Disallow all other AI search bots and training bots
      for (const bot of ALL_AI_BOTS) {
        if (bot.id !== "Googlebot" && bot.id !== "Bingbot") {
          lines.push(`User-agent: ${bot.id}`);
          lines.push("Disallow: /");
          lines.push("");
        }
      }
    } else {
      // Custom preset
      lines.push("# -----------------------------------------------------------------------");
      lines.push("# CUSTOM AI BOT DIRECTIVES");
      lines.push("# -----------------------------------------------------------------------");
      for (const bot of ALL_AI_BOTS) {
        const isAllowed = customBotRules[bot.id] ?? bot.category === "search";
        lines.push(`User-agent: ${bot.id}`);
        lines.push(isAllowed ? "Allow: /" : "Disallow: /");
        lines.push("");
      }
    }

    // Default crawler section
    lines.push("# -----------------------------------------------------------------------");
    lines.push("# DEFAULT RULES FOR OTHER CRAWLERS");
    lines.push("# -----------------------------------------------------------------------");
    lines.push("User-agent: *");
    lines.push("Allow: /");

    if (customDirectives && customDirectives.trim()) {
      lines.push("");
      lines.push("# Custom Directives");
      for (const cLine of customDirectives.trim().split(/\r?\n/)) {
        if (cLine.trim()) lines.push(cLine.trim());
      }
    }

    lines.push("");
    lines.push("# -----------------------------------------------------------------------");
    lines.push("# DISCOVERY SITEMAP & LLMS.TXT");
    lines.push("# -----------------------------------------------------------------------");
    const activeDomain = domain
      ? domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")
      : "example.com";
    const finalLlmsTxt = llmsTxtUrl || `https://${activeDomain}/llms.txt`;
    const finalSitemap = sitemapUrl || `https://${activeDomain}/sitemap.xml`;

    lines.push(`Sitemap: ${finalSitemap}`);
    lines.push(`llms.txt: ${finalLlmsTxt}`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Compares an existing robots.txt string against a proposed robots.txt string.
   */
  compareRobotsTxt(existingContent: string, proposedContent: string): RobotsComparisonResult {
    const existingRules = this.parseBotRules(existingContent);
    const proposedRules = this.parseBotRules(proposedContent);

    const diffs: BotDiffItem[] = [];
    let searchBotsAllowed = 0;
    let searchBotsBlocked = 0;
    let trainingBotsAllowed = 0;
    let trainingBotsBlocked = 0;

    for (const bot of ALL_AI_BOTS) {
      const existingStatus = existingRules[bot.id.toLowerCase()] ?? "unspecified";
      const proposedAllow = proposedRules[bot.id.toLowerCase()] === "allowed";
      const proposedStatus: "allowed" | "disallowed" = proposedAllow ? "allowed" : "disallowed";

      if (bot.category === "search") {
        if (proposedStatus === "allowed") searchBotsAllowed++;
        else searchBotsBlocked++;
      } else {
        if (proposedStatus === "allowed") trainingBotsAllowed++;
        else trainingBotsBlocked++;
      }

      const hasChanged = existingStatus !== proposedStatus;
      let impact: string;

      if (hasChanged) {
        if (proposedStatus === "allowed") {
          impact =
            bot.category === "search"
              ? `Enables real-time citations on ${bot.owner} answer engines.`
              : `Allows content harvesting for ${bot.owner} foundation model training.`;
        } else {
          impact =
            bot.category === "search"
              ? `Blocks real-time citations and answer sourcing on ${bot.owner}.`
              : `Protects intellectual property from uncredited training by ${bot.owner}.`;
        }
      } else {
        impact = `Access remains ${proposedStatus}.`;
      }

      diffs.push({
        bot: bot.id,
        name: bot.name,
        category: bot.category,
        existingStatus,
        proposedStatus,
        hasChanged,
        impact,
      });
    }

    let netImpact: string;
    if (searchBotsAllowed >= 5 && trainingBotsBlocked >= 5) {
      netImpact =
        "Optimal AI posture: High real-time citation potential while restricting automated model training.";
    } else if (searchBotsAllowed >= 5 && trainingBotsAllowed >= 5) {
      netImpact =
        "Maximum exposure posture: Content is fully accessible for both citation grounding and model pre-training.";
    } else if (searchBotsBlocked >= 4) {
      netImpact =
        "Restricted posture: Substantial loss in real-time AI search citations across multiple LLM engines.";
    } else {
      netImpact = `Custom posture with ${searchBotsAllowed} search bots and ${trainingBotsAllowed} training bots allowed.`;
    }

    return {
      searchBotsAllowed,
      searchBotsBlocked,
      trainingBotsAllowed,
      trainingBotsBlocked,
      diffs,
      netImpact,
    };
  }

  /**
   * Internal parser to determine bot access from robots.txt content
   */
  private parseBotRules(content: string): Record<string, "allowed" | "disallowed"> {
    const rules: Record<string, "allowed" | "disallowed"> = {};
    if (!content || !content.trim()) {
      return rules;
    }

    const lines = content.split(/\r?\n/);
    let currentAgents: string[] = [];
    let inDirectives = false;
    let wildcardRule: "allowed" | "disallowed" | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const directive = line.slice(0, colonIdx).trim().toLowerCase();
      const value = line.slice(colonIdx + 1).trim();

      if (directive === "user-agent") {
        if (inDirectives) {
          currentAgents = [];
          inDirectives = false;
        }
        currentAgents.push(value.toLowerCase());
      } else if (directive === "disallow" || directive === "allow") {
        inDirectives = true;
        const isAllow = directive === "allow" || value === "";
        const status: "allowed" | "disallowed" = isAllow ? "allowed" : "disallowed";

        for (const agent of currentAgents) {
          if (agent === "*") {
            wildcardRule = status;
          } else {
            // Specific agent takes precedence if not set yet
            if (rules[agent] === undefined) {
              rules[agent] = status;
            }
          }
        }
      }
    }

    // Apply wildcard fallback to any bots that were not explicitly mentioned
    if (wildcardRule) {
      for (const bot of ALL_AI_BOTS) {
        const idLower = bot.id.toLowerCase();
        if (rules[idLower] === undefined) {
          rules[idLower] = wildcardRule;
        }
      }
    }

    return rules;
  }
}
