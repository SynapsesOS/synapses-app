import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  RefreshCw, AlertCircle, Zap, DollarSign, Activity,
  TrendingDown, BarChart2, Brain
} from "lucide-react";

const PULSE_URL = "http://127.0.0.1:11435/api/admin/pulse/summary";

// ── Model pricing for client-side cost estimate ───────────────────────────────
const MODELS: { id: string; label: string; inputPer1M: number }[] = [
  { id: "sonnet",  label: "Sonnet 4.6", inputPer1M: 3.00  },
  { id: "opus",    label: "Opus 4.6",   inputPer1M: 15.00 },
  { id: "haiku",   label: "Haiku 4.5",  inputPer1M: 0.80  },
  { id: "gpt4o",   label: "GPT-4o",     inputPer1M: 2.50  },
];

// ── Type definitions ──────────────────────────────────────────────────────────
interface Summary {
  total_tool_calls: number;
  tokens_saved: number;
  baseline_tokens: number;
  tokens_delivered: number;
  savings_pct: number;
  compression_ratio: number;
  cost_saved_usd: number;
  avg_latency_ms: number;
  cache_hit_rate: number;
  brain_enrichment_rate: number;
  context_deliveries: number;
  sessions: number;
  tasks_completed: number;
}

interface ToolStats {
  name: string;
  calls: number;
  avg_ms: number;
  error_rate: number;
}

interface AgentStats {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
  tasks_completed: number;
}

interface TimelinePoint {
  date: string;
  tokens_saved: number;
  tool_calls: number;
  cost_saved_usd: number;
}

interface EntityCount {
  entity: string;
  count: number;
}

interface EntityInsight {
  entity: string;
  score: number;
  positive_signals: number;
  negative_signals: number;
  total_signals: number;
}

interface AgentLLMStats {
  model: string;
  provider: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  total_cost_usd: number;
}

interface PulseDashboard {
  days: number;
  summary?: Summary;
  tools?: ToolStats[];
  agents?: AgentStats[];
  timeline?: TimelinePoint[];
  top_entities?: EntityCount[];
  insights?: EntityInsight[];
  llm_stats?: AgentLLMStats[];
}

interface KnowledgeStats {
  plans: number;
  tasks: number;
  decisions: number;
  rules: number;
}

