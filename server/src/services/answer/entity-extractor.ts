// Entity and Mention Extraction Service (ANS & M5)
// Complies with ANS-FR-001..003, ANS-FR-010, NFR-QUAL-002

export interface EntityTarget {
  id?: string;
  name: string;
  type: "brand" | "competitor";
  domain?: string;
  aliases?: string[];
}

export interface ExtractedMention {
  entityType: "brand" | "competitor";
  entityId?: string;
  entityName: string;
  matchedText: string;
  positionIndex: number; // 1-based order of first mention of distinct entities
  listRank: number | null; // 1-based rank if entity appears in an ordered/ranked list item
  sentiment: number; // -1 (negative), 0 (neutral), 1 (positive)
  confidence: number; // 0.000 to 1.000
  snippet: string;
  reviewStatus: "auto" | "verified" | "false_positive";
  label: "Observed" | "Estimated";
}

interface RawMatch {
  target: EntityTarget;
  matchedText: string;
  start: number;
  end: number;
  isFuzzy: boolean;
}

// Common corporate suffixes stripped for alias generation
const CORPORATE_SUFFIXES = [
  /\binc(?:\.|\b)/gi,
  /\bllc(?:\.|\b)/gi,
  /\bcorp(?:\.|\b)/gi,
  /\bcorporation\b/gi,
  /\bco(?:\.|\b)/gi,
  /\bltd(?:\.|\b)/gi,
  /\btechnologies\b/gi,
  /\bsoftware\b/gi,
  /\bsystems\b/gi,
  /\bgroup\b/gi,
];

// Stop words that should never match as fuzzy or standalone short aliases
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "have",
  "been",
  "will",
  "what",
  "when",
  "where",
  "which",
  "about",
  "into",
  "more",
  "most",
  "some",
  "such",
  "like",
  "best",
  "good",
  "tool",
  "apps",
  "data",
  "site",
  "web",
  "ai",
  "pro",
  "free",
  "open",
  "plus",
  "hub",
  "get",
  "air",
  "box",
  "one",
  "two",
]);

// Sentiment lexicons
const POSITIVE_PATTERNS: { pattern: RegExp; weight: number }[] = [
  {
    pattern: /\b(best|top-rated|top pick|number one|#1|market leader|industry leader)\b/i,
    weight: 1.0,
  },
  {
    pattern: /\b(highly recommended?|standout|outstanding|exceptional|superior|first-rate)\b/i,
    weight: 0.9,
  },
  { pattern: /\b(excellent|superb|favorite|impressive|preferred|ideal choice)\b/i, weight: 0.8 },
  {
    pattern: /\b(effective|reliable|robust|intuitive|seamless|powerful|innovative)\b/i,
    weight: 0.7,
  },
  {
    pattern: /\b(fast|cost-effective|affordable|comprehensive|user-friendly|great)\b/i,
    weight: 0.6,
  },
  { pattern: /\b(pros?:|strengths?:|advantages?:|excels at|wins in)\b/i, weight: 0.7 },
];

const NEGATIVE_PATTERNS: { pattern: RegExp; weight: number }[] = [
  { pattern: /\b(worst|avoid|broken|unusable|terrible|horrible|failing|failed)\b/i, weight: 1.0 },
  { pattern: /\b(not recommended|do not recommend|disappointing|outdated|buggy)\b/i, weight: 0.9 },
  { pattern: /\b(expensive|pricey|overpriced|steep pricing|hidden costs?)\b/i, weight: 0.7 },
  { pattern: /\b(slow|laggy|complex|clunky|unintuitive|steep learning curve)\b/i, weight: 0.7 },
  {
    pattern: /\b(lacks?|limited|lacking|missing|drawbacks?|downsides?|cons?:|weaknesses?:)\b/i,
    weight: 0.7,
  },
  {
    pattern: /\b(poor|complaints|struggles with|vulnerable|unreliable|issues? with)\b/i,
    weight: 0.7,
  },
];

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (Math.abs(a.length - b.length) > 2) return Math.abs(a.length - b.length);

  const v0 = new Array(b.length + 1);
  const v1 = new Array(b.length + 1);

  for (let i = 0; i <= b.length; i++) v0[i] = i;

  for (let i = 0; i < a.length; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < b.length; j++) {
      const cost = a[i].toLowerCase() === b[j].toLowerCase() ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= b.length; j++) v0[j] = v1[j];
  }

  return v0[b.length];
}

/**
 * Generates search phrases for an entity (name, stripped suffixes, aliases, domain).
 */
