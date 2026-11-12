/**
 * CNT-FR-001, CNT-FR-006, CNT-FR-007: Content Clustering & Semantic Similarity Engine
 *
 * Maps owned pages to prompt clusters using vector semantic similarity,
 * flags stale pages targeting high-priority prompts, and detects keyword cannibalization.
 */

export interface TextVector {
  tokens: Map<string, number>;
  magnitude: number;
}

export interface PromptItem {
  id: string;
  body: string;
  priority?: number;
  demandIndex?: number;
}

export interface PageItem {
  id?: string;
  url: string;
  path: string;
  title?: string | null;
  metaDescription?: string | null;
  wordCount?: number;
  lastModified?: string | Date | null;
  isIndexable?: boolean;
}

export interface PromptCluster {
  name: string;
  prompts: PromptItem[];
  vector: TextVector;
}

export interface PageClusterMapping {
  pageUrl: string;
  pagePath: string;
  pageTitle: string;
  mappedPromptIds: string[];
  promptClusters: string[];
  maxSimilarity: number;
  isStale: boolean;
  cannibalizedPromptIds: string[];
}

export interface CannibalizationIssue {
  promptId: string;
  promptText: string;
  competingPages: Array<{ url: string; title: string; similarity: number }>;
  recommendation: string;
}

const STOP_WORDS = new Set([
  "a",
  "about",
  "above",
  "after",
  "again",
  "against",
  "all",
  "am",
  "an",
  "and",
  "any",
  "are",
  "aren't",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "below",
  "between",
  "both",
  "but",
  "by",
  "can",
  "can't",
  "cannot",
  "could",
  "did",
  "do",
  "does",
  "doing",
  "don't",
  "down",
  "during",
  "each",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "having",
  "he",
  "her",
  "here",
  "hers",
  "herself",
  "him",
  "himself",
  "his",
  "how",
  "i",
  "if",
  "in",
  "into",
  "is",
  "isn't",
  "it",
  "it's",
  "its",
  "itself",
  "let's",
  "me",
  "more",
  "most",
  "my",
  "myself",
  "no",
  "nor",
  "not",
  "of",
  "off",
  "on",
  "once",
  "only",
  "or",
  "other",
  "ought",
  "our",
  "ours",
  "ourselves",
  "out",
  "over",
  "own",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "theirs",
  "them",
  "themselves",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "until",
  "up",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "whom",
  "why",
  "with",
  "would",
  "you",
  "your",
  "yours",
  "yourself",
  "yourselves",
]);

