// Brand Claims and Attributes Extraction Service (ANS-FR-008)
// Extracts brand claims/attributes and groups them by theme, labelled Estimated.

export interface ExtractedClaim {
  entityName: string;
  claimText: string;
  theme: "pricing" | "features" | "location" | "comparisons" | "reputation" | "other";
  sentiment: number; // -1, 0, 1
  confidence: number;
  label: "Estimated";
}

const THEME_PATTERNS: { theme: ExtractedClaim["theme"]; pattern: RegExp }[] = [
  {
    theme: "pricing",
    pattern:
      /\b(\$|€|£|pricing|prices?|cost|costs?|free plan|free tier|subscription|per month|annual|billing|affordable|expensive|tier|quote)\b/i,
  },
  {
    theme: "comparisons",
    pattern:
      /\b(versus|vs\.?|compared to|unlike|better than|alternative to|competitor to|instead of|outperforms|differs from)\b/i,
  },
  {
    theme: "location",
    pattern:
      /\b(headquartered|based in|available in|operates in|regions?|global|worldwide|united states|us|uk|europe|offices?)\b/i,
  },
  {
    theme: "reputation",
    pattern:
      /\b(reputation|market leader|industry leader|trusted by|reviews?|rating|award|recognized|established in)\b/i,
  },
  {
    theme: "features",
    pattern:
      /\b(features?|functionality|integrat(es|ion|ed)|supports?|provides?|offers?|built-in|dashboard|api|analytics|workflows?|automation)\b/i,
  },
];

export function extractBrandClaims(
  answerText: string,
  brandName: string,
  aliases: string[] = [],
): ExtractedClaim[] {
  if (!answerText || !brandName) return [];

  const targets = [brandName, ...aliases].filter(Boolean);
  const sentences = answerText.split(/(?<=[.!?\n])\s+/);
  const claims: ExtractedClaim[] = [];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 15 || trimmed.length > 500) continue;

    // Check if sentence mentions brand
    const mentionsBrand = targets.some((t) => {
      const re = new RegExp(
        `(?<![a-zA-Z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-zA-Z0-9])`,
        "i",
      );
      return re.test(trimmed);
    });

    if (!mentionsBrand) continue;

    // Classify theme
    let matchedTheme: ExtractedClaim["theme"] = "other";
    for (const { theme, pattern } of THEME_PATTERNS) {
      if (pattern.test(trimmed)) {
        matchedTheme = theme;
        break;
      }
    }

    // Determine basic sentiment in claim
    let sentiment = 0;
    if (
      /\b(best|excellent|great|superior|strong|easy|top|leading|affordable|generous)\b/i.test(
        trimmed,
      )
    ) {
      sentiment = 1;
    } else if (
      /\b(expensive|lacks?|limited|poor|difficult|complex|drawback|weakness)\b/i.test(trimmed)
    ) {
      sentiment = -1;
    }

    claims.push({
      entityName: brandName,
      claimText: trimmed,
      theme: matchedTheme,
      sentiment,
      confidence: 0.85,
      label: "Estimated",
    });
  }

  return claims;
}
