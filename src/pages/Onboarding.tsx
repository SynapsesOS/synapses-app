import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Zap, FolderOpen, Brain, Plug, CheckCircle, ArrowRight, Copy } from "lucide-react";

interface Props {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [indexedPath, setIndexedPath] = useState<string | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexOutput, setIndexOutput] = useState("");
  const [copied, setCopied] = useState(false);

  async function handleSelectProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select your project directory",
    });
    if (!selected || typeof selected !== "string") return;

    setIndexing(true);
    setIndexOutput("Indexing your project…");
    try {
      const out = await invoke<string>("run_synapses_cmd", {
        args: ["index", "--path", selected],
      });
      setIndexedPath(selected);
      setIndexOutput(out || "Indexed successfully.");
    } catch (e) {
      setIndexOutput(`Error: ${e}`);
    } finally {
      setIndexing(false);
    }
  }

  async function finish() {
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
      <div className="onboarding-icon">
        <Zap size={48} />
      </div>
      <h1 className="onboarding-title">Welcome to Synapses</h1>
      <p className="onboarding-desc">
        Code intelligence for AI agents. Synapses gives your AI agents a deep understanding
        of your codebase — call graphs, architecture rules, semantic search, and analytics.
      </p>
      <p className="onboarding-desc">
        Takes about 2 minutes to set up. Let's go.
      </p>
      <button className="btn-primary btn-large" onClick={() => setStep(1)}>
        Get started <ArrowRight size={16} />
      </button>
    </div>,

    // Step 1 — Index a project
    <div key="index" className="onboarding-step">
      <div className="onboarding-icon">
        <FolderOpen size={48} />
      </div>
      <h1 className="onboarding-title">Index your first project</h1>
      <p className="onboarding-desc">
        Select a project directory to build a code intelligence graph. Synapses supports
        Go, TypeScript, Python, Rust, Java, and 13 more languages.
      </p>
      {!indexedPath ? (
        <button
          className="btn-primary btn-large"
          onClick={handleSelectProject}
          disabled={indexing}
        >
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
          disabled={!indexedPath && !indexOutput.includes("Error")}
        >
          {indexedPath ? "Continue" : "Skip for now"} <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 2 — Brain (optional)
    <div key="brain" className="onboarding-step">
      <div className="onboarding-icon">
        <Brain size={48} />
      </div>
      <h1 className="onboarding-title">AI Enrichment (optional)</h1>
      <p className="onboarding-desc">
        The <strong>brain</strong> sidecar adds LLM-powered summaries, semantic search,
        and context packets to your code graph. Requires ~800 MB for the default model.
      </p>
      <div className="option-cards">
        <OptionCard
          title="Enable brain"
          desc="Download llama-server + model (~800 MB). Best experience."
          onClick={async () => {
            try {
              await invoke("run_synapses_cmd", { args: ["daemon", "start", "--service", "brain"] });
            } catch {}
            setStep(3);
          }}
        />
        <OptionCard
          title="Skip for now"
          desc="Synapses works without brain — you can enable it later from Dashboard."
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
      <div className="onboarding-icon">
        <Plug size={48} />
      </div>
      <h1 className="onboarding-title">Connect your AI agent</h1>
      <p className="onboarding-desc">
        Add this config to your AI agent's MCP settings. Synapses works with Claude Code,
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
        <strong>Claude Code:</strong> Add to <code>~/.claude/settings.json</code>
        <br />
        <strong>Cursor:</strong> Add to <code>~/.cursor/mcp.json</code>
      </p>
      <div className="step-nav">
        <button className="btn-ghost" onClick={() => setStep(2)}>Back</button>
        <button className="btn-primary" onClick={() => setStep(4)}>
          Done <ArrowRight size={14} />
        </button>
      </div>
    </div>,

    // Step 4 — Done
    <div key="done" className="onboarding-step">
      <div className="onboarding-icon success-glow">
        <CheckCircle size={48} />
      </div>
      <h1 className="onboarding-title">You're all set!</h1>
      <p className="onboarding-desc">
        Synapses is running. Your AI agent now has deep code intelligence.
        Ask it about your codebase — call chains, architecture, semantic search, analytics.
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

function OptionCard({
  title,
  desc,
  onClick,
  secondary,
}: {
  title: string;
  desc: string;
  onClick: () => void;
  secondary?: boolean;
}) {
  return (
    <button
      className={`option-card ${secondary ? "option-card-secondary" : ""}`}
      onClick={onClick}
    >
      <div className="option-title">{title}</div>
      <div className="option-desc">{desc}</div>
    </button>
  );
}
