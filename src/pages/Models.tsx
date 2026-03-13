import { useState, useEffect, useCallback } from "react";
import {
  Brain,
  Download,
  RefreshCw,
  AlertCircle,
  MemoryStick,
  CheckCircle,
  Settings,
  ChevronDown,
  ChevronRight,
  Cpu,
  Play,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../context/ToastContext";

const BRAIN_URL = "http://localhost:11435";
const OLLAMA_URL = "http://localhost:11434";

const CURATED_MODELS = [
  { name: "qwen2.5-coder:1.5b", desc: "Default — fast, ~800 MB RAM", recommended: true },
  { name: "qwen2.5-coder:3b", desc: "Better quality, ~1.5 GB RAM", recommended: false },
  { name: "qwen2.5-coder:7b", desc: "High quality, ~4 GB RAM", recommended: false },
  { name: "codellama:7b", desc: "Meta CodeLlama, ~4 GB RAM", recommended: false },
  { name: "deepseek-coder:1.3b", desc: "Lightweight alternative, ~700 MB RAM", recommended: false },
];

const SDLC_PHASES = ["development", "testing", "review", "production"] as const;
type SdlcPhase = (typeof SDLC_PHASES)[number];

interface TierHealth {
  status: string;
  model?: string;
  avg_ms?: number;
  circuit_open?: boolean;
  recovery_in?: number;
}

type PullStatus = "idle" | "pulling" | "done" | "error";
type PullProgress = { completed?: number; total?: number };

const TIER_ORDER = ["sentry", "critic", "librarian", "archivist", "navigator"];

function tierColor(status: string, circuitOpen?: boolean): string {
  if (circuitOpen) return "var(--danger)";
  if (status === "healthy") return "var(--success)";
  if (status === "degraded") return "var(--warning)";
  return "var(--text-dim)";
}

export function Models() {
  const { addToast } = useToast();
  const [health, setHealth] = useState<{ status: string; model?: string; version?: string } | null>(null);
  const [tiersData, setTiersData] = useState<Record<string, TierHealth> | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pullStatuses, setPullStatuses] = useState<Record<string, PullStatus>>({});
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});
  const [customModel, setCustomModel] = useState("");
  const [sdlcPhase, setSdlcPhase] = useState<SdlcPhase>("development");
  const [sdlcSaving, setSdlcSaving] = useState(false);
  const [ramGb, setRamGb] = useState(0);
  const [ollamaModels, setOllamaModels] = useState(4);
  const [ollamaConfigSaved, setOllamaConfigSaved] = useState(false);
  const [startingBrain, setStartingBrain] = useState(false);
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null);
  const [brainConfigRaw, setBrainConfigRaw] = useState("");
  const [brainConfigOpen, setBrainConfigOpen] = useState(false);
  const [brainConfigSaving, setBrainConfigSaving] = useState(false);
  const [brainConfigError, setBrainConfigError] = useState("");

  const fetchHealth = useCallback(() => {
    setLoading(true);
    Promise.allSettled([
      fetch(`${BRAIN_URL}/v1/health`, { signal: AbortSignal.timeout(3000) }).then((r) =>
        r.ok ? r.json() : Promise.reject()
      ),
      fetch(`${BRAIN_URL}/v1/health/tiers`, { signal: AbortSignal.timeout(3000) }).then((r) =>
        r.ok ? r.json() : Promise.reject()
      ),
      fetch(`${BRAIN_URL}/v1/sdlc/phase`, { signal: AbortSignal.timeout(3000) }).then((r) =>
        r.ok ? r.json() : Promise.reject()
      ),
    ]).then(([h, t, p]) => {
      if (h.status === "fulfilled") { setHealth(h.value); setOffline(false); }
      else setOffline(true);
      if (t.status === "fulfilled" && t.value?.tiers) setTiersData(t.value.tiers);
      if (p.status === "fulfilled" && p.value?.phase) setSdlcPhase(p.value.phase);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHealth();
    invoke<number>("get_system_ram_gb").then(setRamGb).catch(() => {});
    invoke<string>("read_brain_config").then(setBrainConfigRaw).catch(() => {});
    fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) })
      .then((r) => setOllamaAvailable(r.ok))
      .catch(() => setOllamaAvailable(false));
  }, [fetchHealth]);

  async function startBrain() {
    setStartingBrain(true);
    try {
      await invoke("restart_service", { name: "brain" });
      addToast("info", "Brain starting… checking health in 5s");
      setTimeout(() => { fetchHealth(); setStartingBrain(false); }, 5000);
    } catch (e) {
      addToast("error", `Failed to start brain: ${e}`);
      setStartingBrain(false);
    }
  }

  const pullModel = async (modelName: string) => {
    if (!modelName.trim()) return;
    setPullStatuses((p) => ({ ...p, [modelName]: "pulling" }));
    setPullProgress((p) => ({ ...p, [modelName]: {} }));
    try {
      const res = await fetch(`${OLLAMA_URL}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error("pull failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          try {
            const json = JSON.parse(line) as PullProgress;
            setPullProgress((p) => ({ ...p, [modelName]: json }));
          } catch { /* ignore */ }
        }
      }
      setPullStatuses((p) => ({ ...p, [modelName]: "done" }));
      addToast("success", `${modelName} pulled successfully`);
      fetchHealth();
    } catch {
      setPullStatuses((p) => ({ ...p, [modelName]: "error" }));
      addToast("error", `Failed to pull ${modelName}`);
    }
  };

  async function setSdlc(phase: SdlcPhase) {
    setSdlcSaving(true);
    try {
      const res = await fetch(`${BRAIN_URL}/v1/sdlc/phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error("failed");
      setSdlcPhase(phase);
      addToast("success", `SDLC phase set to ${phase}`);
    } catch {
      addToast("error", "Failed to set SDLC phase — brain offline?");
    } finally {
      setSdlcSaving(false);
    }
  }

  async function saveOllamaConfig() {
    try {
      await invoke("set_ollama_max_models", { count: ollamaModels });
      setOllamaConfigSaved(true);
      addToast("success", `OLLAMA_MAX_LOADED_MODELS=${ollamaModels} applied. Restart Ollama to take effect.`, 6000);
      setTimeout(() => setOllamaConfigSaved(false), 3000);
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    }
  }

  async function saveBrainConfig() {
    setBrainConfigSaving(true);
    setBrainConfigError("");
    try {
      await invoke("write_brain_config", { content: brainConfigRaw });
      addToast("success", "brain.json saved. Restart brain from Dashboard to apply.");
    } catch (e) {
      const msg = String(e);
      setBrainConfigError(msg);
      addToast("error", `Save failed: ${msg}`);
    } finally {
      setBrainConfigSaving(false);
    }
  }

  const activeModel = health?.model ?? null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Models & Brain</h1>
        <button className="btn-ghost" onClick={fetchHealth} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      {/* 1. System resources (Ollama memory) */}
      <section className="settings-section">
        <h2 className="section-title">System Resources</h2>
        <div className="resource-card">
          <div className="resource-row">
            <MemoryStick size={15} style={{ color: "var(--accent)" }} />
            <span>System RAM: <strong>{ramGb > 0 ? `${ramGb} GB` : "Unknown"}</strong></span>
            {ramGb >= 32 && (
              <span className="model-tag model-tag-active" style={{ marginLeft: 8 }}>≥32 GB</span>
            )}
          </div>
          {ramGb >= 32 && (
            <div className="resource-note-success">
              <CheckCircle size={13} />
              <span>
                Your machine qualifies for keeping all brain tiers in memory simultaneously,
                eliminating 3–8s model swap delays.
              </span>
            </div>
          )}
          {ramGb > 0 && ramGb < 32 && (
            <div className="resource-note-warn">
              <Cpu size={13} />
              <span>
                {ramGb} GB RAM — model swaps between brain tiers may cause 3–8s delays.
                Increasing <code>OLLAMA_MAX_LOADED_MODELS</code> reduces this at the cost of RAM.
              </span>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <label className="field-label">OLLAMA_MAX_LOADED_MODELS</label>
            <div className="pull-row" style={{ marginTop: 6 }}>
              <select
                className="select-input"
                value={ollamaModels}
                onChange={(e) => setOllamaModels(Number(e.target.value))}
              >
                <option value={1}>1 — default (one model at a time)</option>
                <option value={2}>2 — two tiers hot</option>
                <option value={3}>3 — three tiers hot</option>
                <option value={4}>4 — all tiers hot (recommended for 16 GB+)</option>
              </select>
              <button
                className={ollamaConfigSaved ? "btn-secondary" : "btn-primary"}
                style={{ fontSize: 12, padding: "7px 14px", flexShrink: 0 }}
                onClick={saveOllamaConfig}
              >
                {ollamaConfigSaved ? <><CheckCircle size={12} /> Applied</> : "Apply"}
              </button>
            </div>
            <p className="settings-hint">
              macOS: applies via <code>launchctl setenv</code>. Restart Ollama for changes to take effect.
            </p>
          </div>
        </div>
      </section>

      {/* 2. Tier health dashboard */}
      <section className="settings-section">
        <h2 className="section-title">Brain Tier Health</h2>
        {offline ? (
          <div className="brain-offline-card">
            <div className="brain-offline-header">
              <AlertCircle size={18} style={{ color: "var(--warning)" }} />
              <span>Brain is not running</span>
            </div>
            {ollamaAvailable === false && (
              <div className="brain-offline-step">
                <strong>Step 1:</strong> Install Ollama from{" "}
                <a href="https://ollama.com" target="_blank" rel="noreferrer" className="inline-link">
                  ollama.com
                </a>{" "}
                — Brain uses local Ollama models, nothing goes to the cloud.
              </div>
            )}
            {ollamaAvailable === true && (
              <div className="brain-offline-step brain-offline-step-ok">
                <CheckCircle size={13} style={{ color: "var(--success)" }} /> Ollama detected
              </div>
            )}
            <div className="brain-offline-step">
              {ollamaAvailable === false ? <strong>Step 2:</strong> : <strong>Step 1:</strong>}{" "}
              Start Brain — it will pull the required Synapses models automatically on first run.
            </div>
            <button
              className="btn-primary"
              style={{ marginTop: 12, alignSelf: "flex-start" }}
              onClick={startBrain}
              disabled={startingBrain || ollamaAvailable === false}
            >
              {startingBrain
                ? <><RefreshCw size={13} className="spin" /> Starting…</>
                : <><Play size={13} /> Start Brain</>}
            </button>
            {ollamaAvailable === false && (
              <p style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 8 }}>
                Install Ollama first, then come back to start Brain.
              </p>
            )}
          </div>
        ) : tiersData ? (
          <div className="tier-table">
            <div className="tier-table-header">
              <span>Tier</span>
              <span>Model</span>
              <span>Status</span>
              <span>Avg Latency</span>
            </div>
            {TIER_ORDER.filter((t) => tiersData[t]).map((tier) => {
              const t = tiersData[tier];
              const color = tierColor(t.status, t.circuit_open);
              const latMs = t.avg_ms;
              return (
                <div key={tier} className="tier-table-row">
                  <span className="tier-name">{tier}</span>
                  <code className="tier-model">{t.model ?? "—"}</code>
                  <span style={{ color, fontSize: 12, fontWeight: 600 }}>
                    {t.circuit_open
                      ? `Circuit open${t.recovery_in ? ` — ${t.recovery_in}s` : ""}`
                      : t.status}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: latMs == null ? "var(--text-dim)" : latMs < 500 ? "var(--success)" : latMs < 2000 ? "var(--warning)" : "var(--danger)",
                    }}
                  >
                    {latMs != null ? `${latMs.toFixed(0)}ms` : "—"}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="model-status-card">
            <div className="model-status-row">
              <Brain size={16} style={{ color: "var(--accent)" }} />
              <span className="model-status-name">{activeModel ?? "No model loaded"}</span>
              {health?.status && (
                <span className="status-badge status-badge-healthy">{health.status}</span>
              )}
            </div>
            <p className="settings-hint" style={{ marginTop: 8 }}>
              Per-tier health requires brain v2.0+ (<code>/v1/health/tiers</code>).
            </p>
          </div>
        )}
      </section>

      {/* 3. SDLC phase */}
      <section className="settings-section">
        <h2 className="section-title">SDLC Phase</h2>
        <p className="section-desc">
          Controls which quality gates brain enforces. Development is permissive;
          production is strictest.
        </p>
        <div className="sdlc-selector">
          {SDLC_PHASES.map((phase) => (
            <button
              key={phase}
              className={`sdlc-btn ${sdlcPhase === phase ? "sdlc-btn-active" : ""}`}
              onClick={() => setSdlc(phase)}
              disabled={sdlcSaving}
            >
              {phase.charAt(0).toUpperCase() + phase.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* 4. Model download with progress */}
      <section className="settings-section">
        <h2 className="section-title">Available Models</h2>
        <div className="model-list">
          {CURATED_MODELS.map((m) => {
            const status = pullStatuses[m.name] ?? "idle";
            const prog = pullProgress[m.name];
            const isActive = m.name === activeModel;
            const pct =
              prog?.total && prog?.completed
                ? Math.round((prog.completed / prog.total) * 100)
                : null;
            return (
              <div key={m.name} className={`model-row ${isActive ? "model-row-active" : ""}`}>
                <div className="model-info">
                  <span className="model-name">
                    {m.name}
                    {m.recommended && <span className="model-tag">recommended</span>}
                    {isActive && <span className="model-tag model-tag-active">active</span>}
                  </span>
                  <span className="model-desc">{m.desc}</span>
                  {status === "pulling" && (
                    <div className="pull-progress-wrap">
                      <div className="pull-progress-bar-track">
                        <div
                          className="pull-progress-bar-fill"
                          style={{ width: `${pct ?? 0}%` }}
                        />
                      </div>
                      <span className="pull-progress-pct">{pct != null ? `${pct}%` : "…"}</span>
                    </div>
                  )}
                </div>
                {!isActive && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: "6px 12px", flexShrink: 0 }}
                    disabled={status === "pulling" || offline}
                    onClick={() => pullModel(m.name)}
                  >
                    {status === "pulling" ? (
                      <><RefreshCw size={12} className="spin" /> Pulling…</>
                    ) : status === "done" ? (
                      <><CheckCircle size={12} /> Pulled</>
                    ) : status === "error" ? (
                      "Failed — retry"
                    ) : (
                      <><Download size={12} /> Pull</>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Custom pull */}
      <section className="settings-section">
        <h2 className="section-title">Pull Custom Model</h2>
        <p className="section-desc">Enter any Ollama model name (e.g. <code>mistral:7b</code>).</p>
        <div className="pull-row">
          <input
            className="text-input"
            placeholder="model:tag"
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && pullModel(customModel)}
            disabled={offline}
          />
          <button
            className="btn-primary"
            disabled={!customModel.trim() || offline || pullStatuses[customModel] === "pulling"}
            onClick={() => pullModel(customModel)}
          >
            {pullStatuses[customModel] === "pulling" ? (
              <><RefreshCw size={13} className="spin" /> Pulling…</>
            ) : (
              <><Download size={13} /> Pull</>
            )}
          </button>
        </div>
      </section>

      {/* 5. Brain config editor */}
      <section className="settings-section">
        <button
          className="collapsible-header"
          onClick={() => setBrainConfigOpen((o) => !o)}
        >
          <Settings size={14} />
          <span>Brain Config Editor (brain.json)</span>
          {brainConfigOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        {brainConfigOpen && (
          <div className="collapsible-body">
            <p className="section-desc">
              Editing <code>~/.synapses/brain.json</code>. Restart brain from Dashboard after saving.
            </p>
            {brainConfigRaw ? (
              <>
                <textarea
                  className="code-textarea"
                  value={brainConfigRaw}
                  onChange={(e) => setBrainConfigRaw(e.target.value)}
                  rows={16}
                  spellCheck={false}
                />
                {brainConfigError && (
                  <p style={{ color: "var(--danger)", fontSize: 12, marginTop: 6 }}>
                    {brainConfigError}
                  </p>
                )}
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                  <button className="btn-primary" onClick={saveBrainConfig} disabled={brainConfigSaving}>
                    {brainConfigSaving
                      ? <><RefreshCw size={13} className="spin" /> Saving…</>
                      : "Save brain.json"}
                  </button>
                  <button
                    className="btn-ghost"
                    onClick={() => invoke<string>("read_brain_config").then(setBrainConfigRaw).catch(() => {})}
                  >
                    Reload
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">
                brain.json not found at ~/.synapses/brain.json
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
