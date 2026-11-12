// Normative Statistical Functions for AI Visibility Analytics (M3 & VIS)
// SRS Section 9 & Requirements VIS-FR-001 to VIS-FR-011

export interface WilsonInterval {
  low: number;
  high: number;
}

export type ConfidenceTier = "adequate" | "low_confidence" | "insufficient";

export interface ConfidenceEvaluation {
  tier: ConfidenceTier;
  label: string;
  displayable: boolean;
  n: number;
}

export type GradeBand = "A" | "B" | "C" | "D" | "F";

export interface ZTestResult {
  z: number;
  pValue: number;
  significant: boolean;
  delta: number;
}

export interface AnomalyCandidate {
  id: string;
  metric: string;
  entityName: string;
  engine: string;
  currentValue: number;
  previousValue: number;
  currentN: number;
  previousN: number;
  delta: number;
  pValue: number;
  qValue?: number;
  significant: boolean;
}

/**
 * Normal Error Function (erf) approximation via Abramowitz and Stegun 7.1.26
 * Maximum error < 1.5e-7
 */
export function erf(x: number): number {
  const sign = x >= 0 ? 1 : -1;
  const absX = Math.abs(x);

  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const t = 1.0 / (1.0 + p * absX);
  const poly = ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t;
  const y = 1.0 - poly * Math.exp(-absX * absX);

  return sign * y;
}

/**
 * Standard Normal Cumulative Distribution Function Phi(z)
 */
export function standardNormalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Wilson Score Confidence Interval for proportions (e.g. Visibility Rate, Citation Rate)
 * 95% confidence (z = 1.95996)
 */
export function calculateWilsonInterval(
  successes: number,
  trials: number,
  confidenceLevel: number = 0.95,
): WilsonInterval {
  if (trials <= 0) {
    return { low: 0, high: 0 };
  }

  const p = Math.max(0, Math.min(1, successes / trials));
  // 95% default z = 1.95996398454
  const z = confidenceLevel === 0.99 ? 2.575829 : confidenceLevel === 0.9 ? 1.644853 : 1.959964;

  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const center = (p + z2 / (2 * trials)) / denominator;
  const varianceTerm = (p * (1 - p)) / trials + z2 / (4 * trials * trials);
  const halfWidth = (z * Math.sqrt(varianceTerm)) / denominator;

  const low = Math.max(0, Number((center - halfWidth).toFixed(4)));
  const high = Math.min(1, Number((center + halfWidth).toFixed(4)));

  return { low, high };
}

/**
 * Minimum Sample Size Evaluation (SRS Section 9.2)
 * n >= 5: Adequate confidence
 * 3 <= n < 5: Low confidence (badge/alert required)
 * n < 3: Insufficient data (suppress numeric presentation)
 */
export function evaluateConfidence(n: number): ConfidenceEvaluation {
  if (n < 3) {
    return {
      tier: "insufficient",
      label: "Insufficient data",
      displayable: false,
      n,
    };
  }
  if (n < 5) {
    return {
      tier: "low_confidence",
      label: "Low confidence",
      displayable: true,
      n,
    };
  }
  return {
    tier: "adequate",
    label: "High confidence",
    displayable: true,
    n,
  };
}

/**
 * Two-proportion z-test for comparing rates across time windows or engines.
 * Two-sided hypothesis: H0: p1 = p2, H1: p1 != p2
 */
export function calculateTwoProportionZTest(
  x1: number,
  n1: number,
  x2: number,
  n2: number,
): ZTestResult {
  if (n1 <= 0 || n2 <= 0) {
    return { z: 0, pValue: 1.0, significant: false, delta: 0 };
  }

  const p1 = x1 / n1;
  const p2 = x2 / n2;
  const delta = Number((p1 - p2).toFixed(4));

  const pPooled = (x1 + x2) / (n1 + n2);
  if (pPooled <= 0 || pPooled >= 1) {
    return { z: 0, pValue: 1.0, significant: false, delta };
  }

  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) {
    return { z: 0, pValue: 1.0, significant: false, delta };
  }

  const z = (p1 - p2) / se;
  const pValue = Number((2 * (1 - standardNormalCdf(Math.abs(z)))).toFixed(6));
  const significant = pValue < 0.05;

  return {
    z: Number(z.toFixed(4)),
    pValue,
    significant,
    delta,
  };
}

/**
 * Benjamini-Hochberg False Discovery Rate (FDR) Procedure (SRS Section 9.2 & VIS-FR-008)
 * Controls false discovery rate at q = 0.05 across multiple simultaneous hypothesis tests
 */