export function buildEntityAliases(target: EntityTarget): string[] {
  const aliases = new Set<string>();

  const addAlias = (val?: string) => {
    if (!val) return;
    const trimmed = val.trim();
    if (trimmed.length < 2) return;
    if (STOP_WORDS.has(trimmed.toLowerCase())) return;
    aliases.add(trimmed);

    // Stripped suffix variant
    let stripped = trimmed;
    for (const suffix of CORPORATE_SUFFIXES) {
      stripped = stripped.replace(suffix, "").trim();
    }
    if (stripped.length >= 2 && stripped !== trimmed && !STOP_WORDS.has(stripped.toLowerCase())) {
      aliases.add(stripped);
    }
  };

  addAlias(target.name);
  if (target.aliases) {
    for (const a of target.aliases) {
      addAlias(a);
    }
  }
  if (target.domain) {
    const cleanDomain = target.domain
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "")
      .replace(/^www\./i, "");
    if (cleanDomain.length >= 3) {
      aliases.add(cleanDomain);
      const sld = cleanDomain.split(".")[0];
      if (sld && sld.length >= 3 && !STOP_WORDS.has(sld.toLowerCase())) {
        aliases.add(sld);
      }
    }
  }

  return Array.from(aliases).sort((a, b) => b.length - a.length);
}

/**
 * Detects numbered list lines and returns a map of line offsets to list item rank numbers.
 */
function parseNumberedListRanks(text: string): { start: number; end: number; rank: number }[] {
  const lines: { start: number; end: number; rank: number }[] = [];
  const listRegex =
    /(?:^|\n)\s*(?:(\d{1,2})[.)\-:]\s+|#(\d{1,2})\s+)(.*?)(?=(?:\n\s*(?:\d{1,2}[.)\-:]|#\d{1,2})\s+)|\n\n|$)/gis;

  let match: RegExpExecArray | null;
  while ((match = listRegex.exec(text)) !== null) {
    const rankStr = match[1] || match[2];
    const rank = parseInt(rankStr, 10);
    if (!isNaN(rank) && rank >= 1 && rank <= 50) {
      lines.push({
        start: match.index,
        end: match.index + match[0].length,
        rank,
      });
    }
  }

  return lines;
}

/**
 * Extracts a neat context snippet (~120-150 chars) around a match.
 */
function extractSnippet(text: string, start: number, end: number): string {
  const targetSnippetLength = 140;
  const matchLen = end - start;
  const padding = Math.max(20, Math.floor((targetSnippetLength - matchLen) / 2));

  let snippetStart = Math.max(0, start - padding);
  let snippetEnd = Math.min(text.length, end + padding);

  // Expand to word boundaries if possible
  if (snippetStart > 0) {
    const spaceBefore = text.lastIndexOf(" ", snippetStart);
    if (spaceBefore !== -1 && snippetStart - spaceBefore < 15) {
      snippetStart = spaceBefore + 1;
    }
  }
  if (snippetEnd < text.length) {
    const spaceAfter = text.indexOf(" ", snippetEnd);
    if (spaceAfter !== -1 && spaceAfter - snippetEnd < 15) {
      snippetEnd = spaceAfter;
    }
  }

  let snippet = text.slice(snippetStart, snippetEnd).trim().replace(/\s+/g, " ");
  if (snippetStart > 0) snippet = "..." + snippet;
  if (snippetEnd < text.length) snippet = snippet + "...";

  return snippet;
}

/**
 * Analyzes sentiment in the context surrounding an entity mention.
 */
export function classifySentiment(
  contextText: string,
  matchedText: string,
): { sentiment: number; confidence: number } {
  // Extract sentence containing the match or nearby window
  const sentences = contextText.split(/(?<=[.!?\n])\s+/);
  let targetSentence = "";
  for (const s of sentences) {
    if (s.toLowerCase().includes(matchedText.toLowerCase())) {
      targetSentence = s;
      break;
    }
  }
  const windowToAnalyze = (targetSentence || contextText).toLowerCase();

  let positiveScore = 0;
  for (const { pattern, weight } of POSITIVE_PATTERNS) {
    if (pattern.test(windowToAnalyze)) {
      positiveScore += weight;
    }
  }

  let negativeScore = 0;
  for (const { pattern, weight } of NEGATIVE_PATTERNS) {
    if (pattern.test(windowToAnalyze)) {
      negativeScore += weight;
    }
  }

  const negatedPositive =
    /\b(not|never|hardly|no longer)\s+(?:the\s+|very\s+|highly\s+)?(best|good|great|recommended?|reliable|fast|effective|ideal|preferred|favorite)\b/i;
  const negatedNegative =
    /\b(not|never|hardly)\s+(?:very\s+|too\s+)?(expensive|bad|slow|buggy|poor|difficult)\b/i;

  if (negatedPositive.test(windowToAnalyze)) {
    negativeScore += 0.9;
    positiveScore = Math.max(0, positiveScore - 0.8);
  } else if (negatedNegative.test(windowToAnalyze)) {
    positiveScore += 0.4;
    negativeScore = Math.max(0, negativeScore - 0.7);
  }

  const scoreDiff = positiveScore - negativeScore;

  if (scoreDiff >= 0.5) {
    const confidence = Math.min(0.96, Math.max(0.65, 0.65 + scoreDiff * 0.15));
    return { sentiment: 1, confidence: Number(confidence.toFixed(3)) };
  } else if (scoreDiff <= -0.5) {
    const confidence = Math.min(0.96, Math.max(0.65, 0.65 + Math.abs(scoreDiff) * 0.15));
    return { sentiment: -1, confidence: Number(confidence.toFixed(3)) };
  } else {
    // Neutral
    const confidence = positiveScore === 0 && negativeScore === 0 ? 0.85 : 0.62;
    return { sentiment: 0, confidence: Number(confidence.toFixed(3)) };
  }
}

