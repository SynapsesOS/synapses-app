import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Copy, CheckCircle, FolderOpen, RefreshCw, Plug, AlertCircle,
  ChevronDown, ChevronRight, Code2, Shield, Database,
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useServices } from "../hooks/useServices";

interface Project {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  scale?: string;
  last_indexed?: string;
}

const AGENTS = [
  { id: "claude",      label: "Claude Code",  configFile: ".mcp.json",                   emoji: "🤖" },
  { id: "cursor",      label: "Cursor",        configFile: ".cursor/mcp.json",            emoji: "⚡" },
  { id: "windsurf",    label: "Windsurf",      configFile: ".windsurf/mcp_config.json",   emoji: "🌊" },
  { id: "zed",         label: "Zed",           configFile: ".zed/settings.json",          emoji: "⚡" },
  { id: "vscode",      label: "VS Code",       configFile: ".vscode/mcp.json",            emoji: "💙" },
  { id: "antigravity", label: "Antigravity",   configFile: ".agent/mcp.json",             emoji: "🔮" },
];

const MANUAL_SNIPPET = JSON.stringify(
  { mcpServers: { synapses: { type: "http", url: "http://127.0.0.1:11435/mcp" } } },
  null, 2
);

export function Settings() {
  const { addToast } = useToast();
  const { services } = useServices();
  const [dataDir, setDataDir]         = useState("");
  const [copied, setCopied]           = useState<string | null>(null);
  const [logLines, setLogLines]       = useState<string[]>([]);
  const [logLoading, setLogLoading]   = useState(false);
  const [advanced, setAdvanced]       = useState(false);

  const [projects, setProjects]       = useState<Project[]>([]);
  const [detectedAgents, setDetectedAgents] = useState<Set<string>>(new Set());
  const [connections, setConnections] = useState<Record<string, Record<string, boolean>>>({});
  const [connecting, setConnecting]   = useState<string | null>(null);

  const daemonSvc     = services.find((s) => s.name === "synapses");
  const daemonRunning = services.length === 0
    ? null
    : daemonSvc?.status === "healthy" || daemonSvc?.status === "degraded" || daemonSvc?.status === "starting"
    ? true : false;

  useEffect(() => {
    invoke<string>("get_synapses_data_dir").then(setDataDir).catch(() => {});

    invoke<string>("run_synapses_cmd", { args: ["list", "--json"] })
      .then((raw) => setProjects(JSON.parse(raw) as Project[]))
      .catch(() => setProjects([]));

    invoke<string[]>("detect_installed_agents")
      .then((ids) => setDetectedAgents(new Set(ids)))
      .catch(() => setDetectedAgents(new Set()));
  }, []);

  useEffect(() => {
    if (projects.length === 0) return;
    const checks = projects.flatMap((p) =>
      AGENTS.map((a) =>
        invoke<boolean>("check_mcp_config", { editor: a.id, projectPath: p.path })
          .then((connected) => ({ path: p.path, agent: a.id, connected }))
          .catch(() => ({ path: p.path, agent: a.id, connected: false }))
      )
    );
    Promise.all(checks).then((results) => {
      const state: Record<string, Record<string, boolean>> = {};
      for (const { path, agent, connected } of results) {
        if (!state[path]) state[path] = {};
        state[path][agent] = connected;
      }
      setConnections(state);
    });
  }, [projects]);

  async function connectAgent(agentId: string, projectPath: string) {
    const key = `${projectPath}::${agentId}`;
    setConnecting(key);
    try {
      await invoke<string>("write_mcp_config", { editor: agentId, projectPath });
      setConnections((prev) => ({
        ...prev,
        [projectPath]: { ...prev[projectPath], [agentId]: true },
      }));
      const label = AGENTS.find((a) => a.id === agentId)?.label ?? agentId;
      addToast("success", `${label} connected — restart your editor to apply`);
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally { setConnecting(null); }
  }

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    addToast("success", "Copied to clipboard");
    setTimeout(() => setCopied(null), 2000);
  }

  async function loadLogs() {
    setLogLoading(true);
    try {
      const lines = await invoke<string[]>("get_log_lines", { n: 100 });
      setLogLines(lines.length === 0 ? ["[No logs available]"] : lines);
    } catch (e) {
      addToast("error", `Failed to load logs: ${e}`);
    } finally { setLogLoading(false); }
  }

  // Aggregate: which agents are connected to ANY project?
  const anyConnected = (agentId: string) =>
    projects.some((p) => connections[p.path]?.[agentId] === true);

  // Is agent detected on this machine?
  const isInstalled = (agentId: string) => detectedAgents.has(agentId);

  // For connect: use first project or let user pick — defaults to first indexed project
  const defaultProject = projects[0]?.path ?? "";

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* ── Connect your editor ──────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="section-title">Connect your editor</h2>
        <p className="section-desc">
          One click to add Synapses to your AI coding assistant. Restart your editor after connecting.
        </p>

        {daemonRunning === false && (
          <div className="offline-banner" style={{ marginBottom: 16 }}>
            <AlertCircle size={14} />
            <span>Synapses engine is offline — check the Home page for status.</span>
          </div>
        )}

        {projects.length === 0 ? (
          <div className="settings-hint">
            Add a project first — go to the Projects tab and index a codebase.
          </div>
        ) : (
          <>
            <div className="editor-card-grid">
              {AGENTS.map((agent) => {
                const connected = anyConnected(agent.id);
                const installed = isInstalled(agent.id);
                const isConnecting = projects.some((p) => connecting === `${p.path}::${agent.id}`);

                return (
                  <button
                    key={agent.id}
                    className={`editor-card ${connected ? "editor-card-connected" : ""} ${!installed ? "editor-card-dim" : ""}`}
                    onClick={() => !isConnecting && connectAgent(agent.id, defaultProject)}
                    disabled={isConnecting}
                    title={
                      !installed
                        ? `${agent.label} not detected on this machine`
                        : connected
                        ? `Connected — click to re-apply config`
                        : `Write MCP config for ${agent.label}`
                    }
                  >
                    <div className="editor-card-top">
                      <span className="editor-card-emoji">{agent.emoji}</span>
                      <span className="editor-card-label">{agent.label}</span>
                      {isConnecting ? (
                        <RefreshCw size={13} className="spin editor-card-status" style={{ color: "var(--text-dim)" }} />
                      ) : connected ? (
                        <CheckCircle size={13} className="editor-card-status" style={{ color: "var(--success)" }} />
                      ) : installed ? (
                        <Plug size={13} className="editor-card-status" style={{ color: "var(--text-dim)" }} />
                      ) : null}
                    </div>
                    <div className="editor-card-bottom">
                      {connected
                        ? <span style={{ color: "var(--success)" }}>Connected</span>
                        : installed
                        ? <span>Connect →</span>
                        : <span style={{ color: "var(--text-dim)" }}>Not detected</span>
                      }
                    </div>
                  </button>
                );
              })}
            </div>

            {projects.length > 1 && (
              <p className="settings-hint" style={{ marginTop: 10 }}>
                Connected to: {projects[0].name}.
                {" "}To connect other projects, use the per-project controls in Advanced below.
              </p>
            )}

            <div style={{ marginTop: 16 }}>
              <p className="settings-hint" style={{ marginBottom: 8 }}>
                Using a different editor? Copy this snippet into your MCP config:
              </p>
              <div className="code-block">
                <pre>{MANUAL_SNIPPET}</pre>
                <button className="copy-btn" onClick={() => copyText(MANUAL_SNIPPET, "mcp")}>
                  {copied === "mcp" ? <CheckCircle size={13} /> : <Copy size={13} />}
                  {copied === "mcp" ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ── Privacy & Data ───────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="section-title">Privacy & Data</h2>
        <div className="privacy-row">
          <div className="privacy-row-info">
            <Shield size={14} style={{ color: "var(--success)", flexShrink: 0 }} />
            <div>
              <div className="privacy-row-label">All data stays on your machine</div>
              <div className="privacy-row-desc">No cloud sync, no telemetry, no account required</div>
            </div>
          </div>
        </div>
        <div className="privacy-actions">
          <button
            className="btn-secondary btn-sm"
            onClick={() => invoke("open_data_dir").catch(() => addToast("error", "Could not open directory"))}
          >
            <FolderOpen size={13} /> Open data folder
          </button>
          {dataDir && (
            <button className="btn-secondary btn-sm" onClick={() => copyText(dataDir, "dir")}>
              {copied === "dir" ? <CheckCircle size={13} /> : <Copy size={13} />}
              Copy path
            </button>
          )}
        </div>
      </section>

      {/* ── Advanced ─────────────────────────────────────────────────────── */}
      <div className="advanced-section">
        <button className="advanced-toggle" onClick={() => setAdvanced((v) => !v)}>
          {advanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          Advanced
          <span className="advanced-toggle-hint">per-project connections, logs, diagnostics</span>
        </button>

        {advanced && (
          <div className="advanced-content">

            {/* Per-project connection matrix */}
            {projects.length > 1 && (
              <div className="adv-subsection">
                <div className="section-title" style={{ marginBottom: 10 }}>Per-project connections</div>
                <div className="project-agent-list">
                  {projects.map((project) => (
                    <div key={project.path} className="project-agent-row">
                      <div className="project-agent-header">
                        <div className="project-agent-name">{project.name}</div>
                        <div className="project-agent-path">{project.path}</div>
                      </div>
                      <div className="agent-chips">
                        {AGENTS.map((agent) => {
                          const isConnected = connections[project.path]?.[agent.id] ?? false;
                          const installed   = detectedAgents.has(agent.id);
                          const key         = `${project.path}::${agent.id}`;
                          const isConnecting = connecting === key;
                          return (
                            <button
                              key={agent.id}
                              className={["agent-chip", isConnected ? "agent-chip-connected" : "", !installed ? "agent-chip-dim" : ""].join(" ").trim()}
                              onClick={() => connectAgent(agent.id, project.path)}
                              disabled={isConnecting}
                            >
                              {isConnecting ? <RefreshCw size={10} className="spin" /> : isConnected ? <CheckCircle size={10} /> : <Plug size={10} />}
                              {agent.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Diagnostics */}
            <div className="adv-subsection">
              <div className="section-title" style={{ marginBottom: 10 }}>Diagnostics</div>
              <div className="diagnostic-cards">
                <div className="diagnostic-card">
                  <Code2 size={15} style={{ color: "var(--text-muted)" }} />
                  <div className="diagnostic-content">
                    <div className="diagnostic-title">Engine</div>
                    <div className="diagnostic-status" style={{ color: daemonRunning ? "var(--success)" : "var(--danger)" }}>
                      {daemonRunning === null ? "Checking…" : daemonRunning ? "Running" : "Offline"}
                    </div>
                    <div className="diagnostic-detail">127.0.0.1:11435</div>
                  </div>
                </div>
                <div className="diagnostic-card">
                  <Database size={15} style={{ color: "var(--text-muted)" }} />
                  <div className="diagnostic-content">
                    <div className="diagnostic-title">Projects</div>
                    <div className="diagnostic-status">{projects.length} indexed</div>
                    <div className="diagnostic-detail">Stored locally in SQLite</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Logs */}
            <div className="adv-subsection">
              <div className="section-title" style={{ marginBottom: 8 }}>Engine logs</div>
              <button className="btn-secondary btn-sm" onClick={loadLogs} disabled={logLoading}>
                {logLoading ? <><RefreshCw size={12} className="spin" /> Loading…</> : "View last 100 lines"}
              </button>
              {logLines.length > 0 && (
                <div className="output-box" style={{ marginTop: 10 }}>
                  <pre style={{ maxHeight: 280 }}>{logLines.join("\n")}</pre>
                  <button className="output-close" onClick={() => setLogLines([])}>×</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── About ────────────────────────────────────────────────────────── */}
      <section className="settings-section" style={{ marginTop: 32 }}>
        <h2 className="section-title">About</h2>
        <div className="about-row">
          <span className="about-name">Synapses</span>
          <span className="about-version">v0.3.0</span>
        </div>
        <p className="section-desc" style={{ marginTop: 6 }}>
          Local-first knowledge substrate for AI agents. Graph-based code intelligence,
          persistent memory, session continuity — all on your machine, no cloud required.
        </p>
        <div className="agent-tags" style={{ marginTop: 10 }}>
          {["Claude Code", "Cursor", "Windsurf", "Zed", "VS Code", "Antigravity"].map((t) => (
            <span key={t} className="agent-tag">{t}</span>
          ))}
        </div>
      </section>
    </div>
  );
}
