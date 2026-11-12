"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Sparkles } from "lucide-react";
import { api } from "../lib/api";
import type { Project, VisibilityOverviewResponse, TrendPointItem, ActionItemRecord, MetricValueItem } from "../lib/types";

export function OverviewDashboard({ project }: { project: Project }) {
  const [days, setDays] = useState("7");
  const [engine, setEngine] = useState("all");
  return <section className="overview-dashboard" aria-label="AI search overview">
    <div className="overview-filters">
      <div className="actions">
        <label>Period<select aria-label="Period" value={days} onChange={e => setDays(e.target.value)}>{[7, 14, 30, 90].map(n => <option key={n} value={n}>Last {n} days</option>)}</select></label>
        <label>Engine<select aria-label="Engine" value={engine} onChange={e => setEngine(e.target.value)}><option value="all">All engines</option><option value="openai">ChatGPT</option><option value="gemini">Gemini</option><option value="google_ai_overviews">AI Overviews</option><option value="google_ai_mode">AI Mode</option><option value="openrouter">OpenRouter / GPT-6 Luna</option></select></label>
      </div>
      <a href="#methodology" className="text-link">How we measure ↗</a>
    </div>
    <OverviewResults key={`${project.id}:${days}:${engine}`} project={project} days={days} engine={engine} />
  </section>;
}

