import { useState, useEffect } from "react";
import {
  Download,
  RefreshCw,
  CheckCircle,
  Cpu,
  MemoryStick,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../context/ToastContext";

// Ollama runs on its default port 11434; synapses daemon is on 11435.
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

type PullStatus = "idle" | "pulling" | "done" | "error";
type PullProgress = { completed?: number; total?: number };

export function Models() {
  const { addToast } = useToast();
  const [pullStatuses, setPullStatuses] = useState<Record<string, PullStatus>>({});
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});
  const [customModel, setCustomModel] = useState("");
  const [sdlcPhase, setSdlcPhase] = useState<SdlcPhase>("development");
  const [sdlcSaving, setSdlcSaving] = useState(false);
  const [ramGb, setRamGb] = useState(0);
  const [ollamaModels, setOllamaModels] = useState(4);
  const [ollamaConfigSaved, setOllamaConfigSaved] = useState(false);

  useEffect(() => {
    invoke<number>("get_system_ram_gb").then(setRamGb).catch(() => {});
  }, []);

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
    setSdlcPhase(phase);
    addToast("success", `SDLC phase set to ${phase}`);
    setSdlcSaving(false);
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

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">AI Models</h1>
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

      {/* 2. SDLC phase */}
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

      {/* 3. Model download with progress */}
      <section className="settings-section">
        <h2 className="section-title">Available Models</h2>
        <div className="model-list">
          {CURATED_MODELS.map((m) => {
            const status = pullStatuses[m.name] ?? "idle";
            const prog = pullProgress[m.name];
            const pct =
              prog?.total && prog?.completed
                ? Math.round((prog.completed / prog.total) * 100)
                : null;
            return (
              <div key={m.name} className="model-row">
                <div className="model-info">
                  <span className="model-name">
                    {m.name}
                    {m.recommended && <span className="model-tag">recommended</span>}
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
                <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: "6px 12px", flexShrink: 0 }}
                    disabled={status === "pulling"}
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
          />
          <button
            className="btn-primary"
            disabled={!customModel.trim() || pullStatuses[customModel] === "pulling"}
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

    </div>
  );
}