/**
 * Main entity extraction engine.
 * Given answer text and a list of targets (brand + competitors),
 * detects mentions with precision >= 95%, recall >= 90%, calculates position rank,
 * list rank, sentiment, and context snippets.
 */
export function extractEntities(answerText: string, targets: EntityTarget[]): ExtractedMention[] {
  if (!answerText || !targets || targets.length === 0) {
    return [];
  }

  const rawMatches: RawMatch[] = [];
  const listItems = parseNumberedListRanks(answerText);

  for (const target of targets) {
    const aliases = buildEntityAliases(target);

    for (const alias of aliases) {
      // 1. Exact match with word boundary
      const exactRegex = new RegExp(`(?<![a-zA-Z0-9_])${escapeRegex(alias)}(?![a-zA-Z0-9_])`, "gi");
      let m: RegExpExecArray | null;
      while ((m = exactRegex.exec(answerText)) !== null) {
        rawMatches.push({
          target,
          matchedText: m[0],
          start: m.index,
          end: m.index + m[0].length,
          isFuzzy: false,
        });
      }

      // 2. Fuzzy match for names with >= 6 chars (single typo tolerance)
      if (alias.length >= 6 && !alias.includes(" ")) {
        const words = answerText.split(/[^a-zA-Z0-9]/);
        let currentPos = 0;
        for (const word of words) {
          const wordStart = answerText.indexOf(word, currentPos);
          currentPos = wordStart + word.length;
          if (word.length >= 5 && Math.abs(word.length - alias.length) <= 1) {
            if (levenshtein(word.toLowerCase(), alias.toLowerCase()) === 1) {
              // Ensure not already covered
              const alreadyExact = rawMatches.some((rm) => Math.abs(rm.start - wordStart) < 2);
              if (!alreadyExact && !STOP_WORDS.has(word.toLowerCase())) {
                rawMatches.push({
                  target,
                  matchedText: word,
                  start: wordStart,
                  end: wordStart + word.length,
                  isFuzzy: true,
                });
              }
            }
          }
        }
      }
    }
  }

  // Sort matches by start position, then by length descending (longest wins)
  rawMatches.sort((a, b) => a.start - b.start || b.matchedText.length - a.matchedText.length);

  // De-overlap matches (e.g., "HubSpot CRM" over "HubSpot")
  const nonOverlapping: RawMatch[] = [];
  let lastEnd = -1;
  for (const match of rawMatches) {
    if (match.start >= lastEnd) {
      nonOverlapping.push(match);
      lastEnd = match.end;
    }
  }

  // Group by distinct entity target
  // positionIndex is 1-based order of first mention of that distinct entity
  const entityFirstSeen = new Map<string, number>();
  let distinctCounter = 1;

  for (const match of nonOverlapping) {
    const key = `${match.target.type}:${match.target.name}`;
    if (!entityFirstSeen.has(key)) {
      entityFirstSeen.set(key, distinctCounter++);
    }
  }

  // Build final mentions
  const results: ExtractedMention[] = [];

  for (const match of nonOverlapping) {
    const key = `${match.target.type}:${match.target.name}`;
    const positionIndex = entityFirstSeen.get(key) ?? 1;

    // Determine list rank if inside a numbered list item
    let listRank: number | null = null;
    for (const item of listItems) {
      if (match.start >= item.start && match.end <= item.end) {
        listRank = item.rank;
        break;
      }
    }

    const snippet = extractSnippet(answerText, match.start, match.end);
    const { sentiment, confidence } = classifySentiment(snippet, match.matchedText);

    // Confidence threshold per SRS: if < 0.60, mark as Estimated and neutral
    const finalSentiment = confidence >= 0.6 ? sentiment : 0;
    const label: "Observed" | "Estimated" =
      match.isFuzzy || confidence < 0.6 ? "Estimated" : "Observed";

    results.push({
      entityType: match.target.type,
      entityId: match.target.id,
      entityName: match.target.name,
      matchedText: match.matchedText,
      positionIndex,
      listRank,
      sentiment: finalSentiment,
      confidence,
      snippet,
      reviewStatus: "auto",
      label,
    });
  }

  return results;
}
