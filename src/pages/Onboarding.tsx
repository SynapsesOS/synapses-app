import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap, FolderOpen, Brain, Plug, CheckCircle, ArrowRight, Shield,
  AlertCircle, RefreshCw, Code2, Download, Info,
} from "lucide-react";

interface IndexingProgress {
  state: "idle" | "indexing" | "ready";
  files_done: number;
  files_total: number;
  pct: number;
}

interface Props {
  onComplete: () => void;
}

const ALL_EDITORS = [
  { id: "claude",      label: "Claude Code",  hint: ".mcp.json" },
  { id: "cursor",      label: "Cursor",        hint: ".cursor/mcp.json" },
  { id: "windsurf",    label: "Windsurf",      hint: ".windsurf/mcp_config.json" },
  { id: "zed",         label: "Zed",           hint: ".zed/settings.json" },
  { id: "vscode",      label: "VS Code",       hint: ".vscode/mcp.json" },
  { id: "antigravity", label: "Antigravity",   hint: ".agent/mcp.json" },
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
  const [indexProgress, setIndexProgress] = useState<IndexingProgress | null>(null);
  const indexPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Step 2 — Ollama / Brain
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [ollamaInfo, setOllamaInfo] = useState<OllamaStatus>({ running: false });
  const [pullingModels, setPullingModels] = useState<Record<string, PullProgress>>({});
  const [pulledModels, setPulledModels] = useState<Set<string>>(new Set());
  const unsubPullProgress = useRef<(() => void) | null>(null);
  const unsubPullDone = useRef<(() => void) | null>(null);

  // Step 3 — Connect editor
  const [detectedAgents, setDetectedAgents] = useState<string[]>([]);
  const [writtenEditors, setWrittenEditors] = useState<Record<string, boolean>>({});
  const [writingEditor, setWritingEditor] = useState<string | null>(null);

  // Check Ollama + detect installed agents on mount
  useEffect(() => {
    checkOllama();
    invoke<string[]>("detect_installed_agents")
      .then(setDetectedAgents)
      .catch(() => {});
  }, []);

  // When arriving at step 3 with a project, pre-check already-connected agents
  useEffect(() => {
    if (step !== 3 || !indexedPath) return;
    const toCheck = detectedAgents.length > 0 ? detectedAgents : ALL_EDITORS.map((e) => e.id);
    Promise.all(
      toCheck.map((id) =>
        invoke<boolean>("check_mcp_config", { editor: id, projectPath: indexedPath })
          .then((ok) => (ok ? id : null))
          .catch(() => null)
      )
    ).then((results) => {
      const already: Record<string, boolean> = {};
      results.forEach((id) => { if (id) already[id] = true; });
      setWrittenEditors((prev) => ({ ...already, ...prev }));
    });
  }, [step, indexedPath]);

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
    setIndexOutput("");
    setIndexProgress(null);

    // Poll indexing_progress from the daemon every 500ms while indexing.
    indexPollRef.current = setInterval(async () => {
      try {
        const p = await invoke<IndexingProgress>("get_indexing_progress");
        if (p.state === "indexing" || p.state === "ready") setIndexProgress(p);
      } catch { /* daemon not ready yet, ignore */ }
    }, 500);

    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", selected] });
      setIndexedPath(selected);
      setIndexOutput(out || "Indexed successfully.");
    } catch (e) {
      setIndexOutput(`Error: ${e}`);
    } finally {
      if (indexPollRef.current) { clearInterval(indexPollRef.current); indexPollRef.current = null; }
      setIndexing(false);
    }
  }

  async function writeEditorConfig(editorId: string) {
    setWritingEditor(editorId);
    try {
      await invoke<string>("write_mcp_config", { editor: editorId, projectPath: indexedPath ?? "" });
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
        <>
          <button className="btn-primary btn-large" onClick={handleSelectProject} disabled={indexing}>
            <FolderOpen size={16} />
            {indexing ? "Indexing…" : "Choose project directory"}
          </button>
          {indexing && (
            <div className="index-progress-wrap">
              <div className="index-progress-bar-track">
                <div
                  className="index-progress-bar-fill"
                  style={{ width: `${indexProgress?.pct ?? 0}%` }}
                />
              </div>
              <div className="index-progress-label">
                {indexProgress && indexProgress.files_total > 0
                  ? `${indexProgress.files_done.toLocaleString()} / ${indexProgress.files_total.toLocaleString()} files · ${indexProgress.pct}%`
                  : "Building file list…"}
              </div>
            </div>
          )}
        </>
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
        using <strong>Ollama</strong> on its default port (11434).
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
            <span>Ollama not found — install from <strong>ollama.com</strong> and start it normally</span>
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

    // Step 3 — Connect agent
    <div key="connect" className="onboarding-step">
      <div className="onboarding-icon"><Plug size={48} /></div>
      <h1 className="onboarding-title">Connect your AI agent</h1>

      {/* Project context */}
      {indexedPath ? (
        <div className="onboarding-project-badge">
          <FolderOpen size={13} />
          <span>{indexedPath.split("/").slice(-2).join("/")}</span>
        </div>
      ) : (
        <div className="onboarding-warn-callout">
          <AlertCircle size={14} />
          <span>
            No project indexed yet — go back to step 1 first. Synapses connects agents
            to a specific project directory.
          </span>
        </div>
      )}

      {indexedPath && (() => {
        const visibleEditors = detectedAgents.length > 0
          ? ALL_EDITORS.filter((e) => detectedAgents.includes(e.id))
          : ALL_EDITORS;
        return (
          <>
            <p className="onboarding-desc" style={{ marginTop: 10 }}>
              {detectedAgents.length > 0
                ? `${visibleEditors.length} agent${visibleEditors.length !== 1 ? "s" : ""} detected on your machine. Click to add Synapses — no copy-pasting needed.`
                : "No agents detected. Click any to try adding Synapses manually."}
            </p>
            <div className="editor-connect-grid">
              {visibleEditors.map((ed) => {
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
                      {done ? "✓ Connected · " : ""}{ed.hint}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="onboarding-hint" style={{ marginTop: 12 }}>
              Not listed? Add <code>{`{ "transport": "http", "url": "http://127.0.0.1:11435/mcp" }`}</code> to your agent's MCP config.
            </p>
          </>
        );
      })()}

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(4)} disabled={!indexedPath}>
          {Object.keys(writtenEditors).length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 4 — Privacy
    <div key="privacy" className="onboarding-step">
      <div className="onboarding-icon" style={{ color: "var(--success)" }}>
        <Shield size={48} />
      </div>
      <h1 className="onboarding-title">Your data stays local</h1>
      <p className="onboarding-desc">
        Synapses stores everything on your machine. No cloud sync. No telemetry. No account.
      </p>
      <div className="privacy-checklist">
        <PrivacyItem checked label="Code graph" desc="Your indexed codebase — stays on this machine, never uploaded" locked />
        <PrivacyItem checked label="Session logs" desc="Tool call counts and latency for local analytics (no code content)" />
        <PrivacyItem checked label="Web cache" desc="Docs fetched by agents — cached locally, not forwarded anywhere" />
      </div>

      <div className="privacy-agent-note">
        <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>
          When your agent (Claude, GPT-4, etc.) calls Synapses, it receives context and
          sends it to its own cloud service to generate a response. Synapses controls
          what context is prepared — not where your agent sends it.
        </span>
      </div>

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(3)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(5)}>
          Continue <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 5 — Done
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
