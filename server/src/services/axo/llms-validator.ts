/**
 * AXO-FR-001, AXO-FR-002: LLMS.txt & LLMS-Full.txt Validator
 *
 * Validates /llms.txt structure against the official specification:
 * 1. Title (# Heading 1)
 * 2. Summary Blockquote (> Description)
 * 3. Categorized Sections (## Heading 2)
 * 4. Markdown links (- [Title](URL): Description)
 * 5. Link accessibility & Agent Readability Score (0-100)
 */

export interface LlmsLinkItem {
  title: string;
  url: string;
  description?: string;
  isInternal: boolean;
  statusCode?: number;
  error?: string;
}

export interface LlmsSectionItem {
  title: string;
  linkCount: number;
  links: LlmsLinkItem[];
}

export interface LlmsValidationIssue {
  severity: "critical" | "high" | "medium" | "low" | "info";
  code: string;
  message: string;
  line?: number;
}

export interface LlmsValidationResult {
  score: number; // 0 - 100
  status: "valid" | "warning" | "error" | "missing";
  title: string | null;
  summary: string | null;
  sections: LlmsSectionItem[];
  totalLinks: number;
  internalLinksCount: number;
  externalLinksCount: number;
  brokenLinksCount: number;
  byteLength: number;
  lineCount: number;
  issues: LlmsValidationIssue[];
}

