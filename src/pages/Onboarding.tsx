import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Zap, FolderOpen, Brain, Plug, CheckCircle, ArrowRight, Copy, Shield } from "lucide-react";

interface Props {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [indexedPath, setIndexedPath] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexOutput, setIndexOutput] = useState("");
  const [copied, setCopied] = useState(false);

  // Privacy defaults
  const [privacySettings] = useState({
    log_tool_calls: true,
    log_sessions: true,
    cache_web_searches: true,
  });

  async function handleSelectProject() {
    const selected = await open({ directory: true, multiple: false, title: "Select your project directory" });
    if (!selected || typeof selected !== "string") return;

    setIndexing(true);
    setIndexOutput("Indexing your project…");
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

  async function finish() {
    // Save privacy settings
    await invoke("write_app_settings", { settings: privacySettings }).catch(() => {});
    await invoke("set_onboarding_done");
    onComplete();
  }

  const mcpSnippet = `{
  "mcpServers": {
    "synapses": {
      "command": "synapses",
      "args": ["start"]
    }
  }
}`;

  async function copyMcp() {
    await navigator.clipboard.writeText(mcpSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const steps = [
    // Step 0 — Welcome
    <div key="welcome" className="onboarding-step">
      <div className="onboarding-icon"><Zap size={48} /></div>
      <h1 className="onboarding-title">Welcome to Synapses</h1>
      <p className="onboarding-desc">
        Code intelligence for AI agents. Synapses gives your AI agents a persistent,
        structured understanding of your codebase — call graphs, architecture rules,
        semantic search, session memory, and analytics.
      </p>
      <p className="onboarding-desc">
        Everything runs locally. Your code never leaves your machine.
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
        Select a project directory to build a code intelligence graph. Synapses supports
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
        <button
          className="btn-primary"
          onClick={() => setStep(2)}
          disabled={indexing}
        >
          {indexedPath ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 2 — Brain (optional)
    <div key="brain" className="onboarding-step">
      <div className="onboarding-icon"><Brain size={48} /></div>
      <h1 className="onboarding-title">AI Enrichment (optional)</h1>
      <p className="onboarding-desc">
        The <strong>brain</strong> sidecar adds LLM-powered summaries, semantic search,
        and context enrichment to your code graph. Runs locally via Ollama — your code
        never leaves your machine.
      </p>
      <div className="option-cards">
        <OptionCard
          title="Enable brain"
          desc="Download llama-server + model (~800 MB). Best experience."
          onClick={async () => {
            try { await invoke("run_synapses_cmd", { args: ["daemon", "start", "--service", "brain"] }); } catch {}
            setStep(3);
          }}
        />
        <OptionCard
          title="Skip for now"
          desc="Synapses works without brain — enable it later from Dashboard."
          onClick={() => setStep(3)}
          secondary
        />
      </div>
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
      </div>
    </div>,

    // Step 3 — Connect agent
    <div key="connect" className="onboarding-step">
      <div className="onboarding-icon"><Plug size={48} /></div>
      <h1 className="onboarding-title">Connect your AI agent</h1>
      <p className="onboarding-desc">
        Add this config to your AI agent's MCP settings. Works with Claude Code,
        Cursor, Windsurf, Zed, and any MCP-compatible agent.
      </p>
      <div className="code-block">
        <pre>{mcpSnippet}</pre>
        <button className="copy-btn" onClick={copyMcp}>
          {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="onboarding-hint">
        <strong>Claude Code:</strong> Add to <code>~/.claude/settings.json</code><br />
        <strong>Cursor:</strong> Add to <code>~/.cursor/mcp.json</code>
      </p>
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(4)}>
          Next <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 4 — Privacy defaults
    <div key="privacy" className="onboarding-step">
      <div className="onboarding-icon" style={{ color: "var(--success)", filter: "drop-shadow(0 0 24px rgba(16,185,129,0.3))" }}>
        <Shield size={48} />
      </div>
      <h1 className="onboarding-title">Your data stays local</h1>
      <p className="onboarding-desc">
        Synapses stores everything on your machine. No cloud sync. No external telemetry.
        No account required. Here's exactly what gets stored:
      </p>
      <div className="privacy-checklist">
        <PrivacyItem
          checked={true}
          locked
          label="Code graph"
          desc="Your indexed codebase — required for the tool to function"
        />
        <PrivacyItem
          checked={privacySettings.log_tool_calls}
          locked={false}
          label="Session logs"
          desc="Tool call counts and latency for local analytics (no code content)"
        />
        <PrivacyItem
          checked={privacySettings.cache_web_searches}
          locked={false}
          label="Web cache"
          desc="Searches and pages fetched by agents via Scout"
        />
      </div>
      <p className="onboarding-hint" style={{ textAlign: "center", width: "100%" }}>
        You can change these anytime in <strong>Privacy & Data</strong>.
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
          <div
            key={i}
            className={`progress-dot ${i === step ? "active" : i < step ? "done" : ""}`}
          />
        ))}
      </div>
      {steps[step]}
    </div>
  );
}

function OptionCard({ title, desc, onClick, secondary }: { title: string; desc: string; onClick: () => void; secondary?: boolean }) {
  return (
    <button className={`option-card ${secondary ? "option-card-secondary" : ""}`} onClick={onClick}>
      <div className="option-title">{title}</div>
      <div className="option-desc">{desc}</div>
    </button>
  );
}

function PrivacyItem({ checked, locked, label, desc }: { checked: boolean; locked: boolean; label: string; desc: string }) {
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