export function applyBenjaminiHochberg(
  candidates: AnomalyCandidate[],
  fdrQ: number = 0.05,
): AnomalyCandidate[] {
  if (candidates.length === 0) return [];

  // Sort ascending by p-value
  const indexed = candidates.map((item, originalIndex) => ({
    item,
    originalIndex,
  }));

  indexed.sort((a, b) => a.item.pValue - b.item.pValue);

  const m = indexed.length;
  // Calculate critical values and find largest k where p(k) <= (k / m) * q
  let maxSignificantRank = -1;
  for (let i = 0; i < m; i++) {
    const rank = i + 1; // 1-indexed
    const criticalValue = (rank / m) * fdrQ;
    if (indexed[i].item.pValue <= criticalValue) {
      maxSignificantRank = i;
    }
  }

  // Calculate adjusted p-values (q-values)
  // q_(i) = min_{j >= i} ( (m / j) * p_(j) )
  const qValues: number[] = new Array(m);
  let minCumulative = 1.0;
  for (let i = m - 1; i >= 0; i--) {
    const rank = i + 1;
    const rawQ = (m / rank) * indexed[i].item.pValue;
    minCumulative = Math.min(minCumulative, rawQ);
    qValues[i] = Number(Math.max(0, Math.min(1, minCumulative)).toFixed(6));
  }

  const result: AnomalyCandidate[] = new Array(m);
  for (let i = 0; i < m; i++) {
    const isSig = i <= maxSignificantRank && indexed[i].item.pValue < 0.05;
    const entry: AnomalyCandidate = {
      ...indexed[i].item,
      qValue: qValues[i],
      significant: isSig,
    };
    result[indexed[i].originalIndex] = entry;
  }

  return result;
}

/**
 * Grade Band Assignment (SRS Section 9.1 & VIS-FR-007)
 * A: 85-100, B: 70-84, C: 55-69, D: 40-54, F: < 40
 */
export function assignGradeBand(score: number): GradeBand {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

/**
 * Normative Composite AI Visibility Score (0-100) (SRS Section 9.1)
 * Score = 100 * (
 *   0.45 * V +
 *   0.20 * min(1, SoV / FairShare) +
 *   0.15 * PositionScore +
 *   0.10 * SentimentScore +
 *   0.10 * CitationRate
 * )
 */
export function calculateCompositeScore(params: {
  visibilityRate: number; // [0, 1]
  shareOfVoice: number; // [0, 1]
  competitorCount: number; // >= 0
  positionScore: number; // [0, 1]
  sentimentScore: number; // [0, 1]
  citationRate: number; // [0, 1]
}): { score: number; grade: GradeBand; fairShare: number; sovRatio: number } {
  const v = Math.max(0, Math.min(1, params.visibilityRate));
  const sov = Math.max(0, Math.min(1, params.shareOfVoice));
  const fairShare = 1 / (1 + Math.max(0, params.competitorCount));
  const sovRatio = fairShare > 0 ? Math.min(1, sov / fairShare) : 0;
  const pos = Math.max(0, Math.min(1, params.positionScore));
  const sent = Math.max(0, Math.min(1, params.sentimentScore));
  const cr = Math.max(0, Math.min(1, params.citationRate));

  const weightedSum = 0.45 * v + 0.2 * sovRatio + 0.15 * pos + 0.1 * sent + 0.1 * cr;

  const rawScore = weightedSum * 100;
  const score = Number(Math.max(0, Math.min(100, rawScore)).toFixed(2));
  const grade = assignGradeBand(score);

  return {
    score,
    grade,
    fairShare: Number(fairShare.toFixed(4)),
    sovRatio: Number(sovRatio.toFixed(4)),
  };
}

/**
 * 7-Day Rolling Average Calculator for chronological data series (VIS-FR-010)
 */
export interface TimeSeriesPoint {
  date: string; // YYYY-MM-DD
  value: number;
  n?: number;
  rollingAvg?: number;
}

export function calculateRollingAverage(
  series: TimeSeriesPoint[],
  windowDays: number = 7,
): TimeSeriesPoint[] {
  if (series.length === 0) return [];

  // Sort by date ascending
  const sorted = [...series].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  return sorted.map((current) => {
    const currentDate = new Date(current.date).getTime();
    const windowStart = currentDate - (windowDays - 1) * 24 * 60 * 60 * 1000;

    // Filter points in window [windowStart, currentDate]
    const windowPoints = sorted.filter((p) => {
      const pTime = new Date(p.date).getTime();
      return pTime >= windowStart && pTime <= currentDate;
    });

    const sum = windowPoints.reduce((acc, p) => acc + p.value, 0);
    const avg = windowPoints.length > 0 ? sum / windowPoints.length : current.value;

    return {
      ...current,
      rollingAvg: Number(avg.toFixed(4)),
    };
  });
}
