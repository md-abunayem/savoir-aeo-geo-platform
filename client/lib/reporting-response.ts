import type { ExecutiveDashboardData, ReportSchedule } from "./types";

export type ExecutiveDashboardResponse = {
  dateWindowDays: number;
  kpis: {
    readinessIndex: number;
    readinessRating: ExecutiveDashboardData["summary"]["readinessClassification"];
    visibilityScore: number;
    totalBrandCitations: number;
    technicalAeoScore: number;
    contentCoveragePercent: number;
    conversionMultiplier: number;
    verifiedFixesRate: number;
    totalPromptsMonitored?: number;
    activeIncidentsCount?: number;
    criticalIncidentsCount?: number;
  };
  keyWins: string[];
  criticalRisks: string[];
  disclosures: { modeledFormulas: string };
};

/** Keep the existing presentation while reading the reporting API's actual contract. */
export function reportingDashboard(response: ExecutiveDashboardResponse): ExecutiveDashboardData {
  const kpis = response.kpis;
  const pillars = [
    { id: "visibility", title: "Visibility", weightPercent: 30, score: kpis.visibilityScore },
    { id: "citations", title: "Citations", weightPercent: 20, score: Math.min(100, kpis.totalBrandCitations * 3.5) },
    { id: "technical", title: "Technical AEO", weightPercent: 15, score: kpis.technicalAeoScore },
    { id: "content", title: "Content", weightPercent: 15, score: kpis.contentCoveragePercent },
    { id: "traffic", title: "AI Traffic", weightPercent: 10, score: Math.min(100, kpis.conversionMultiplier * 25) },
    { id: "actions", title: "Action Velocity", weightPercent: 10, score: kpis.verifiedFixesRate },
  ];
  return {
    periodDays: response.dateWindowDays,
    summary: {
      aeoReadinessIndex: kpis.readinessIndex,
      readinessClassification: kpis.readinessRating,
      visibilityShare: kpis.visibilityScore,
      citationShare: pillars[1].score,
      technicalAeoScore: kpis.technicalAeoScore,
      contentCoverage: kpis.contentCoveragePercent,
      aiTrafficShare: pillars[4].score,
      actionVelocity: kpis.verifiedFixesRate,
      totalPromptsMonitored: kpis.totalPromptsMonitored ?? 0,
      activeIncidentsCount: kpis.activeIncidentsCount ?? 0,
      criticalIncidentsCount: kpis.criticalIncidentsCount ?? 0,
    },
    pillarBreakdown: pillars.map((pillar) => ({
      ...pillar,
      status: pillar.score >= 70 ? "healthy" : pillar.score >= 40 ? "warning" : "critical",
      detail: `${pillar.title} contribution to executive readiness.`,
    })),
    keyWins: response.keyWins,
    criticalRisks: response.criticalRisks,
    metricLabels: {
      observedMetrics: ["Citations", "AI traffic", "Action completion"],
      modeledMetrics: ["Visibility", "Technical score", "Executive readiness"],
      disclosure: response.disclosures.modeledFormulas,
    },
  };
}

export function reportingSchedule(
  response: Omit<ReportSchedule, "title" | "cadence"> & { name: string; frequency: ReportSchedule["cadence"] },
): ReportSchedule {
  return { ...response, title: response.name, cadence: response.frequency };
}