function OverviewResults({ project, days, engine }: { project: Project; days: string; engine: string }) {
  const [overview, setOverview] = useState<VisibilityOverviewResponse | null>(null);
  const [points, setPoints] = useState<TrendPointItem[]>([]);
  const [actions, setActions] = useState<ActionItemRecord[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const base = `/v1/tenants/${project.tenantId}/projects/${project.id}`;
    const query = new URLSearchParams({ days, engine });
    Promise.allSettled([
      api.request<VisibilityOverviewResponse>(`${base}/visibility?${query}`),
      api.request<{ points: TrendPointItem[] }>(`${base}/visibility/trend?${query}`),
      api.request<{ items: ActionItemRecord[] }>(`${base}/actions?sortBy=priority&status=todo&limit=3`),
    ]).then(([summary, trend, tasks]) => {
      if (cancelled) return;
      setOverview(summary.status === "fulfilled" ? summary.value : null);
      setPoints(trend.status === "fulfilled" ? trend.value.points : []);
      setActions(tasks.status === "fulfilled" ? tasks.value.items.slice(0, 3) : []);
      setErrors([summary.status === "rejected" ? "Visibility metrics" : "", trend.status === "rejected" ? "Visibility trend" : "", tasks.status === "rejected" ? "Recommended actions" : ""].filter(Boolean));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [project.id, project.tenantId, days, engine, retry]);

  if (loading) return <div className="stats" role="status" aria-label="Loading overview">{[1, 2, 3, 4].map(n => <div className="metric overview-skeleton" key={n}><span /><span /><span /></div>)}</div>;
  const percent = (metric: MetricValueItem) => metric.displayable ? `${(metric.value * 100).toFixed(1)}%` : "—";
  return <>
    {errors.length > 0 && <div className="error-banner" role="alert"><span>{errors.join(", ")} unavailable. Other workspace data remains available.</span><button className="text-button" onClick={() => { setLoading(true); setRetry(n => n + 1); }}>Retry overview</button></div>}
    <div className="stats">
      <SummaryMetric primary label="AI Visibility Score" value={overview && overview.metrics.visibilityRate.displayable ? `${overview.composite.score}` : "—"} tag="Modeled" note={overview && overview.metrics.visibilityRate.displayable ? `Grade ${overview.composite.grade} · View breakdown ↗` : "Not enough evidence yet"} />
      <SummaryMetric label="Visibility rate" value={overview ? percent(overview.metrics.visibilityRate) : "—"} tag="Observed" note={overview ? `n = ${overview.metrics.visibilityRate.n} · ${overview.metrics.visibilityRate.confidenceLabel}` : "Awaiting collected evidence"} />
      <SummaryMetric label="Share of Voice" value={overview ? percent(overview.metrics.shareOfVoice) : "—"} tag="Modeled" note={overview ? `Across ${overview.competitors.length + 1} tracked brands` : "Awaiting collected evidence"} />
      <SummaryMetric label="Brand citation rate" value={overview ? percent(overview.metrics.citationRate) : "—"} tag="Observed" note={overview ? `${overview.sampleSummary.brandCitedRuns} / ${overview.sampleSummary.runsWithCitations} cited runs` : "Awaiting collected evidence"} />
    </div>
    <div className="two-col overview-charts">
      <section className="panel">
        <div className="panel-head"><div><h2>Visibility over time</h2><p>Observed · daily visibility across sampled answers</p></div><span className="pill">{days} days</span></div>
        <div className="overview-chart-body">
          {errors.includes("Visibility trend") ? <p className="overview-empty">The trend could not be loaded. Retry to retrieve your observations.</p> : points.some(p => p.sampleSize >= 3) ? <TrendChart points={points} /> : <div className="overview-empty"><h3>Your visibility story starts with evidence.</h3><p>At least three valid observations per day are needed to display a trend.</p><Link className="text-link" href="/monitoring">Set up monitoring <ArrowRight size={14} /></Link></div>}
          <div className="overview-chart-footer"><span><i />{project.brandName}</span><Link className="text-link" href="/visibility">Explore analytics ↗</Link></div>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Performance by engine</h2><p>Observed · collected answer samples</p></div><Link className="text-link" href="/visibility">Details ↗</Link></div>
        <div className="overview-engine-list">{overview?.engines.length ? overview.engines.map(item => <div className="overview-engine" key={item.engine}>
          <span className="overview-engine-icon">{item.name.slice(0, 1)}</span><div><b>{item.name}</b><small>n = {item.n} valid runs{item.n >= 3 && item.n < 5 ? " · Low confidence" : ""}</small></div><strong>{item.n >= 3 ? `${(item.visibilityRate * 100).toFixed(1)}%` : "—"}</strong>
          <div className="overview-meter"><span style={{ width: `${item.n >= 3 ? Math.max(0, Math.min(100, item.visibilityRate * 100)) : 0}%` }} /></div>
        </div>) : <p className="overview-empty">Engine performance appears after valid answers are collected.</p>}<p className="overview-disclosure">Results describe controlled samples, not every user’s experience.</p></div>
      </section>
    </div>
    <div className="insight"><span className="icon-tile"><Sparkles size={22} /></span><div><h3>Your next opportunity is in the sources.</h3><p>Explore the publications AI cites and find gaps in your brand’s coverage.</p></div><Link className="button" href="/citations">Explore citation gaps <ArrowRight size={14} /></Link></div>
    <section className="panel overview-actions"><div className="panel-head"><div><h2>Your next best actions</h2><p>Prioritized opportunities · source evidence included</p></div><Link className="text-link" href="/actions">All actions ↗</Link></div>
      {actions.length ? <div className="table-wrap"><table><thead><tr><th>Opportunity</th><th>Source</th><th>Priority</th><th>Effort</th><th>Details</th></tr></thead><tbody>{actions.map(action => <tr key={action.id}><td><b>{action.title}</b><small>{action.evidence.length} evidence sources</small></td><td><span className="pill">{action.category}</span></td><td><span className="pill status-queued">{action.priorityScore}</span></td><td>{action.effort}</td><td><Link className="text-link" href="/actions">Review →</Link></td></tr>)}</tbody></table></div> : <p className="table-empty">{errors.includes("Recommended actions") ? "Actions could not be loaded. Retry above or open the action center." : "No open recommendations yet. Visit the action center to gather findings from your audits and citations."}</p>}
    </section>
  </>;
}

function SummaryMetric({ label, value, tag, note, primary = false }: { label: string; value: string; tag: string; note: string; primary?: boolean }) {
  const score = value === "—" ? 0 : Math.min(100, Math.max(0, Number(value)));
  return <Link href="/visibility" className={`metric${primary ? " primary-metric" : ""}`}><div className="metric-label">{label}<span className="pill">{tag}</span></div>{primary ? <div className="overview-primary-value"><strong>{value}{value !== "—" && <small> / 100</small>}</strong><span className="overview-score-ring" aria-hidden="true" style={{ background: `conic-gradient(#c5e1d3 ${score * 3.6}deg, #ffffff35 ${score * 3.6}deg)` }} /></div> : <strong>{value}</strong>}<p>{note}</p></Link>;
}

function TrendChart({ points }: { points: TrendPointItem[] }) {
  const x = (i: number) => 44 + i * 576 / Math.max(1, points.length - 1);
  const y = (value: number) => 220 - Math.max(0, Math.min(1, value)) * 184;
  const segments: string[] = [];
  points.forEach((point, i) => {
    if (point.sampleSize < 3) return;
    segments.push(`${i === 0 || points[i - 1].sampleSize < 3 ? "M" : "L"}${x(i)},${y(point.visibilityRate)}`);
  });
  return <svg className="overview-trend" viewBox="0 0 650 260" role="img" aria-label="Daily brand visibility percentage. Points with fewer than three observations are omitted.">
    {[0, 25, 50, 75, 100].map(n => <g key={n}><line x1="44" x2="620" y1={y(n / 100)} y2={y(n / 100)} /><text x="34" y={y(n / 100) + 4} textAnchor="end">{n}</text></g>)}
    <path d={segments.join(" ")} />
    {points.map((point, i) => <g key={point.date}>{point.sampleSize >= 3 && <circle cx={x(i)} cy={y(point.visibilityRate)} r="3.5"><title>{point.date}: {(point.visibilityRate * 100).toFixed(1)}%, n = {point.sampleSize}</title></circle>}{(i === 0 || i === points.length - 1 || i === Math.floor(points.length / 2)) && <text x={x(i)} y="248" textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}>{new Date(point.date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}</text>}</g>)}
  </svg>;
}
