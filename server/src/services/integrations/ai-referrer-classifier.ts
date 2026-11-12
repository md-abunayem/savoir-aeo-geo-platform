/**
 * AI Referrer Classifier (M11 / TRF-FR-002, TRF-FR-003)
 * Classifies referral domains and app URI schemes into a dedicated AI Channel Group.
 */

export interface ClassifiedReferrer {
  isAiReferral: boolean;
  aiEngine?: "chatgpt" | "gemini" | "perplexity" | "claude" | "copilot" | "deepseek" | "other_ai";
  engineDisplayName?: string;
  customChannelGroup: "AI Referral" | "Organic Search" | "Direct" | "Referral" | "Paid" | "Other";
}

const AI_REFERRER_MAP: Record<
  string,
  {
    engine: "chatgpt" | "gemini" | "perplexity" | "claude" | "copilot" | "deepseek" | "other_ai";
    displayName: string;
  }
> = {
  // ChatGPT / OpenAI
  "chatgpt.com": { engine: "chatgpt", displayName: "ChatGPT" },
  "chat.openai.com": { engine: "chatgpt", displayName: "ChatGPT" },
  "openai.com": { engine: "chatgpt", displayName: "ChatGPT" },
  "android-app://com.openai.chatgpt": { engine: "chatgpt", displayName: "ChatGPT (Android App)" },
  "ios-app://com.openai.chat": { engine: "chatgpt", displayName: "ChatGPT (iOS App)" },

  // Google Gemini
  "gemini.google.com": { engine: "gemini", displayName: "Google Gemini" },
  "bard.google.com": { engine: "gemini", displayName: "Google Gemini" },

  // Perplexity AI
  "perplexity.ai": { engine: "perplexity", displayName: "Perplexity" },
  "www.perplexity.ai": { engine: "perplexity", displayName: "Perplexity" },

  // Anthropic Claude
  "claude.ai": { engine: "claude", displayName: "Claude" },

  // Microsoft Copilot / Bing Chat
  "copilot.microsoft.com": { engine: "copilot", displayName: "Microsoft Copilot" },
  "edgeservices.bing.com": { engine: "copilot", displayName: "Microsoft Copilot" },
  "bing.com/chat": { engine: "copilot", displayName: "Microsoft Copilot" },

  // DeepSeek
  "chat.deepseek.com": { engine: "deepseek", displayName: "DeepSeek" },
  "deepseek.com": { engine: "deepseek", displayName: "DeepSeek" },

  // Other AI Search Engines
  "poe.com": { engine: "other_ai", displayName: "Poe" },
  "you.com": { engine: "other_ai", displayName: "You.com" },
  "phind.com": { engine: "other_ai", displayName: "Phind" },
};

export class AiReferrerClassifier {
  /**
   * Classify a web referral source/medium into AI or traditional channels
   */
  static classify(source: string, medium?: string): ClassifiedReferrer {
    const raw = (source || "").toLowerCase().trim();
    const m = (medium || "").toLowerCase().trim();

    let host = raw;
    try {
      if (raw.includes("://") && !raw.startsWith("android-app://")) {
        host = new URL(raw).hostname;
      }
    } catch {
      host = raw;
    }

    // Check direct matching or subdomain match in AI map
    for (const [pattern, entry] of Object.entries(AI_REFERRER_MAP)) {
      if (
        host === pattern ||
        host.endsWith(`.${pattern}`) ||
        raw.includes(pattern) ||
        raw.startsWith(pattern)
      ) {
        return {
          isAiReferral: true,
          aiEngine: entry.engine,
          engineDisplayName: entry.displayName,
          customChannelGroup: "AI Referral",
        };
      }
    }

    // Traditional channel classifications
    if (
      m === "organic" ||
      host.includes("google") ||
      host.includes("bing") ||
      host.includes("yahoo") ||
      host.includes("duckduckgo")
    ) {
      return {
        isAiReferral: false,
        customChannelGroup: "Organic Search",
      };
    }

    if (m === "(none)" || raw === "(direct)" || !raw) {
      return {
        isAiReferral: false,
        customChannelGroup: "Direct",
      };
    }

    if (m.includes("cpc") || m.includes("paid") || m.includes("ppc") || m.includes("ad")) {
      return {
        isAiReferral: false,
        customChannelGroup: "Paid",
      };
    }

    if (m === "referral") {
      return {
        isAiReferral: false,
        customChannelGroup: "Referral",
      };
    }

    return {
      isAiReferral: false,
      customChannelGroup: "Other",
    };
  }

  /**
   * Quick boolean check whether referrer is an AI platform
   */
  static isAiReferral(source: string, medium?: string): boolean {
    return this.classify(source, medium).isAiReferral;
  }

  /**
   * Return formatted human-readable engine label
   */
  static getEngineDisplayName(engine: string): string {
    const labels: Record<string, string> = {
      chatgpt: "ChatGPT",
      gemini: "Google Gemini",
      perplexity: "Perplexity",
      claude: "Claude",
      copilot: "Microsoft Copilot",
      deepseek: "DeepSeek",
      other_ai: "Other AI",
    };
    return labels[engine] || "Other AI";
  }

  /**
   * Mandatory UI disclosure for un-referred AI traffic (TRF-FR-003)
   */
  static getMandatoryDisclosure() {
    return {
      label: "Observed" as const,
      text: "Observed: Some AI traffic arrives without a referrer header and is under-counted in web analytics (TRF-FR-003).",
      requirement: "TRF-FR-003" as const,
    };
  }
}
