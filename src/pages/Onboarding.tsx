import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap, FolderOpen, Brain, Plug, Globe, CheckCircle, ArrowRight, Shield,
  AlertCircle, RefreshCw, Code2, Download,
} from "lucide-react";

interface Props {
  onComplete: () => void;
}

const EDITORS = [
  { id: "claude",   label: "Claude Code", hint: "~/.claude/settings.json" },
  { id: "cursor",   label: "Cursor",      hint: "~/.cursor/mcp.json" },
  { id: "windsurf", label: "Windsurf",    hint: "~/.codeium/windsurf/mcp_config.json" },
  { id: "zed",      label: "Zed",         hint: "~/.config/zed/settings.json" },
];

const SYNAPSES_MODELS = [
  { name: "synapses/sentry",    desc: "Fast ingest — 397 MB" },
  { name: "synapses/critic",    desc: "Code review — 986 MB" },
  { name: "synapses/librarian", desc: "Semantic enrichment — 986 MB" },
  { name: "synapses/navigator", desc: "Context navigation — 1.3 GB" },
  { name: "synapses/archivist", desc: "Memory & learning — 1.3 GB" },
];

interface OllamaStatus {
  running: boolean;
  version?: string;
  models?: string[];
}

interface PullProgress {
  model: string;
  status: string;
  completed?: number;
  total?: number;
}

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);

  // Step 1 — Index
  const [indexedPath, setIndexedPath] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexOutput, setIndexOutput] = useState("");

  // Step 2 — Ollama / Brain
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [ollamaInfo, setOllamaInfo] = useState<OllamaStatus>({ running: false });
  const [pullingModels, setPullingModels] = useState<Record<string, PullProgress>>({});
  const [pulledModels, setPulledModels] = useState<Set<string>>(new Set());
  const unsubPullProgress = useRef<(() => void) | null>(null);
  const unsubPullDone = useRef<(() => void) | null>(null);

  // Step 3 — Scout
  const [scoutInstalled, setScoutInstalled] = useState<boolean | null>(null);
  const [scoutDownloading, setScoutDownloading] = useState(false);
  const [scoutProgress, setScoutProgress] = useState(0);

  // Step 4 — Connect editor
  const [writtenEditors, setWrittenEditors] = useState<Record<string, boolean>>({});
  const [writingEditor, setWritingEditor] = useState<string | null>(null);

  // Check Ollama on mount
  useEffect(() => {
    checkOllama();
  }, []);

  // Check if scout binary exists
  useEffect(() => {
    invoke<string>("get_synapses_data_dir").then((dir) => {
      // Try to invoke get_service_status and look for scout with healthy status
      invoke<{ name: string; status: string }[]>("get_service_status").then((services) => {
        const scout = services.find((s) => s.name === "scout");
        setScoutInstalled(scout?.status === "healthy");
      }).catch(() => setScoutInstalled(false));
    });
  }, []);

  async function checkOllama() {
    setOllamaStatus("checking");
    try {
      const info = await invoke<OllamaStatus>("check_ollama");
      setOllamaInfo(info);
      setOllamaStatus(info.running ? "ok" : "missing");
    } catch {
      setOllamaStatus("missing");
    }
  }

  // Subscribe to model pull events
  async function subscribeToModelEvents() {
    const u1 = await listen<PullProgress>("ollama-pull-progress", (e) => {
      setPullingModels((prev) => ({ ...prev, [e.payload.model]: e.payload }));
    });
    const u2 = await listen<{ model: string; success: boolean }>("ollama-pull-done", (e) => {
      if (e.payload.success) {
        setPulledModels((prev) => new Set([...prev, e.payload.model]));
      }
      setPullingModels((prev) => {
        const next = { ...prev };
        delete next[e.payload.model];
        return next;
      });
    });
    unsubPullProgress.current = u1;
    unsubPullDone.current = u2;
  }

  useEffect(() => {
    return () => {
      unsubPullProgress.current?.();
      unsubPullDone.current?.();
    };
  }, []);

  async function pullModel(name: string) {
    await subscribeToModelEvents();
    invoke("pull_model", { model: name }).catch(() => {
      setPullingModels((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    });
  }

  async function pullAllModels() {
    await subscribeToModelEvents();
    for (const m of SYNAPSES_MODELS) {
      const alreadyInstalled = (ollamaInfo.models ?? []).some((im) =>
        im.startsWith(m.name.split(":")[0])
      );
      if (!alreadyInstalled && !pulledModels.has(m.name)) {
        invoke("pull_model", { model: m.name }).catch(() => {});
      }
    }
  }

  async function handleSelectProject() {
    const selected = await open({ directory: true, multiple: false, title: "Select your project directory" });
    if (!selected || typeof selected !== "string") return;
    setIndexing(true);
    setIndexOutput("Indexing…");
    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", selected] });
      setIndexedPath(selected);
      setIndexOutput(out || "Indexed successfully.");
    } catch (e) {
      setIndexOutput(`Error: ${e}`);
    } finally {
      setIndexing(false);
    }
  }

  async function handleDownloadScout() {
    setScoutDownloading(true);
    setScoutProgress(0);
    const u = await listen<number>("scout-download-progress", (e) => setScoutProgress(e.payload));
    const u2 = await listen<{ success: boolean; error?: string }>("scout-download-done", (e) => {
      setScoutDownloading(false);
      setScoutInstalled(e.payload.success);
      u();
      u2();
    });
    invoke("download_scout").catch(() => {
      setScoutDownloading(false);
      u();
      u2();
    });
  }

  async function writeEditorConfig(editorId: string) {
    setWritingEditor(editorId);
    try {
      await invoke<string>("write_mcp_config", { editor: editorId });
      setWrittenEditors((p) => ({ ...p, [editorId]: true }));
    } catch (e) {
      alert(`Could not write config: ${e}`);
    } finally {
      setWritingEditor(null);
    }
  }

  async function finish() {
    await invoke("set_onboarding_done");
    onComplete();
  }

  const installedModels = ollamaInfo.models ?? [];
  const synapsesModelsInstalled = SYNAPSES_MODELS.filter((m) =>
    installedModels.some((im) => im.startsWith(m.name.split(":")[0])) || pulledModels.has(m.name)
  ).length;

  const steps = [
    // Step 0 — Welcome
    <div key="welcome" className="onboarding-step">
      <div className="onboarding-icon"><Zap size={48} /></div>
      <h1 className="onboarding-title">Welcome to Synapses</h1>
      <p className="onboarding-desc">
        Code intelligence for AI agents. Synapses gives your agents a persistent,
        structured understanding of your codebase — call graphs, architecture rules,
        semantic search, session memory, and analytics. Everything runs locally.
      </p>
      <button className="btn-primary btn-large" onClick={() => setStep(1)}>
        Get started <ArrowRight size={16} />
      </button>
    </div>,

    // Step 1 — Index a project
    <div key="index" className="onboarding-step">
      <div className="onboarding-icon"><FolderOpen size={48} /></div>
      <h1 className="onboarding-title">Index your first project</h1>
      <p className="onboarding-desc">
        Select a project directory to build a code intelligence graph. Supports
        Go, TypeScript, Python, Rust, Java, and 13 more languages.
      </p>
      {!indexedPath ? (
        <button className="btn-primary btn-large" onClick={handleSelectProject} disabled={indexing}>
          <FolderOpen size={16} />
          {indexing ? "Indexing…" : "Choose project directory"}
        </button>
      ) : (
        <div className="onboarding-success">
          <CheckCircle size={20} className="success-icon" />
          <div>
            <div className="success-title">Indexed!</div>
            <div className="success-path">{indexedPath}</div>
          </div>
        </div>
      )}
      {indexOutput && <pre className="index-output">{indexOutput}</pre>}
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(0)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(2)} disabled={indexing}>
          {indexedPath ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 2 — Brain / Ollama (optional)
    <div key="brain" className="onboarding-step">
      <div className="onboarding-icon"><Brain size={48} /></div>
      <h1 className="onboarding-title">AI Intelligence (optional)</h1>
      <p className="onboarding-desc">
        Synapses includes a built-in AI brain that adds LLM-powered enrichment —
        semantic search, code summaries, and session memory. It runs fully locally
        {/* NOTE: Synapses daemon occupies port 11434 (Ollama's default).
            Ollama must be configured to run on port 11435 instead:
              OLLAMA_HOST=127.0.0.1:11435 ollama serve
            TODO: long-term fix — move synapses daemon off 11434 so Ollama
            can keep its default port. */}
        using <strong>Ollama</strong> on port 11435.
      </p>

      <div className="onboarding-detection-card">
        {ollamaStatus === "checking" && (
          <div className="detect-row detect-checking">
            <RefreshCw size={15} className="spin" />
            <span>Detecting Ollama…</span>
          </div>
        )}
        {ollamaStatus === "ok" && (
          <div className="detect-row detect-ok">
            <CheckCircle size={15} />
            <span>Ollama {ollamaInfo.version} detected — {installedModels.length} model{installedModels.length !== 1 ? "s" : ""} installed</span>
          </div>
        )}
        {ollamaStatus === "missing" && (
          <div className="detect-row detect-warn">
            <AlertCircle size={15} />
            <span>Ollama not found — install from <strong>ollama.com</strong> and configure it on port 11435</span>
          </div>
        )}

        {ollamaStatus === "ok" && (
          <div className="detect-model-grid">
            {SYNAPSES_MODELS.map((m) => {
              const installed = installedModels.some((im) => im.startsWith(m.name.split(":")[0])) || pulledModels.has(m.name);
              const pulling = pullingModels[m.name];
              return (
                <div key={m.name} className={`detect-model-row ${installed ? "detect-model-ok" : ""}`}>
                  {installed
                    ? <CheckCircle size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
                    : pulling
                    ? <RefreshCw size={12} className="spin" style={{ flexShrink: 0 }} />
                    : <div style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid var(--border)", flexShrink: 0 }} />
                  }
                  <code style={{ fontSize: 11 }}>{m.name}</code>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>
                    {pulling
                      ? pulling.total
                        ? `${Math.round((pulling.completed ?? 0) / pulling.total * 100)}%`
                        : pulling.status
                      : m.desc}
                  </span>
                  {!installed && !pulling && (
                    <button
                      className="btn-ghost"
                      style={{ padding: "1px 6px", fontSize: 10, marginLeft: 6 }}
                      onClick={() => pullModel(m.name)}
                    >
                      Pull
                    </button>
                  )}
                </div>
              );
            })}
            {synapsesModelsInstalled < SYNAPSES_MODELS.length && Object.keys(pullingModels).length === 0 && (
              <button
                className="btn-secondary btn-sm"
                style={{ marginTop: 10, alignSelf: "flex-start" }}
                onClick={pullAllModels}
              >
                <Download size={12} /> Pull all models
              </button>
            )}
          </div>
        )}
      </div>

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(3)}>
          {ollamaStatus === "ok" ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 3 — Scout (optional)
    <div key="scout" className="onboarding-step">
      <div className="onboarding-icon"><Globe size={48} /></div>
      <h1 className="onboarding-title">Web Intelligence (optional)</h1>
      <p className="onboarding-desc">
        Scout lets your AI agents search the web, fetch documentation, and watch YouTube
        videos — all locally, with a built-in cache. It runs as a background service.
      </p>

      <div className="onboarding-detection-card">
        {scoutInstalled === null && (
          <div className="detect-row detect-checking">
            <RefreshCw size={15} className="spin" />
            <span>Checking Scout…</span>
          </div>
        )}
        {scoutInstalled === true && (
          <div className="detect-row detect-ok">
            <CheckCircle size={15} />
            <span>Scout is running</span>
          </div>
        )}
        {scoutInstalled === false && !scoutDownloading && (
          <div className="detect-row detect-warn">
            <AlertCircle size={15} />
            <span>Scout not installed</span>
          </div>
        )}
        {scoutDownloading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div className="detect-row detect-checking">
              <RefreshCw size={15} className="spin" />
              <span>Downloading Scout… {scoutProgress}%</span>
            </div>
            <div style={{ height: 4, background: "var(--border)", borderRadius: 2 }}>
              <div style={{ width: `${scoutProgress}%`, height: "100%", background: "var(--accent)", borderRadius: 2, transition: "width 0.2s" }} />
            </div>
          </div>
        )}
      </div>

      {scoutInstalled === false && (
        <div className="option-cards">
          <OptionCard
            title="Install Scout"
            desc="Downloads the Scout binary (~60 MB). Enables web search and doc fetching for your agents."
            onClick={handleDownloadScout}
            disabled={scoutDownloading}
          />
          <OptionCard
            title="Skip for now"
            desc="Web intelligence is optional. Synapses works fully without it."
            onClick={() => setStep(4)}
            secondary
          />
        </div>
      )}

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
        {scoutInstalled !== false && (
          <button className="btn-primary" onClick={() => setStep(4)}>
            Continue <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>,

    // Step 4 — Connect agent
    <div key="connect" className="onboarding-step">
      <div className="onboarding-icon"><Plug size={48} /></div>
      <h1 className="onboarding-title">Connect your AI agent</h1>
      <p className="onboarding-desc">
        Click your editor to automatically add Synapses to its MCP config.
        No copy-pasting needed.
      </p>

      <div className="editor-connect-grid">
        {EDITORS.map((ed) => {
          const done = writtenEditors[ed.id];
          const writing = writingEditor === ed.id;
          return (
            <button
              key={ed.id}
              className={`editor-connect-card ${done ? "editor-connect-done" : ""}`}
              onClick={() => !done && writeEditorConfig(ed.id)}
              disabled={writing}
            >
              <div className="editor-connect-top">
                <Code2 size={18} style={{ color: done ? "var(--success)" : "var(--accent)" }} />
                <span className="editor-connect-label">{ed.label}</span>
                {done && <CheckCircle size={14} style={{ color: "var(--success)", marginLeft: "auto" }} />}
                {writing && <RefreshCw size={14} className="spin" style={{ marginLeft: "auto" }} />}
              </div>
              <span className="editor-connect-hint">
                {done ? "✓ Added to " : "Writes to "}{ed.hint}
              </span>
            </button>
          );
        })}
      </div>

      <p className="onboarding-hint" style={{ marginTop: 12 }}>
        Don't see your editor? Add <code>{`{ "transport": "http", "url": "http://127.0.0.1:11434/mcp" }`}</code> manually.
      </p>

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(3)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(5)}>
          {Object.keys(writtenEditors).length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 5 — Privacy
    <div key="privacy" className="onboarding-step">
      <div className="onboarding-icon" style={{ color: "var(--success)" }}>
        <Shield size={48} />
      </div>
      <h1 className="onboarding-title">Your data stays local</h1>
      <p className="onboarding-desc">
        Synapses stores everything on your machine. No cloud sync. No external telemetry.
        No account required.
      </p>
      <div className="privacy-checklist">
        <PrivacyItem checked label="Code graph" desc="Your indexed codebase — required for the tool to function" locked />
        <PrivacyItem checked label="Session logs" desc="Tool call counts and latency for local analytics (no code content)" />
        <PrivacyItem checked label="Web cache" desc="Searches and pages fetched by agents via Scout" />
      </div>
      <p className="onboarding-hint" style={{ textAlign: "center", width: "100%" }}>
        Change these anytime in <strong>Privacy & Data</strong>.
      </p>
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(4)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(6)}>
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 6 — Done
    <div key="done" className="onboarding-step">
      <div className="onboarding-icon success-glow"><CheckCircle size={48} /></div>
      <h1 className="onboarding-title">You're all set!</h1>
      <p className="onboarding-desc">
        Synapses is running. Your AI agent now has deep code intelligence —
        call graphs, architecture rules, semantic search, task memory, and analytics.
        All local. All yours.
      </p>
      <button className="btn-primary btn-large" onClick={finish}>
        Open Dashboard <ArrowRight size={16} />
      </button>
    </div>,
  ];

  return (
    <div className="onboarding-container">
      <div className="onboarding-progress">
        {steps.map((_, i) => (
          <div key={i} className={`progress-dot ${i === step ? "active" : i < step ? "done" : ""}`} />
        ))}
      </div>
      {steps[step]}
    </div>
  );
}

function OptionCard({
  title, desc, onClick, secondary, disabled,
}: {
  title: string; desc: string; onClick: () => void; secondary?: boolean; disabled?: boolean;
}) {
  return (
    <button
      className={`option-card ${secondary ? "option-card-secondary" : ""}`}
      onClick={onClick}
      disabled={disabled}
      style={disabled ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
    >
      <div className="option-title">{title}</div>
      <div className="option-desc">{desc}</div>
    </button>
  );
}

function PrivacyItem({ checked, locked, label, desc }: { checked: boolean; locked?: boolean; label: string; desc: string }) {
  return (
    <div className="privacy-check-row">
      <CheckCircle size={16} style={{ color: checked ? "var(--success)" : "var(--text-dim)", flexShrink: 0 }} />
      <div className="privacy-check-text">
        <span className="privacy-check-label">{label}{locked && " (required)"}</span>
        <span className="privacy-check-desc">{desc}</span>
      </div>
    </div>
  );
}
