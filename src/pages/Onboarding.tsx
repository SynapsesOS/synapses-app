import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Zap, FolderOpen, Brain, Plug, CheckCircle, ArrowRight, Shield,
  AlertCircle, RefreshCw, Code2,
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

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [indexedPath, setIndexedPath] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexOutput, setIndexOutput] = useState("");
  const [ollamaStatus, setOllamaStatus] = useState<"checking" | "ok" | "missing">("checking");
  const [installedModels, setInstalledModels] = useState<string[]>([]);
  const [writtenEditors, setWrittenEditors] = useState<Record<string, boolean>>({});
  const [writingEditor, setWritingEditor] = useState<string | null>(null);

  // Detect Ollama on mount
  useEffect(() => {
    fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) })
      .then((r) => r.json())
      .then((data) => {
        const names: string[] = (data.models ?? []).map((m: { name: string }) => m.name);
        setInstalledModels(names);
        setOllamaStatus("ok");
      })
      .catch(() => setOllamaStatus("missing"));
  }, []);

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

  async function writeEditorConfig(editorId: string) {
    setWritingEditor(editorId);
    try {
      const path = await invoke<string>("write_mcp_config", { editor: editorId });
      setWrittenEditors((p) => ({ ...p, [editorId]: true }));
      console.log("Written to", path);
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

  const synapsesModelsInstalled = SYNAPSES_MODELS.filter((m) =>
    installedModels.some((im) => im.startsWith(m.name.split(":")[0]))
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

    // Step 2 — Brain / Ollama
    <div key="brain" className="onboarding-step">
      <div className="onboarding-icon"><Brain size={48} /></div>
      <h1 className="onboarding-title">AI Brain (optional)</h1>
      <p className="onboarding-desc">
        The Brain sidecar adds LLM-powered enrichment — semantic search, code summaries,
        session memory, and quality gates. It runs fully locally using custom fine-tuned
        models served by <strong>Ollama</strong>.
      </p>

      {/* Ollama status */}
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
            <span>Ollama detected — {installedModels.length} model{installedModels.length !== 1 ? "s" : ""} installed</span>
          </div>
        )}
        {ollamaStatus === "missing" && (
          <div className="detect-row detect-warn">
            <AlertCircle size={15} />
            <span>Ollama not detected — install from <strong>ollama.com</strong> to use Brain</span>
          </div>
        )}

        {ollamaStatus === "ok" && (
          <div className="detect-model-grid">
            {SYNAPSES_MODELS.map((m) => {
              const installed = installedModels.some((im) => im.startsWith(m.name.split(":")[0]));
              return (
                <div key={m.name} className={`detect-model-row ${installed ? "detect-model-ok" : ""}`}>
                  {installed
                    ? <CheckCircle size={12} style={{ color: "var(--success)", flexShrink: 0 }} />
                    : <div style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid var(--border)", flexShrink: 0 }} />
                  }
                  <code style={{ fontSize: 11 }}>{m.name}</code>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: "auto" }}>{m.desc}</span>
                </div>
              );
            })}
            {synapsesModelsInstalled === 0 && (
              <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "8px 0 0" }}>
                Brain will pull these models automatically when first started.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="option-cards">
        <OptionCard
          title="Enable Brain"
          desc={
            ollamaStatus === "ok"
              ? synapsesModelsInstalled > 0
                ? `Ollama ready · ${synapsesModelsInstalled}/${SYNAPSES_MODELS.length} models installed`
                : "Ollama ready · models will be pulled on first start"
              : "Requires Ollama — install from ollama.com first"
          }
          onClick={async () => {
            try { await invoke("restart_service", { name: "brain" }); } catch {}
            setStep(3);
          }}
          disabled={ollamaStatus === "missing"}
        />
        <OptionCard
          title="Skip for now"
          desc="Brain is optional — Synapses works without it. Enable anytime from Models & Brain."
          onClick={() => setStep(3)}
          secondary
        />
      </div>
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
      </div>
    </div>,

    // Step 3 — Connect agent (one-click)
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
        Don't see your editor? Add <code>synapses start</code> as an MCP command manually.
      </p>

      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(4)}>
          {Object.keys(writtenEditors).length > 0 ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 4 — Privacy defaults
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
