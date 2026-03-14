import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, CheckCircle, FolderOpen, Terminal, RefreshCw, Plug, AlertCircle } from "lucide-react";
import { useToast } from "../context/ToastContext";

const AGENTS = [
  { id: "claude", label: "Claude Code", configPath: "~/.claude/settings.json" },
  { id: "cursor", label: "Cursor", configPath: "~/.cursor/mcp.json" },
  { id: "windsurf", label: "Windsurf", configPath: "~/.codeium/windsurf/mcp_config.json" },
  { id: "zed", label: "Zed", configPath: "~/.config/zed/settings.json" },
  { id: "generic", label: "Generic MCP", configPath: "" },
];

function makeMcpConfig(agentId: string) {
  if (agentId === "zed") {
    return JSON.stringify(
      {
        context_servers: {
          synapses: {
            settings: { url: "http://127.0.0.1:11435/mcp" },
          },
        },
      },
      null,
      2
    );
  }
  return JSON.stringify(
    {
      mcpServers: {
        synapses: {
          transport: "http",
          url: "http://127.0.0.1:11435/mcp",
          ...(agentId === "generic" ? { description: "Synapses code intelligence MCP server" } : {}),
        },
      },
    },
    null,
    2
  );
}

export function Settings() {
  const { addToast } = useToast();
  const [dataDir, setDataDir] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [doctorOut, setDoctorOut] = useState("");
  const [doctorLoading, setDoctorLoading] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [activeAgent, setActiveAgent] = useState("claude");
  const [connected, setConnected] = useState<Record<string, boolean>>({});
  const [connecting, setConnecting] = useState<string | null>(null);
  const [daemonRunning, setDaemonRunning] = useState<boolean | null>(null);

  useEffect(() => {
    invoke<string>("get_synapses_data_dir").then(setDataDir).catch(() => {});
    // Check if daemon is reachable
    fetch("http://127.0.0.1:11435/api/admin/health", { signal: AbortSignal.timeout(2000) })
      .then((r) => setDaemonRunning(r.ok))
      .catch(() => setDaemonRunning(false));
  }, []);

  async function connectAgent(agentId: string) {
    setConnecting(agentId);
    try {
      const path = await invoke<string>("write_mcp_config", { editor: agentId });
      setConnected((p) => ({ ...p, [agentId]: true }));
      addToast("success", `Config written to ${path} — restart your agent to apply`);
    } catch (e) {
      addToast("error", `Failed to write config: ${e}`);
    } finally {
      setConnecting(null);
    }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    addToast("success", "Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  }

  async function runDoctor() {
    setDoctorLoading(true);
    setDoctorOut("Running diagnostics…");
    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["doctor"] });
      setDoctorOut(out);
    } catch (e) {
      setDoctorOut(String(e));
    } finally {
      setDoctorLoading(false);
    }
  }

  async function loadLogs() {
    setLogLoading(true);
    try {
      const lines = await invoke<string[]>("get_log_lines", { n: 100 });
      setLogLines(lines);
    } catch {
      setLogLines(["Log file not found — check ~/.synapses/logs/"]);
    } finally {
      setLogLoading(false);
    }
  }

  const mcpConfig = makeMcpConfig(activeAgent);
  const activeAgentInfo = AGENTS.find((a) => a.id === activeAgent)!;

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Agent integration */}
      <section className="settings-section">
        <h2 className="section-title">Connect Your AI Agent</h2>
        <p className="section-desc">
          Writes the Synapses MCP server into your agent's global config file.
          After connecting, open any indexed project in your agent — Synapses serves context automatically.
        </p>

        {daemonRunning === false && (
          <div className="offline-banner" style={{ marginBottom: 12 }}>
            <AlertCircle size={14} />
            <span>Daemon is offline — start it from the Dashboard before connecting your agent.</span>
          </div>
        )}

        {/* Agent tabs */}
        <div className="agent-tabs">
          {AGENTS.map((a) => (
            <button
              key={a.id}
              className={`agent-tab ${activeAgent === a.id ? "agent-tab-active" : ""}`}
              onClick={() => setActiveAgent(a.id)}
            >
              {a.label}
              {connected[a.id] && <CheckCircle size={11} style={{ marginLeft: 4, color: "var(--success)" }} />}
            </button>
          ))}
        </div>

        {activeAgentInfo.configPath ? (
          <button
            className="btn-primary"
            style={{ marginTop: 14, width: "100%" }}
            disabled={connecting === activeAgent}
            onClick={() => connectAgent(activeAgent)}
          >
            {connected[activeAgent] ? (
              <><CheckCircle size={14} /> Connected — click to re-apply</>
            ) : connecting === activeAgent ? (
              <><RefreshCw size={14} className="spin" /> Writing config…</>
            ) : (
              <><Plug size={14} /> Connect {activeAgentInfo.label}</>
            )}
          </button>
        ) : null}

        <div className="code-block" style={{ marginTop: 12 }}>
          <pre>{mcpConfig}</pre>
          <button className="copy-btn" onClick={() => copyText(mcpConfig, "mcp")}>
            {copied === "mcp" ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied === "mcp" ? "Copied!" : "Copy"}
          </button>
        </div>

        {activeAgentInfo.configPath ? (
          <p className="settings-hint">
            Writes to: <code>{activeAgentInfo.configPath}</code> — merges with existing config, never overwrites other entries.
          </p>
        ) : (
          <p className="settings-hint">Copy the snippet above and add it to your agent's MCP config manually.</p>
        )}
      </section>

      {/* Data directory */}
      <section className="settings-section">
        <h2 className="section-title">Data Directory</h2>
        <div className="code-block">
          <pre>{dataDir || "~/.synapses"}</pre>
          <button className="copy-btn" onClick={() => copyText(dataDir, "dir")}>
            {copied === "dir" ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied === "dir" ? "Copied!" : "Copy"}
          </button>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button
            className="btn-secondary btn-sm"
            onClick={() => invoke("open_data_dir").catch(() => addToast("error", "Could not open directory"))}
          >
            <FolderOpen size={13} /> Open in Finder
          </button>
        </div>
      </section>

      {/* Diagnostics */}
      <section className="settings-section">
        <h2 className="section-title">Diagnostics</h2>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn-secondary" onClick={runDoctor} disabled={doctorLoading}>
            {doctorLoading ? <><RefreshCw size={13} className="spin" /> Running…</> : <><Terminal size={13} /> Run synapses doctor</>}
          </button>
        </div>
        {doctorOut && (
          <div className="output-box" style={{ marginTop: 12 }}>
            <pre>{doctorOut}</pre>
            <button className="output-close" onClick={() => setDoctorOut("")}>×</button>
          </div>
        )}
      </section>

      {/* Log viewer */}
      <section className="settings-section">
        <h2 className="section-title">Service Log</h2>
        <button className="btn-secondary btn-sm" onClick={loadLogs} disabled={logLoading}>
          {logLoading ? <><RefreshCw size={12} className="spin" /> Loading…</> : "View recent logs (last 100 lines)"}
        </button>
        {logLines.length > 0 && (
          <div className="output-box" style={{ marginTop: 10 }}>
            <pre style={{ maxHeight: 320 }}>{logLines.join("\n")}</pre>
            <button className="output-close" onClick={() => setLogLines([])}>×</button>
          </div>
        )}
        {logLines.length === 0 && !logLoading && (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            Log file: <code>{dataDir || "~/.synapses"}/logs/synapses.log</code>
          </p>
        )}
      </section>

      {/* About */}
      <section className="settings-section">
        <h2 className="section-title">About</h2>
        <div className="about-grid">
          <div className="about-row">
            <span className="about-label">Version</span>
            <span className="about-value">0.2.0</span>
          </div>
          <div className="about-row">
            <span className="about-label">Protocol</span>
            <span className="about-value">MCP over HTTP · 127.0.0.1:11435/mcp</span>
          </div>
          <div className="about-row">
            <span className="about-label">Storage</span>
            <span className="about-value">Local SQLite — no cloud</span>
          </div>
          <div className="about-row">
            <span className="about-label">Privacy</span>
            <span className="about-value">All data stays on your machine</span>
          </div>
        </div>
      </section>
    </div>
  );
}
