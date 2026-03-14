import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Shield,
  HardDrive,
  FolderOpen,
  Trash2,
  RefreshCw,
  CheckCircle,
  Lock,
  Eye,
  Database,
} from "lucide-react";

const PULSE_URL = "http://localhost:11437";

interface DataSizes {
  synapses: number;
  pulse: number;
  brain: number;
}

function fmtBytes(b: number): string {
  if (b === 0) return "not found";
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

type ClearKey = "web-cache" | "pulse-sessions" | "brain-enrichments";
type ClearState = "idle" | "clearing" | "done" | "error";

export function Privacy() {
  const [dataDir, setDataDir] = useState("~/.synapses");
  const [sizes, setSizes] = useState<DataSizes | null>(null);
  const [loadingSizes, setLoadingSizes] = useState(true);
  const [clearStates, setClearStates] = useState<Record<ClearKey, ClearState>>({
    "web-cache": "idle",
    "pulse-sessions": "idle",
    "brain-enrichments": "idle",
  });

  const [settings, setSettings] = useState({
    log_tool_calls: true,
    log_sessions: true,
    cache_web_searches: true,
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  const loadData = useCallback(async () => {
    setLoadingSizes(true);
    try {
      const [dir, sz, saved] = await Promise.all([
        invoke<string>("get_synapses_data_dir"),
        invoke<DataSizes>("get_data_sizes"),
        invoke<Record<string, unknown>>("read_app_settings"),
      ]);
      setDataDir(dir);
      setSizes(sz);
      if (saved.log_tool_calls !== undefined) {
        setSettings({
          log_tool_calls: saved.log_tool_calls as boolean,
          log_sessions: (saved.log_sessions ?? true) as boolean,
          cache_web_searches: (saved.cache_web_searches ?? true) as boolean,
        });
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingSizes(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function saveSettings(next: typeof settings) {
    setSettings(next);
    try {
      await invoke("write_app_settings", { settings: next });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch {
      // non-fatal
    }
  }

  function toggleSetting(key: keyof typeof settings) {
    saveSettings({ ...settings, [key]: !settings[key] });
  }

  async function clearData(key: ClearKey) {
    setClearStates((s) => ({ ...s, [key]: "clearing" }));
    try {
      if (key === "web-cache") {
        await invoke("run_synapses_cmd", { args: ["cache", "clear"] }).catch(() => { throw new Error("failed"); });
      } else if (key === "pulse-sessions") {
        const res = await fetch(`${PULSE_URL}/v1/sessions`, {
          method: "DELETE",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error("failed");
      } else if (key === "brain-enrichments") {
        const res = await fetch("http://localhost:11435/v1/cache/clear", {
          method: "POST",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) throw new Error("failed");
      }
      setClearStates((s) => ({ ...s, [key]: "done" }));
      setTimeout(() => {
        setClearStates((s) => ({ ...s, [key]: "idle" }));
        loadData();
      }, 2000);
    } catch {
      setClearStates((s) => ({ ...s, [key]: "error" }));
      setTimeout(() => setClearStates((s) => ({ ...s, [key]: "idle" })), 3000);
    }
  }

  const totalBytes = sizes
    ? sizes.synapses + sizes.pulse + sizes.brain
    : 0;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Privacy & Data</h1>
          <span className="page-subtitle">Everything stored locally — nothing leaves your machine</span>
        </div>
        <button className="btn-ghost" onClick={loadData} title="Refresh">
          <RefreshCw size={14} className={loadingSizes ? "spin" : ""} />
        </button>
      </div>

      {/* Local-first guarantee */}
      <div className="privacy-banner">
        <Lock size={15} />
        <span>
          <strong>100% local.</strong> Synapses stores all data on your machine at{" "}
          <code>{dataDir}</code>. No cloud sync. No external telemetry. No account required.
        </span>
      </div>

      {/* Data manifest */}
      <section className="settings-section">
        <div className="section-header-row">
          <h2 className="section-title">Data Stored on Your Machine</h2>
          {sizes && <span className="section-meta">Total: {fmtBytes(totalBytes)}</span>}
        </div>

        <div className="privacy-db-grid">
          <DbCard
            icon={<Database size={16} style={{ color: "var(--accent)" }} />}
            name="Code Graph"
            file="synapses.db"
            desc="AST parse results, function/class relationships, architectural rules, task memory for agents."
            size={sizes?.synapses}
            loading={loadingSizes}
            actions={
              <button
                className="btn-secondary btn-sm"
                onClick={() => invoke("run_synapses_cmd", { args: ["reset"] }).catch(() => {})}
              >
                <Trash2 size={12} /> Full reset
              </button>
            }
          />
          <DbCard
            icon={<Eye size={16} style={{ color: "var(--warning)" }} />}
            name="Telemetry"
            file="pulse.db"
            desc="Agent session logs, tool call counts, latency metrics, token compression stats. All local."
            size={sizes?.pulse}
            loading={loadingSizes}
            actions={
              <ClearButton
                state={clearStates["pulse-sessions"]}
                label="Clear sessions"
                onClear={() => clearData("pulse-sessions")}
              />
            }
          />
          <DbCard
            icon={<Shield size={16} style={{ color: "var(--success)" }} />}
            name="AI Summaries"
            file="brain.db"
            desc="LLM-generated summaries of your code nodes. Produced locally by Ollama — no data sent externally."
            size={sizes?.brain}
            loading={loadingSizes}
            actions={
              <ClearButton
                state={clearStates["brain-enrichments"]}
                label="Clear enrichments"
                onClear={() => clearData("brain-enrichments")}
              />
            }
          />
          <DbCard
            icon={<HardDrive size={16} style={{ color: "var(--text-muted)" }} />}
            name="Web Cache"
            file="synapses.db (web_cache table)"
            desc="Package docs and URLs fetched by agents via lookup_docs. Version-pinned Go docs never expire; other URLs expire after 24h."
            size={undefined}
            loading={false}
            actions={
              <ClearButton
                state={clearStates["web-cache"]}
                label="Clear web cache"
                onClear={() => clearData("web-cache")}
              />
            }
          />
        </div>
      </section>

      {/* Open data dir */}
      <section className="settings-section">
        <h2 className="section-title">Data Directory</h2>
        <div className="privacy-dir-row">
          <code className="privacy-dir-path">{dataDir}</code>
          <button
            className="btn-secondary btn-sm"
            onClick={() => invoke("open_data_dir").catch(() => {})}
          >
            <FolderOpen size={13} /> Open in Finder
          </button>
        </div>
        <p className="section-desc" style={{ marginTop: 8 }}>
          All Synapses data lives here. You can back it up, inspect it, or delete it manually at any time.
        </p>
      </section>

      {/* What gets logged */}
      <section className="settings-section">
        <div className="section-header-row">
          <h2 className="section-title">What Gets Logged</h2>
          {settingsSaved && (
            <span style={{ fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
              <CheckCircle size={12} /> Saved
            </span>
          )}
        </div>
        <p className="section-desc">
          All logging is local only. Nothing is sent to external servers.
          Disabling options reduces the quality of local analytics.
        </p>
        <div className="privacy-toggles">
          <PrivacyToggle
            label="Tool call logs"
            desc="Records which MCP tools agents call, how often, and latency. Powers the Analytics page."
            checked={settings.log_tool_calls}
            onChange={() => toggleSetting("log_tool_calls")}
          />
          <PrivacyToggle
            label="Agent session tracking"
            desc="Tracks which agent IDs start and end sessions. Used for multi-agent coordination."
            checked={settings.log_sessions}
            onChange={() => toggleSetting("log_sessions")}
          />
          <PrivacyToggle
            label="Web search cache"
            desc="Caches fetched documentation pages and URLs in synapses.db to avoid re-fetching across sessions."
            checked={settings.cache_web_searches}
            onChange={() => toggleSetting("cache_web_searches")}
          />
        </div>
      </section>

      {/* Guarantee */}
      <section className="settings-section">
        <h2 className="section-title">Privacy Guarantee</h2>
        <div className="privacy-guarantees">
          {[
            "Your code never leaves your machine",
            "Synapses does not have a cloud backend",
            "No analytics are sent to Anthropic, GitHub, or any third party",
            "AI enrichment runs locally via Ollama — your code is not sent to any LLM API",
            "Web cache uses only URLs you or your agents explicitly fetch — no background crawling",
            "You can inspect, export, or delete all stored data at any time",
          ].map((item) => (
            <div key={item} className="privacy-guarantee-row">
              <CheckCircle size={14} style={{ color: "var(--success)", flexShrink: 0 }} />
              <span>{item}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function DbCard({
  icon,
  name,
  file,
  desc,
  size,
  loading,
  actions,
}: {
  icon: React.ReactNode;
  name: string;
  file: string;
  desc: string;
  size?: number;
  loading: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <div className="privacy-db-card">
      <div className="privacy-db-header">
        {icon}
        <div className="privacy-db-title">
          <span className="privacy-db-name">{name}</span>
          <code className="privacy-db-file">{file}</code>
        </div>
        <span className="privacy-db-size">
          {loading ? "…" : size !== undefined ? fmtBytes(size) : "—"}
        </span>
      </div>
      <p className="privacy-db-desc">{desc}</p>
      {actions && <div className="privacy-db-actions">{actions}</div>}
    </div>
  );
}

function ClearButton({
  state,
  label,
  onClear,
}: {
  state: ClearState;
  label: string;
  onClear: () => void;
}) {
  return (
    <button
      className="btn-secondary btn-sm btn-danger-hover"
      disabled={state === "clearing"}
      onClick={onClear}
    >
      {state === "clearing" ? (
        <><RefreshCw size={12} className="spin" /> Clearing…</>
      ) : state === "done" ? (
        <><CheckCircle size={12} /> Cleared</>
      ) : state === "error" ? (
        "Failed — service offline?"
      ) : (
        <><Trash2 size={12} /> {label}</>
      )}
    </button>
  );
}

function PrivacyToggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <div className="privacy-toggle-row">
      <div className="privacy-toggle-text">
        <div className="privacy-toggle-label">{label}</div>
        <div className="privacy-toggle-desc">{desc}</div>
      </div>
      <button
        className={`toggle ${checked ? "toggle-on" : ""}`}
        onClick={onChange}
        role="switch"
        aria-checked={checked}
      >
        <span className="toggle-thumb" />
      </button>
    </div>
  );
}