type Days = 7 | 30 | 90;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNum(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

function fmtPct(n?: number): string {
  if (n == null) return "—";
  return n.toFixed(1) + "%";
}

function latencyColor(ms: number): string {
  if (ms < 500) return "var(--success)";
  if (ms < 2000) return "var(--warning)";
  return "var(--danger)";
}

function agentLabel(id: string): string {
  const map: Record<string, string> = {
    claude: "Claude Code", "claude-code": "Claude Code",
    cursor: "Cursor", windsurf: "Windsurf",
    vscode: "VS Code", zed: "Zed",
    antigravity: "Antigravity",
  };
  return map[id.toLowerCase()] ?? id;
}

function computeCostUSD(tokensSaved: number, modelId: string): number {
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  return (tokensSaved / 1_000_000) * model.inputPer1M;
}

/** Generate a complete array of N date strings (YYYY-MM-DD) ending today. */
function buildDateRange(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Fill gaps in timeline so every day in the range is present. */
function fillTimeline(points: TimelinePoint[], days: number): TimelinePoint[] {
  const byDate = new Map(points.map((p) => [p.date, p]));
  return buildDateRange(days).map((date) =>
    byDate.get(date) ?? { date, tokens_saved: 0, tool_calls: 0, cost_saved_usd: 0 }
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Analytics() {
  const [data, setData] = useState<PulseDashboard | null>(null);
  const [kb, setKb] = useState<KnowledgeStats | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<Days>(7);
  const [modelId, setModelId] = useState("sonnet");

  const fetchAll = useCallback(async (d: Days) => {
    setLoading(true);
    try {
      const [pulse, kbStats] = await Promise.all([
        fetch(`${PULSE_URL}?days=${d}`, { signal: AbortSignal.timeout(4000) })
          .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<PulseDashboard>; }),
        invoke<Record<string, number>>("get_knowledge_base_stats").catch(() => null),
      ]);
      setData(pulse);
      setOffline(false);
      if (kbStats) {
        setKb({
          plans: kbStats.plans ?? 0,
          tasks: kbStats.tasks ?? 0,
          decisions: kbStats.decisions ?? 0,
          rules: kbStats.rules ?? 0,
        });
      }
    } catch {
      setData(null);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(days); }, [fetchAll, days]);

  const s = data?.summary;
  const tokensSaved = s?.tokens_saved ?? 0;
  const costUSD = computeCostUSD(tokensSaved, modelId);
  const hasData = (s?.total_tool_calls ?? 0) > 0;

  // Timeline: always show full range with gap-filled zeros
  const timelineDays = days > 14 ? days : 14;
  const filledTimeline = useMemo(
    () => data?.timeline ? fillTimeline(data.timeline, timelineDays) : [],
    [data?.timeline, timelineDays]
  );

  return (
    <div className="page">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <span className="page-subtitle">What Synapses is doing for you</span>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {([7, 30, 90] as Days[]).map((d) => (
            <button
              key={d}
              className={days === d ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
              onClick={() => setDays(d)}
            >
              {d}d
            </button>
          ))}
          <button className="btn-ghost" onClick={() => fetchAll(days)} title="Refresh">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Offline banner */}
      {offline && (
        <div className="offline-banner" style={{ marginBottom: 16 }}>
          <AlertCircle size={14} />
          <span>Daemon offline — start it from Dashboard to see analytics.</span>
        </div>
      )}

      {/* Knowledge Base strip */}
      {kb && (kb.plans + kb.tasks + kb.decisions + kb.rules) > 0 && (
        <div className="kb-strip">
          <span className="kb-strip-label">🧠 Synapses Knowledge Base</span>
          <div className="kb-stats">
            <KbStat value={kb.plans} label="plans" />
            <KbStat value={kb.tasks} label="tasks" />
            <KbStat value={kb.decisions} label="decisions" />
            <KbStat value={kb.rules} label="arch rules" />
          </div>
          <span className="kb-strip-note">Built up across all indexed projects</span>
        </div>
      )}

      {loading && !data ? (
        <div className="empty-state">Loading analytics…</div>
      ) : !offline && !hasData ? (
        <div className="empty-state">
          <div style={{ fontSize: 32, marginBottom: 8 }}>📊</div>
          <div>No data yet for this period.</div>
          <div className="settings-hint" style={{ marginTop: 6 }}>
            Activity is recorded as your AI agents use Synapses MCP tools.
          </div>
        </div>
      ) : !offline && data ? (
        <>
          {/* ── Hero cards ──────────────────────────────────────────────────── */}
          <section className="an-section">
            <div className="an-hero-grid">
              <HeroCard
                icon={<Zap size={18} />}
                color="accent"
                label="Tokens Saved"
                value={fmtNum(tokensSaved)}
                sub={s?.savings_pct ? `${fmtPct(s.savings_pct)} of baseline eliminated` : "context compressed by Synapses"}
              />
              <HeroCard
                icon={<BarChart2 size={18} />}
                color="success"
                label="Compression Ratio"
                value={s?.compression_ratio ? `${s.compression_ratio.toFixed(1)}×` : "—"}
                sub={s?.tokens_delivered ? `${fmtNum(s.tokens_delivered)} tokens delivered vs ${fmtNum(s.baseline_tokens)} baseline` : "ratio of baseline to delivered tokens"}
              />
              <HeroCard
                icon={<DollarSign size={18} />}
                color="warning"
                label="Est. Cost Saved"
                value={`$${costUSD.toFixed(2)}`}
                sub={
                  <span>
                    assuming{" "}
                    <select
                      className="an-model-select"
                      value={modelId}
                      onChange={(e) => setModelId(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {MODELS.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </span>
                }
              />
              <HeroCard
                icon={<Activity size={18} />}
                color="muted"
                label="Tool Calls"
                value={fmtNum(s?.total_tool_calls)}
                sub={`${fmtNum(s?.context_deliveries)} context deliveries · ${s?.sessions ?? 0} sessions`}
              />
            </div>
          </section>

          {/* ── Efficiency strip ─────────────────────────────────────────────── */}
          <section className="an-section">
            <div className="an-efficiency-strip">
              <EffStat
                label="Cache Hit Rate"
                value={s?.cache_hit_rate != null ? fmtPct(s.cache_hit_rate * 100) : "—"}
                note="repeat lookups served instantly"
              />
              <div className="an-eff-divider" />
              <EffStat
                label="Brain Enrichment"
                value={s?.brain_enrichment_rate != null ? fmtPct(s.brain_enrichment_rate * 100) : "—"}
                note="context enriched by LLM"
              />
              <div className="an-eff-divider" />
              <EffStat
                label="Avg Response"
                value={s?.avg_latency_ms ? `${Math.round(s.avg_latency_ms)}ms` : "—"}
                note="context delivery latency"
                color={s?.avg_latency_ms ? latencyColor(s.avg_latency_ms) : undefined}
              />
              <div className="an-eff-divider" />
              <EffStat
                label="Sessions"
                value={String(s?.sessions ?? 0)}
                note="agent sessions this period"
              />
              <div className="an-eff-divider" />
              <EffStat
                label="Tasks Completed"
                value={fmtNum(s?.tasks_completed)}
                note="agents finished work"
              />
            </div>
          </section>

          {/* ── Timeline ─────────────────────────────────────────────────────── */}
          {filledTimeline.length > 0 && (
            <section className="an-section">
              <div className="an-section-title">Activity — last {timelineDays} days</div>
              <DualTimeline points={filledTimeline} />
            </section>
          )}

          {/* ── LLM Usage (model tracking A+B) ──────────────────────────────── */}
          {data.llm_stats && data.llm_stats.length > 0 && (
            <section className="an-section">
              <div className="an-section-title">Model Usage</div>
              <p className="section-desc" style={{ marginBottom: 10 }}>
                Actual LLM spend reported by your agents via <code>session_init(model=...)</code> or <code>report_usage</code>.
              </p>
              <div className="an-table">
                <div className="an-table-head an-llm-head">
                  <span>Model</span>
                  <span>Provider</span>
                  <span>Calls</span>
                  <span>Input tokens</span>
                  <span>Output tokens</span>
                  <span>Cost</span>
                </div>
                {data.llm_stats.map((r) => (
                  <div key={r.model + r.provider} className="an-table-row an-llm-row">
                    <span className="an-tool-name">{r.model}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{r.provider || "—"}</span>
                    <span>{fmtNum(r.calls)}</span>
                    <span>{fmtNum(r.input_tokens)}</span>
                    <span>{fmtNum(r.output_tokens)}</span>
                    <span style={{ color: "var(--warning)", fontWeight: 600 }}>
                      {r.total_cost_usd > 0 ? `$${r.total_cost_usd.toFixed(4)}` : "—"}
                    </span>
                  </div>
                ))}
              </div>
              <p className="settings-hint" style={{ marginTop: 8 }}>
                Pass <code>model="claude-sonnet-4-6"</code> in <code>session_init</code> to populate this table automatically.
              </p>
            </section>
          )}

          {/* ── Insights (low-performing entities) ───────────────────────────── */}
          {data.insights && data.insights.length > 0 && (
            <section className="an-section">
              <div className="an-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <Brain size={14} style={{ color: "var(--warning)" }} />
                Brain Insights — Entities Needing Attention
              </div>
              <p className="section-desc" style={{ marginBottom: 10 }}>
                Code entities where agents frequently had to re-ask, correct, or escalate.
                Enriching these in brain.json improves context quality.
              </p>
              <div className="an-insights-list">
                {data.insights.slice(0, 6).map((ins) => (
                  <InsightRow key={ins.entity} ins={ins} />
                ))}
              </div>
            </section>
          )}

          {/* ── Most Asked About ─────────────────────────────────────────────── */}
          {data.top_entities && data.top_entities.length > 0 && (
            <section className="an-section">
              <div className="an-section-title">Most Asked About</div>
              <p className="section-desc" style={{ marginBottom: 10 }}>
                Code your AI agents queried most this period.
              </p>
              <div className="an-entity-chips">
                {data.top_entities.map((e, i) => (
                  <span
                    key={e.entity}
                    className="an-entity-chip"
                    style={{ opacity: 1 - i * 0.06 }}
                  >
                    {e.entity}
                    <span className="an-entity-count">{e.count}</span>
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Agents + Tools two-column ────────────────────────────────────── */}
          <div className="an-two-col">
            {/* Agents */}
            {data.agents && data.agents.length > 0 && (
              <section className="an-section">
                <div className="an-section-title">AI Agents</div>
                <div className="an-table">
                  <div className="an-table-head">
                    <span>Agent</span>
                    <span>Sessions</span>
                    <span>Calls</span>
                    <span>Tokens saved</span>
                    <span>Tasks done</span>
                  </div>
                  {data.agents.map((a) => (
                    <div key={a.agent_id} className="an-table-row">
                      <span className="an-agent-name">{agentLabel(a.agent_id)}</span>
                      <span>{a.sessions}</span>
                      <span>{fmtNum(a.tool_calls)}</span>
                      <span style={{ color: "var(--accent-h)" }}>{fmtNum(a.tokens_saved)}</span>
                      <span>{a.tasks_completed}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Tools */}
            {data.tools && data.tools.length > 0 && (
              <section className="an-section">
                <div className="an-section-title">Top Tools</div>
                <div className="an-table">
                  <div className="an-table-head">
                    <span>Tool</span>
                    <span>Calls</span>
                    <span>Avg ms</span>
                    <span>Errors</span>
                  </div>
                  {data.tools.slice(0, 12).map((t) => (
                    <div key={t.name} className="an-table-row">
                      <span className="an-tool-name">{t.name}</span>
                      <span>{fmtNum(t.calls)}</span>
                      <span style={{ color: latencyColor(t.avg_ms) }}>
                        {t.avg_ms ? `${Math.round(t.avg_ms)}ms` : "—"}
                      </span>
                      <span style={{ color: t.error_rate > 0.05 ? "var(--danger)" : "var(--text-muted)" }}>
                        {t.error_rate ? `${(t.error_rate * 100).toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="an-latency-legend">
                  <span style={{ color: "var(--success)" }}>● &lt;500ms</span>
                  <span style={{ color: "var(--warning)" }}>● &lt;2s</span>
                  <span style={{ color: "var(--danger)" }}>● ≥2s</span>
                </div>
              </section>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HeroCard({ icon, color, label, value, sub }: {
  icon: React.ReactNode;
  color: "accent" | "success" | "warning" | "muted";
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  const colorMap = {
    accent: "var(--accent)",
    success: "var(--success)",
    warning: "var(--warning)",
    muted: "var(--text-muted)",
  };
  return (
    <div className="an-hero-card">
      <div className="an-hero-icon" style={{ color: colorMap[color] }}>{icon}</div>
      <div className="an-hero-label">{label}</div>
      <div className="an-hero-value">{value}</div>
      {sub && <div className="an-hero-sub">{sub}</div>}
    </div>
  );
}

function EffStat({ label, value, note, color }: {
  label: string;
  value: string;
  note: string;
  color?: string;
}) {
  return (
    <div className="an-eff-stat">
      <div className="an-eff-value" style={color ? { color } : undefined}>{value}</div>
      <div className="an-eff-label">{label}</div>
      <div className="an-eff-note">{note}</div>
    </div>
  );
}

function KbStat({ value, label }: { value: number; label: string }) {
  return (
    <div className="kb-stat">
      <span className="kb-stat-value">{value.toLocaleString()}</span>
      <span className="kb-stat-label">{label}</span>
    </div>
  );
}

/** Dual-metric timeline: bars for tool calls, line overlay for tokens saved. */
function DualTimeline({ points }: { points: TimelinePoint[] }) {
  const maxCalls = Math.max(...points.map((p) => p.tool_calls), 1);
  const maxTokens = Math.max(...points.map((p) => p.tokens_saved), 1);

  // Only show every Nth label to avoid crowding
  const labelEvery = points.length > 21 ? 7 : points.length > 14 ? 3 : 1;

  // Build SVG polyline for tokens saved (normalized 0–100, 5% top padding)
  const linePoints = points.length > 1
    ? points
        .map((p, i) => {
          const x = (i / (points.length - 1)) * 100;
          const y = 95 - (p.tokens_saved / maxTokens) * 90;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ")
    : null;

  return (
    <div className="an-timeline">
      {/* Bars + SVG overlay share the same height container */}
      <div className="an-bars-container">
        <div className="an-bars">
          {points.map((p, i) => {
            const heightPct = Math.max((p.tool_calls / maxCalls) * 100, p.tool_calls > 0 ? 2 : 0);
            const shortDate = p.date.slice(5); // MM-DD
            return (
              <div key={p.date} className="an-bar-col">
                <div className="an-bar-wrap">
                  <div
                    className="an-bar"
                    style={{ height: `${heightPct}%` }}
                    title={`${p.date}: ${p.tool_calls} calls · ${fmtNum(p.tokens_saved)} tokens saved`}
                  />
                </div>
                <div className="an-bar-label" style={{ opacity: i % labelEvery === 0 ? 1 : 0 }}>
                  {shortDate}
                </div>
              </div>
            );
          })}
        </div>

        {linePoints && maxTokens > 0 && (
          <svg
            className="an-timeline-line"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={linePoints}
              fill="none"
              stroke="var(--accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        )}
      </div>

      <div className="an-timeline-legend">
        <span className="an-legend-dot an-legend-dot-bar" />
        <span>Tool calls / day</span>
        <span className="an-legend-line" />
        <span style={{ color: "var(--accent)" }}>Tokens saved / day</span>
      </div>
    </div>
  );
}

function InsightRow({ ins }: { ins: EntityInsight }) {
  const negRate = ins.total_signals > 0
    ? (ins.negative_signals / ins.total_signals) * 100
    : 0;
  return (
    <div className="an-insight-row">
      <div className="an-insight-entity">
        <TrendingDown size={12} style={{ color: "var(--warning)", flexShrink: 0 }} />
        <span className="an-tool-name">{ins.entity}</span>
      </div>
      <div className="an-insight-bar-wrap">
        <div
          className="an-insight-bar"
          style={{ width: `${Math.min(negRate, 100)}%` }}
          title={`${ins.negative_signals} negative / ${ins.total_signals} total signals`}
        />
      </div>
      <span className="an-insight-pct">{negRate.toFixed(0)}% friction</span>
    </div>
  );
}
