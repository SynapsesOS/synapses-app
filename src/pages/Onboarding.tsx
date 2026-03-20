import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap, FolderOpen, Plug, CheckCircle, ArrowRight, Shield,
  AlertCircle, RefreshCw, Code2,
} from "lucide-react";

interface IndexingProgress {
  state: "idle" | "indexing" | "ready";
  files_done: number;
  files_total: number;
  pct: number;
  label?: string;
}

interface Props {
  onComplete: () => void;
}

const ALL_EDITORS = [
  { id: "claude",      label: "Claude Code",  emoji: "🤖", hint: ".mcp.json" },
  { id: "cursor",      label: "Cursor",        emoji: "⚡", hint: ".cursor/mcp.json" },
  { id: "windsurf",    label: "Windsurf",      emoji: "🌊", hint: ".windsurf/mcp_config.json" },
  { id: "zed",         label: "Zed",           emoji: "⚡", hint: ".zed/settings.json" },
  { id: "vscode",      label: "VS Code",       emoji: "💙", hint: ".vscode/mcp.json" },
  { id: "antigravity", label: "Antigravity",   emoji: "🔮", hint: ".agent/mcp.json" },
];

const INDEXING_MESSAGES = [
  "Reading your files…",
  "Building the knowledge graph…",
  "Analyzing code structure…",
  "Mapping relationships…",
  "Almost there…",
];

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);

  // Step 1 — Index
  const [indexedPath, setIndexedPath]       = useState<string | null>(null);
  const [indexing, setIndexing]             = useState(false);
  const [, setIndexOutput]                  = useState("");
  const [indexProgress, setIndexProgress]   = useState<IndexingProgress | null>(null);
  const indexPollRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexStartRef  = useRef<number | null>(null);
  const [elapsedSecs, setElapsedSecs]       = useState(0);

  // Step 2 — Connect editor
  const [detectedAgents, setDetectedAgents]   = useState<string[]>([]);
  const [writtenEditors, setWrittenEditors]   = useState<Record<string, boolean>>({});
  const [writingEditor, setWritingEditor]     = useState<string | null>(null);

  useEffect(() => {
    invoke<string[]>("detect_installed_agents")
      .then(setDetectedAgents)
      .catch(() => {});
  }, []);

  // Elapsed timer
  useEffect(() => {
    if (!indexing) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      if (indexStartRef.current != null)
        setElapsedSecs(Math.floor((Date.now() - indexStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [indexing]);

  // Pre-check already-connected agents when arriving at step 2
  useEffect(() => {
    if (step !== 2 || !indexedPath) return;
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

  async function handleSelectProject() {
    const selected = await open({ directory: true, multiple: false, title: "Select your project directory" });
    if (!selected || typeof selected !== "string") return;
    setIndexing(true);
    setIndexOutput("");
    setIndexProgress(null);
    indexStartRef.current = Date.now();
    setElapsedSecs(0);

    indexPollRef.current = setInterval(async () => {
      try {
        const p = await invoke<IndexingProgress>("get_indexing_progress");
        if (p.state === "indexing" || p.state === "ready") setIndexProgress(p);
      } catch { /**/ }
    }, 500);

    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", selected] });
      setIndexedPath(selected);
      setIndexOutput(out || "Indexed successfully.");
      invoke("preregister_project", { path: selected }).catch(() => {});
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
    } finally { setWritingEditor(null); }
  }

  async function finish() {
    await invoke("set_onboarding_done");
    onComplete();
  }

  const STEPS = 4; // 0=Welcome, 1=Index, 2=Connect, 3=Done

  const indexMsgIdx = Math.min(
    Math.floor(elapsedSecs / 4),
    INDEXING_MESSAGES.length - 1
  );

  const visibleEditors = detectedAgents.length > 0
    ? ALL_EDITORS.filter((e) => detectedAgents.includes(e.id))
    : ALL_EDITORS;

  return (
    <div className="onboarding-container">
      {/* Step dots */}
      <div className="onboarding-progress">
        {Array.from({ length: STEPS }).map((_, i) => (
          <div key={i} className={`progress-dot ${i === step ? "active" : i < step ? "done" : ""}`} />
        ))}
      </div>

      {/* ── Step 0: Welcome ───────────────────────────────────────────────── */}
      {step === 0 && (
        <div className="onboarding-step">
          <div className="onboarding-icon">
            <Zap size={52} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="onboarding-title">Welcome to Synapses</h1>
          <p className="onboarding-desc">
            Synapses gives your AI coding assistants a deep, persistent understanding
            of your codebase. Better context. Better answers. Less back-and-forth.
          </p>
          <div className="onboarding-features">
            <div className="onboarding-feature">
              <span className="onboarding-feature-icon">🧠</span>
              <span>Deep code understanding</span>
            </div>
            <div className="onboarding-feature">
              <span className="onboarding-feature-icon">💾</span>
              <span>Memory across sessions</span>
            </div>
            <div className="onboarding-feature">
              <span className="onboarding-feature-icon">🔒</span>
              <span>100% local — no cloud</span>
            </div>
          </div>
          <button className="btn-primary btn-large" onClick={() => setStep(1)}>
            Get started <ArrowRight size={16} />
          </button>
        </div>
      )}

      {/* ── Step 1: Index a project ───────────────────────────────────────── */}
      {step === 1 && (
        <div className="onboarding-step">
          <div className="onboarding-icon">
            <FolderOpen size={52} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="onboarding-title">Let's find your code</h1>
          <p className="onboarding-desc">
            Point Synapses at a project folder. It'll read your code and build a
            knowledge graph — all locally, in about 30–60 seconds.
          </p>

          {!indexedPath ? (
            <>
              <button
                className="btn-primary btn-large"
                onClick={handleSelectProject}
                disabled={indexing}
              >
                <FolderOpen size={16} />
                {indexing ? "Indexing…" : "Choose a project folder"}
              </button>

              {indexing && (
                <div className="index-progress-wrap" style={{ width: "100%", maxWidth: 400 }}>
                  <div className="index-progress-bar-track">
                    <div
                      className={`index-progress-bar-fill${indexProgress?.label ? " is-resolving" : ""}`}
                      style={{ width: `${indexProgress?.pct ?? 0}%` }}
                    />
                  </div>
                  <div className="index-progress-label">
                    {indexProgress?.files_total && indexProgress.files_total > 0
                      ? `${indexProgress.files_done.toLocaleString()} / ${indexProgress.files_total.toLocaleString()} files · ${indexProgress.pct}%`
                      : INDEXING_MESSAGES[indexMsgIdx]}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="onboarding-success">
              <CheckCircle size={22} style={{ color: "var(--success)", flexShrink: 0 }} />
              <div>
                <div className="success-title">Project indexed!</div>
                <div className="success-path">{indexedPath.split("/").slice(-2).join("/")}</div>
              </div>
            </div>
          )}

          <div className="step-nav">
            <button className="btn-ghost" onClick={() => setStep(0)}>Back</button>
            <button
              className="btn-primary"
              onClick={() => setStep(2)}
              disabled={indexing}
            >
              {indexedPath ? "Continue" : "Skip for now"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Connect editor ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="onboarding-step">
          <div className="onboarding-icon">
            <Plug size={52} style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="onboarding-title">Connect your AI assistant</h1>

          {!indexedPath ? (
            <div className="onboarding-warn-callout">
              <AlertCircle size={14} />
              <span>Go back and index a project first — Synapses connects to a specific folder.</span>
            </div>
          ) : (
            <>
              <p className="onboarding-desc">
                {detectedAgents.length > 0
                  ? `${visibleEditors.length} assistant${visibleEditors.length !== 1 ? "s" : ""} found on your machine. Click to connect — no copy-pasting needed.`
                  : "Click any assistant to add Synapses config automatically."}
              </p>
              <div className="editor-connect-grid">
                {visibleEditors.map((ed) => {
                  const done    = writtenEditors[ed.id];
                  const writing = writingEditor === ed.id;
                  return (
                    <button
                      key={ed.id}
                      className={`editor-connect-card ${done ? "editor-connect-done" : ""}`}
                      onClick={() => !done && writeEditorConfig(ed.id)}
                      disabled={writing}
                    >
                      <div className="editor-connect-top">
                        <span style={{ fontSize: 20 }}>{ed.emoji}</span>
                        <span className="editor-connect-label">{ed.label}</span>
                        {done && <CheckCircle size={14} style={{ color: "var(--success)", marginLeft: "auto" }} />}
                        {writing && <RefreshCw size={14} className="spin" style={{ marginLeft: "auto" }} />}
                      </div>
                      <span className="editor-connect-hint">
                        {done ? "✓ Connected" : "Click to connect"}
                      </span>
                    </button>
                  );
                })}
              </div>
              <p className="onboarding-hint">
                <Code2 size={12} style={{ display: "inline", marginRight: 4 }} />
                Not listed? Add{" "}
                <code>{`{ "transport": "http", "url": "http://127.0.0.1:11435/mcp" }`}</code>{" "}
                to your editor's MCP config.
              </p>
            </>
          )}

          <div className="step-nav">
            <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
            <button
              className="btn-primary"
              onClick={() => setStep(3)}
              disabled={!indexedPath && Object.keys(writtenEditors).length === 0}
            >
              {Object.keys(writtenEditors).length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Done ─────────────────────────────────────────────────── */}
      {step === 3 && (
        <div className="onboarding-step">
          <div className="onboarding-icon" style={{ color: "var(--success)" }}>
            <CheckCircle size={52} />
          </div>
          <h1 className="onboarding-title">You're all set!</h1>
          <p className="onboarding-desc">
            Synapses is running. Your AI assistant now has deep knowledge of your codebase —
            call graphs, search, memory, and more. All local.
          </p>

          <div className="onboarding-what-next">
            <div className="what-next-item">
              <Shield size={16} style={{ color: "var(--success)", flexShrink: 0 }} />
              <div>
                <div className="what-next-label">Privacy</div>
                <div className="what-next-desc">Your code never leaves your machine</div>
              </div>
            </div>
            <div className="what-next-item">
              <Zap size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
              <div>
                <div className="what-next-label">Automatic</div>
                <div className="what-next-desc">Synapses works silently in the background</div>
              </div>
            </div>
          </div>

          <button className="btn-primary btn-large" onClick={finish}>
            Open Dashboard <ArrowRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
