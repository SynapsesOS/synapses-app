import { useState, useEffect, useCallback } from "react";
import { Brain, Download, RefreshCw, AlertCircle, MemoryStick } from "lucide-react";

const BRAIN_URL = "http://localhost:11435";

const CURATED_MODELS = [
  { name: "qwen2.5-coder:1.5b", desc: "Default — fast, ~800 MB RAM", recommended: true },
  { name: "qwen2.5-coder:3b", desc: "Better quality, ~1.5 GB RAM", recommended: false },
  { name: "qwen2.5-coder:7b", desc: "High quality, ~4 GB RAM", recommended: false },
  { name: "codellama:7b", desc: "Meta CodeLlama, ~4 GB RAM", recommended: false },
  { name: "deepseek-coder:1.3b", desc: "Lightweight alternative, ~700 MB RAM", recommended: false },
];

interface HealthData {
  status: string;
  model?: string;
  version?: string;
}

type PullStatus = "idle" | "pulling" | "done" | "error";

export function Models() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pullStatuses, setPullStatuses] = useState<Record<string, PullStatus>>({});
  const [customModel, setCustomModel] = useState("");

  const fetchHealth = useCallback(() => {
    setLoading(true);
    fetch(`${BRAIN_URL}/v1/health`, { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((data) => {
        setHealth(data);
        setOffline(false);
      })
      .catch(() => {
        setHealth(null);
        setOffline(true);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  const pullModel = async (modelName: string) => {
    if (!modelName.trim()) return;
    setPullStatuses((p) => ({ ...p, [modelName]: "pulling" }));
    try {
      const res = await fetch(`${BRAIN_URL}/v1/models/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: modelName }),
        signal: AbortSignal.timeout(300000),
      });
      if (res.ok) {
        setPullStatuses((p) => ({ ...p, [modelName]: "done" }));
        fetchHealth();
      } else {
        setPullStatuses((p) => ({ ...p, [modelName]: "error" }));
      }
    } catch {
      setPullStatuses((p) => ({ ...p, [modelName]: "error" }));
    }
  };

  const activeModel = health?.model ?? null;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Models</h1>
        <button className="btn-ghost" onClick={fetchHealth} title="Refresh">
          <RefreshCw size={14} className={loading ? "spin" : ""} />
        </button>
      </div>

      {/* Status */}
      <section className="settings-section">
        <h2 className="section-title">Brain Status</h2>
        {offline ? (
          <div className="offline-banner">
            <AlertCircle size={16} />
            <span>Brain is offline. Start it from the Dashboard.</span>
          </div>
        ) : loading ? (
          <div className="empty-state">Checking brain status…</div>
        ) : (
          <div className="model-status-card">
            <div className="model-status-row">
              <Brain size={16} style={{ color: "var(--accent)" }} />
              <span className="model-status-name">{activeModel ?? "No model loaded"}</span>
              <span className="status-badge status-badge-healthy">online</span>
            </div>
            {health?.version && (
              <div className="model-status-meta">Version: {health.version}</div>
            )}
            <div className="model-ram-note">
              <MemoryStick size={13} />
              <span>Default model requires ~800 MB RAM</span>
            </div>
          </div>
        )}
      </section>

      {/* Available models */}
      <section className="settings-section">
        <h2 className="section-title">Available Models</h2>
        <div className="model-list">
          {CURATED_MODELS.map((m) => {
            const status = pullStatuses[m.name] ?? "idle";
            const isActive = m.name === activeModel;
            return (
              <div key={m.name} className={`model-row ${isActive ? "model-row-active" : ""}`}>
                <div className="model-info">
                  <span className="model-name">
                    {m.name}
                    {m.recommended && <span className="model-tag">recommended</span>}
                    {isActive && <span className="model-tag model-tag-active">active</span>}
                  </span>
                  <span className="model-desc">{m.desc}</span>
                </div>
                {!isActive && (
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 12, padding: "6px 12px" }}
                    disabled={status === "pulling" || offline}
                    onClick={() => pullModel(m.name)}
                  >
                    {status === "pulling" ? (
                      <><RefreshCw size={12} className="spin" /> Pulling…</>
                    ) : status === "done" ? (
                      "Pulled"
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
        {pullStatuses[customModel] === "done" && (
          <p className="settings-hint" style={{ color: "var(--success)", marginTop: 8 }}>
            Model pulled successfully.
          </p>
        )}
        {pullStatuses[customModel] === "error" && (
          <p className="settings-hint" style={{ color: "var(--danger)", marginTop: 8 }}>
            Pull failed. Check model name and try again.
          </p>
        )}
      </section>
    </div>
  );
}
