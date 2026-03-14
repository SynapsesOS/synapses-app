import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Database,
  Brain,
  Globe,
  Activity,
  RefreshCw,
  AlertCircle,
  Clock,
  BookOpen,
  GitBranch,
  CheckSquare,
  Layers,
} from "lucide-react";

// Pulse analytics are in-process — served at the daemon's admin API
const PULSE_SUMMARY_URL = "http://localhost:11435/api/admin/pulse/summary";

interface PulseAgentStats {
  agent_id: string;
  sessions: number;
  tool_calls: number;
  tokens_saved: number;
}

interface PulseSummary {
  sessions?: number;
  total_tool_calls?: number;
  tokens_saved?: number;
}

function fmt(n?: number): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toLocaleString();
}

export function Memory() {
  const [pulseData, setPulseData] = useState<{ summary?: PulseSummary; agents?: PulseAgentStats[] } | null>(null);
  const [dataDir, setDataDir] = useState("~/.synapses");
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const dir = await invoke<string>("get_synapses_data_dir").catch(() => "~/.synapses");
    setDataDir(dir);

    const [pulse] = await Promise.allSettled([
      fetch(`${PULSE_SUMMARY_URL}?days=30`, { signal: AbortSignal.timeout(4000) })
        .then((r) => (r.ok ? r.json() : Promise.reject())),
    ]);

    if (pulse.status === "fulfilled") setPulseData(pulse.value);

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Memory</h1>
          <span className="page-subtitle">What Synapses knows and remembers — stored locally</span>
        </div>
        <button className="btn-ghost" onClick={fetchAll} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      <div className="memory-grid">
        {/* Session memory */}
        <MemoryCard
          icon={<Activity size={16} style={{ color: "var(--warning)" }} />}
          title="Session Memory"
          subtitle="Episodic"
          badge="pulse.db"
          description="Tool calls, agent sessions, and context delivery history. Used for analytics and pattern mining."
          available={pulseData != null}
        >
          {pulseData ? (
            <div className="memory-stats">
              <MemoryStat label="Sessions (30d)" value={fmt(pulseData.summary?.sessions)} />
              <MemoryStat label="Tool Calls" value={fmt(pulseData.summary?.total_tool_calls)} />
              <MemoryStat label="Tokens Saved" value={fmt(pulseData.summary?.tokens_saved)} />
              <MemoryStat label="Active Agents" value={fmt(pulseData.agents?.length)} />
            </div>
          ) : (
            <OfflinePlaceholder service="Pulse (daemon)" port={11435} />
          )}
        </MemoryCard>

        {/* Semantic memory */}
        <MemoryCard
          icon={<Brain size={16} style={{ color: "var(--accent)" }} />}
          title="AI Enrichments"
          subtitle="Semantic"
          badge="brain.db"
          description="LLM-generated summaries of your code nodes, produced locally by Ollama. Enable in synapses.json to get richer context delivery."
          available={true}
        >
          <div className="memory-note">
            <BookOpen size={13} />
            <span>
              In-process inside the daemon. Enable with <code>{'"brain": {"enabled": true}'}</code> in your project's <code>synapses.json</code>.
            </span>
          </div>
        </MemoryCard>

        {/* Web cache */}
        <MemoryCard
          icon={<Globe size={16} style={{ color: "var(--success)" }} />}
          title="Web Cache"
          subtitle="External"
          badge="synapses.db"
          description="Cached documentation pages and URLs fetched by agents via lookup_docs. Version-pinned Go docs never expire; other URLs expire after 24h."
          available={true}
        >
          <div className="memory-note">
            <BookOpen size={13} />
            <span>
              Stored in the <code>web_cache</code> table inside <code>synapses.db</code>.
              Clear it from the <a href="#/privacy" className="inline-link">Privacy</a> page.
            </span>
          </div>
        </MemoryCard>

        {/* Code graph memory */}
        <MemoryCard
          icon={<GitBranch size={16} style={{ color: "var(--accent-h)" }} />}
          title="Code Graph"
          subtitle="Structural"
          badge="synapses.db"
          description="AST parse graph of all indexed projects. Nodes = functions, classes, files. Edges = calls, imports, defines."
          available={true}
        >
          <div className="memory-note">
            <BookOpen size={13} />
            <span>
              View project details on the <a href="#/projects" className="inline-link">Projects</a> page.
              Run <code>synapses doctor</code> from Settings for graph stats.
            </span>
          </div>
        </MemoryCard>

        {/* Task memory */}
        <MemoryCard
          icon={<CheckSquare size={16} style={{ color: "var(--success)" }} />}
          title="Agent Task Memory"
          subtitle="Episodic"
          badge="synapses.db"
          description="Plans and tasks that AI agents create to track their work across sessions. Agents use create_plan, update_task, get_pending_tasks."
          available={true}
        >
          <div className="memory-note">
            <Clock size={13} />
            <span>
              Task memory is managed by agents via MCP. View active tasks by running:
            </span>
          </div>
          <code className="memory-cmd">synapses doctor --path /your/project</code>
        </MemoryCard>

        {/* Annotations */}
        <MemoryCard
          icon={<Layers size={16} style={{ color: "var(--text-muted)" }} />}
          title="Annotations & Rules"
          subtitle="Semantic"
          badge="synapses.db"
          description="Notes agents have written on code entities via annotate_node, architectural rules via upsert_rule, and decision records via upsert_adr."
          available={true}
        >
          <div className="memory-note">
            <Database size={13} />
            <span>
              Annotations are stored in <code>{dataDir}/synapses.db</code>.
              You can export and inspect the SQLite file directly.
            </span>
          </div>
        </MemoryCard>
      </div>

      {/* Three-tier model explanation */}
      <section className="settings-section" style={{ marginTop: 32 }}>
        <h2 className="section-title">Memory Architecture</h2>
        <div className="memory-tiers">
          <div className="memory-tier">
            <div className="memory-tier-label">Episodic</div>
            <div className="memory-tier-desc">
              What happened — session logs, task history, tool call sequences.
              Decays over time (configurable TTL in Privacy settings).
            </div>
          </div>
          <div className="memory-tier-sep">→</div>
          <div className="memory-tier">
            <div className="memory-tier-label">Semantic</div>
            <div className="memory-tier-desc">
              Facts about your code — LLM summaries, annotations, ADRs, rules.
              Persists until you delete it.
            </div>
          </div>
          <div className="memory-tier-sep">→</div>
          <div className="memory-tier">
            <div className="memory-tier-label">Behavioral</div>
            <div className="memory-tier-desc">
              How you and your agents work — patterns mined from episodic memory.
              Coming in a future release.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MemoryCard({
  icon,
  title,
  subtitle,
  badge,
  description,
  available,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  badge: string;
  description: string;
  available: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className={`memory-card ${!available ? "memory-card-dim" : ""}`}>
      <div className="memory-card-header">
        {icon}
        <div className="memory-card-title">
          <span className="memory-card-name">{title}</span>
          <span className="memory-card-sub">{subtitle}</span>
        </div>
        <code className="memory-card-badge">{badge}</code>
      </div>
      <p className="memory-card-desc">{description}</p>
      <div className="memory-card-body">{children}</div>
    </div>
  );
}

function MemoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="memory-stat">
      <span className="memory-stat-label">{label}</span>
      <span className="memory-stat-value">{value}</span>
    </div>
  );
}

function OfflinePlaceholder({ service, port }: { service: string; port: number }) {
  return (
    <div className="memory-offline">
      <AlertCircle size={13} />
      <span>{service} offline (port {port}) — start it from Dashboard</span>
    </div>
  );
}