export class LlmsValidator {
  /**
   * Validate /llms.txt or /llms-full.txt content
   */
  validate(content: string, baseDomain?: string): LlmsValidationResult {
    const issues: LlmsValidationIssue[] = [];

    if (!content || !content.trim()) {
      return {
        score: 0,
        status: "missing",
        title: null,
        summary: null,
        sections: [],
        totalLinks: 0,
        internalLinksCount: 0,
        externalLinksCount: 0,
        brokenLinksCount: 0,
        byteLength: 0,
        lineCount: 0,
        issues: [
          {
            severity: "critical",
            code: "LLMS_EMPTY",
            message: "The llms.txt file is empty or could not be found.",
          },
        ],
      };
    }

    const lines = content.split(/\r?\n/);
    const lineCount = lines.length;
    const byteLength = Buffer.byteLength(content, "utf8");

    let title: string | null = null;
    let summary: string | null = null;
    const sections: LlmsSectionItem[] = [];
    let currentSection: LlmsSectionItem = { title: "Overview", linkCount: 0, links: [] };

    const summaryLines: string[] = [];

    let brokenLinksCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim();
      const lineNum = i + 1;

      if (!line) {
        continue;
      }

      // Check H1 Title
      if (line.startsWith("# ") && !line.startsWith("## ")) {
        if (!title) {
          title = line.slice(2).trim();
        } else {
          issues.push({
            severity: "low",
            code: "MULTIPLE_H1",
            message: `Multiple H1 titles found (line ${lineNum}). A single H1 is recommended for llms.txt.`,
            line: lineNum,
          });
        }
        continue;
      }

      // Check Blockquote Summary
      if (line.startsWith(">")) {
        summaryLines.push(line.replace(/^>\s*/, "").trim());
        continue;
      }

      // Check H2 Section
      if (line.startsWith("## ")) {
        if (currentSection.links.length > 0 || currentSection.title !== "Overview") {
          sections.push(currentSection);
        }
        currentSection = {
          title: line.slice(3).trim(),
          linkCount: 0,
          links: [],
        };
        continue;
      }

      // Check Link list item: - [Title](URL): Description
      const linkMatch = line.match(/^[-*]\s+\[([^\]]+)\]\(([^)]+)\)(?::\s*(.+))?$/);
      if (linkMatch && linkMatch[1] && linkMatch[2]) {
        const linkTitle = linkMatch[1].trim();
        const linkUrl = linkMatch[2].trim();
        const linkDesc = linkMatch[3]?.trim();

        const isInternal = this.isInternalUrl(linkUrl, baseDomain);

        let isMalformed = false;
        if (!linkUrl.startsWith("/") && !linkUrl.startsWith("#")) {
          try {
            const parsed = new URL(linkUrl);
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
              isMalformed = true;
            }
          } catch {
            isMalformed = true;
          }
        }

        if (isMalformed) {
          brokenLinksCount++;
          issues.push({
            severity: "high",
            code: "INVALID_URL",
            message: `Invalid or unparseable URL '${linkUrl}' on line ${lineNum}.`,
            line: lineNum,
          });
        }

        currentSection.links.push({
          title: linkTitle,
          url: linkUrl,
          description: linkDesc,
          isInternal,
          error: isMalformed ? "Malformed URL" : undefined,
        });
        currentSection.linkCount++;
        continue;
      }

      // Check if line contains a link but was improperly formatted
      if (line.includes("http://") || line.includes("https://")) {
        if (!line.startsWith("- [") && !line.startsWith("* [")) {
          issues.push({
            severity: "medium",
            code: "UNSTRUCTURED_LINK",
            message: `URL on line ${lineNum} is not formatted as standard markdown list item '- [Title](url): description'.`,
            line: lineNum,
          });
        }
      }
    }

    if (currentSection.links.length > 0 || sections.length === 0) {
      sections.push(currentSection);
    }

    if (summaryLines.length > 0) {
      summary = summaryLines.join(" ");
    }

    // Scoring & Specification Compliance Checks
    let score = 100;

    // 1. Title verification (20 pts)
    if (!title) {
      score -= 20;
      issues.push({
        severity: "critical",
        code: "MISSING_TITLE",
        message: "Missing top-level '# Project/Brand Name' heading.",
      });
    }

    // 2. Summary blockquote verification (20 pts)
    if (!summary) {
      score -= 20;
      issues.push({
        severity: "high",
        code: "MISSING_SUMMARY",
        message: "Missing summary blockquote '> Description of project' under the title.",
      });
    } else if (summary.length < 20) {
      score -= 5;
      issues.push({
        severity: "low",
        code: "SHORT_SUMMARY",
        message:
          "Summary blockquote is very short. Provide 1-2 clear sentences summarizing the domain.",
      });
    }

    // 3. Sections structure verification (20 pts)
    if (sections.length <= 1 && sections[0]?.title === "Overview") {
      score -= 15;
      issues.push({
        severity: "medium",
        code: "NO_SECTIONS",
        message:
          "No '## Section Name' headings found. Organize links into categories (e.g. Products, Docs, APIs).",
      });
    }

    // 4. Link count & descriptions (20 pts)
    const allLinks = sections.flatMap((s) => s.links);
    const totalLinks = allLinks.length;
    const internalLinksCount = allLinks.filter((l) => l.isInternal).length;
    const externalLinksCount = totalLinks - internalLinksCount;

    if (totalLinks === 0) {
      score -= 25;
      issues.push({
        severity: "critical",
        code: "NO_LINKS",
        message:
          "No markdown links found in llms.txt. It should provide curated links for LLM agents.",
      });
    } else {
      const linksWithDesc = allLinks.filter((l) => Boolean(l.description)).length;
      const descRatio = linksWithDesc / totalLinks;
      if (descRatio < 0.5) {
        score -= 10;
        issues.push({
          severity: "low",
          code: "MISSING_LINK_DESCRIPTIONS",
          message: `${Math.round((1 - descRatio) * 100)}% of links lack concise descriptions (e.g. '- [Title](url): Brief summary').`,
        });
      }
    }

    // 5. File size checks (10 pts)
    if (byteLength > 100 * 1024) {
      score -= 10;
      issues.push({
        severity: "medium",
        code: "FILE_TOO_LARGE",
        message: `File size is ${(byteLength / 1024).toFixed(1)}KB. Core /llms.txt should remain under 50KB. Use /llms-full.txt for comprehensive data.`,
      });
    }

    if (brokenLinksCount > 0) {
      score -= Math.min(30, brokenLinksCount * 10);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    let status: LlmsValidationResult["status"] = "valid";
    if (score < 50 || issues.some((i) => i.severity === "critical")) {
      status = "error";
    } else if (score < 85 || issues.some((i) => i.severity === "high" || i.severity === "medium")) {
      status = "warning";
    }

    return {
      score,
      status,
      title,
      summary,
      sections,
      totalLinks,
      internalLinksCount,
      externalLinksCount,
      brokenLinksCount,
      byteLength,
      lineCount,
      issues,
    };
  }

  private isInternalUrl(urlStr: string, baseDomain?: string): boolean {
    if (urlStr.startsWith("/") || urlStr.startsWith("#")) return true;
    if (!baseDomain) return false;

    try {
      const cleanBase = baseDomain
        .replace(/^https?:\/\//i, "")
        .replace(/\/.*$/, "")
        .toLowerCase();
      const parsed = new URL(urlStr);
      return parsed.hostname === cleanBase || parsed.hostname.endsWith(`.${cleanBase}`);
    } catch {
      return false;
    }
  }
}