export class ContentClusteringEngine {
  /**
   * Tokenizes and converts text into a weighted TF-IDF vector with character n-grams
   */
  vectorize(text: string): TextVector {
    const tokens = new Map<string, number>();
    if (!text || !text.trim()) {
      return { tokens, magnitude: 0 };
    }

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s-_]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w));

    for (const w of words) {
      // Unigram (primary semantic carrier)
      tokens.set(w, (tokens.get(w) || 0) + 4.0);

      // Character trigrams for typo-tolerant / stemming similarity
      if (w.length >= 4) {
        for (let i = 0; i <= w.length - 3; i++) {
          const tri = `_${w.slice(i, i + 3)}`;
          tokens.set(tri, (tokens.get(tri) || 0) + 0.2);
        }
      }
    }

    // Bigrams for key phrases
    for (let i = 0; i < words.length - 1; i++) {
      const bi = `${words[i]}_${words[i + 1]}`;
      tokens.set(bi, (tokens.get(bi) || 0) + 1.0);
    }

    // Compute vector magnitude
    let sumSquares = 0;
    for (const weight of tokens.values()) {
      sumSquares += weight * weight;
    }
    const magnitude = Math.sqrt(sumSquares);

    return { tokens, magnitude };
  }

  /**
   * Cosine similarity between two text vectors (0.0 to 1.0)
   */
  cosineSimilarity(v1: TextVector, v2: TextVector): number {
    if (v1.magnitude === 0 || v2.magnitude === 0) return 0;

    let dotProduct = 0;
    // Iterate over the smaller map for efficiency
    const [smaller, larger] =
      v1.tokens.size < v2.tokens.size ? [v1.tokens, v2.tokens] : [v2.tokens, v1.tokens];

    for (const [term, weight] of smaller.entries()) {
      const otherWeight = larger.get(term);
      if (otherWeight) {
        dotProduct += weight * otherWeight;
      }
    }

    const similarity = dotProduct / (v1.magnitude * v2.magnitude);
    return Math.max(0, Math.min(1, similarity));
  }

  /**
   * Groups a set of prompts into semantic clusters
   */
  clusterPrompts(prompts: PromptItem[], threshold = 0.4): PromptCluster[] {
    const clusters: PromptCluster[] = [];

    for (const p of prompts) {
      const pVector = this.vectorize(p.body);
      let bestCluster: PromptCluster | null = null;
      let highestSim = 0;

      for (const c of clusters) {
        const sim = this.cosineSimilarity(pVector, c.vector);
        if (sim > highestSim && sim >= threshold) {
          highestSim = sim;
          bestCluster = c;
        }
      }

      if (bestCluster) {
        bestCluster.prompts.push(p);
        // Update centroid vector
        for (const [k, v] of pVector.tokens) {
          bestCluster.vector.tokens.set(k, (bestCluster.vector.tokens.get(k) || 0) + v);
        }
        let sumSq = 0;
        for (const w of bestCluster.vector.tokens.values()) sumSq += w * w;
        bestCluster.vector.magnitude = Math.sqrt(sumSq);
      } else {
        // Create new cluster named after the most prominent phrase in prompt
        const clusterName = this.inferClusterName(p.body);
        clusters.push({
          name: clusterName,
          prompts: [p],
          vector: pVector,
        });
      }
    }

    return clusters;
  }

  /**
   * Maps crawled pages to prompts and clusters, identifying stale pages and cannibalization
   */
  mapPagesToPrompts(
    pages: PageItem[],
    prompts: PromptItem[],
    options: {
      similarityThreshold?: number;
      staleThresholdDays?: number;
      cannibalizationThreshold?: number;
    } = {},
  ): {
    mappings: PageClusterMapping[];
    cannibalizationIssues: CannibalizationIssue[];
  } {
    const similarityThreshold = options.similarityThreshold ?? 0.45;
    const staleThresholdDays = options.staleThresholdDays ?? 90;
    const cannibalizationThreshold = options.cannibalizationThreshold ?? 0.6;

    const clusters = this.clusterPrompts(prompts);
    const promptVectors = new Map<string, TextVector>();
    for (const p of prompts) {
      promptVectors.set(p.id, this.vectorize(p.body));
    }

    // Track which pages match each prompt for cannibalization detection
    const promptToPages = new Map<
      string,
      Array<{ url: string; title: string; similarity: number }>
    >();

    const now = Date.now();
    const staleCutoff = now - staleThresholdDays * 24 * 60 * 60 * 1000;

    const mappings: PageClusterMapping[] = [];

    for (const page of pages) {
      const pageText = `${page.title || ""} ${page.path} ${page.metaDescription || ""}`.trim();
      const pageVector = this.vectorize(pageText);

      const matchedPromptIds: string[] = [];
      const matchedClusters = new Set<string>();
      let maxSim = 0;

      // Check similarity against each prompt
      for (const p of prompts) {
        const pVec = promptVectors.get(p.id)!;
        const sim = this.cosineSimilarity(pageVector, pVec);

        if (sim >= similarityThreshold) {
          matchedPromptIds.push(p.id);
          if (sim > maxSim) maxSim = sim;

          // Track for cannibalization
          const list = promptToPages.get(p.id) || [];
          list.push({
            url: page.url,
            title: page.title || page.path,
            similarity: sim,
          });
          promptToPages.set(p.id, list);
        }
      }

      // Check similarity against clusters
      for (const c of clusters) {
        const cSim = this.cosineSimilarity(pageVector, c.vector);
        if (cSim >= similarityThreshold) {
          matchedClusters.add(c.name);
        }
      }

      // Check staleness (CNT-FR-006): last modified > staleCutoff and targets prompt
      let isStale = false;
      if (page.lastModified) {
        const lastModTime = new Date(page.lastModified).getTime();
        if (lastModTime < staleCutoff && matchedPromptIds.length > 0) {
          isStale = true;
        }
      }

      mappings.push({
        pageUrl: page.url,
        pagePath: page.path,
        pageTitle: page.title || page.path,
        mappedPromptIds: matchedPromptIds,
        promptClusters: Array.from(matchedClusters),
        maxSimilarity: Math.round(maxSim * 10000) / 10000,
        isStale,
        cannibalizedPromptIds: [],
      });
    }

    // Detect Cannibalization (CNT-FR-007)
    const cannibalizationIssues: CannibalizationIssue[] = [];

    for (const [promptId, matchedList] of promptToPages.entries()) {
      // If 2 or more owned pages match this prompt with high similarity
      const strongMatches = matchedList.filter((m) => m.similarity >= cannibalizationThreshold);
      if (strongMatches.length >= 2) {
        const prompt = prompts.find((p) => p.id === promptId);
        const promptText = prompt ? prompt.body : "Prompt";

        cannibalizationIssues.push({
          promptId,
          promptText,
          competingPages: strongMatches,
          recommendation: `Consolidate or differentiate '${strongMatches[0]!.title}' and '${strongMatches[1]!.title}'. Designate one canonical landing page for this search topic to prevent AI answer dilution.`,
        });

        // Mark on mappings
        for (const m of mappings) {
          if (strongMatches.some((sm) => sm.url === m.pageUrl)) {
            if (!m.cannibalizedPromptIds.includes(promptId)) {
              m.cannibalizedPromptIds.push(promptId);
            }
          }
        }
      }
    }

    return { mappings, cannibalizationIssues };
  }

  private inferClusterName(promptBody: string): string {
    const cleaned = promptBody
      .replace(/^(what|who|where|how|why|which|can|best|top|is|are|does)\s+/i, "")
      .replace(/[?.,!]/g, "")
      .trim();

    const words = cleaned.split(/\s+/).slice(0, 4);
    if (words.length === 0) return "General";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
  }
}
