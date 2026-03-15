import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, CheckCircle, FolderOpen, RefreshCw, Plug, AlertCircle } from "lucide-react";
import { useToast } from "../context/ToastContext";
import { useServices } from "../hooks/useServices";

interface Project {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  scale?: string;
  last_indexed?: string;
  status?: string;
}

const AGENTS = [
  { id: "claude",      label: "Claude Code",  configFile: ".mcp.json" },
  { id: "cursor",      label: "Cursor",        configFile: ".cursor/mcp.json" },
  { id: "windsurf",    label: "Windsurf",      configFile: ".windsurf/mcp_config.json" },
  { id: "zed",         label: "Zed",           configFile: ".zed/settings.json" },
  { id: "vscode",      label: "VS Code",       configFile: ".vscode/mcp.json" },
  { id: "antigravity", label: "Antigravity",   configFile: ".agent/mcp.json" },
];

const MANUAL_SNIPPET = JSON.stringify(
  { mcpServers: { synapses: { type: "http", url: "http://127.0.0.1:11435/mcp" } } },
  null, 2
);

export function Settings() {
  const { addToast } = useToast();
  const { services } = useServices();
  const [dataDir, setDataDir] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logLoading, setLogLoading] = useState(false);

  // Agent connection state
  const [projects, setProjects] = useState<Project[]>([]);
  const [detectedAgents, setDetectedAgents] = useState<Set<string>>(new Set());
  // connections[projectPath][agentId] = true if MCP config present
  const [connections, setConnections] = useState<Record<string, Record<string, boolean>>>({});
  const [connecting, setConnecting] = useState<string | null>(null); // "projectPath::agentId"

  const daemonSvc = services.find((s) => s.name === "synapses");
  const daemonRunning =
    services.length === 0
      ? null
      : daemonSvc?.status === "healthy" || daemonSvc?.status === "degraded" || daemonSvc?.status === "starting"
      ? true
      : false;

  useEffect(() => {
    invoke<string>("get_synapses_data_dir").then(setDataDir).catch(() => {});

    // Load indexed projects
    invoke<string>("run_synapses_cmd", { args: ["list", "--json"] })
      .then((raw) => setProjects(JSON.parse(raw) as Project[]))
      .catch(() => setProjects([]));

    // Detect installed agents
    invoke<string[]>("detect_installed_agents")
      .then((ids) => setDetectedAgents(new Set(ids)))
      .catch(() => setDetectedAgents(new Set()));
  }, []);

  // Once projects load, check existing connections
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
      addToast("success", `${label} connected — restart your agent to apply`);
    } catch (e) {
      addToast("error", `Failed: ${e}`);
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

  async function loadLogs() {
    setLogLoading(true);
    try {
      const lines = await invoke<string[]>("get_log_lines", { n: 100 });
      if (lines.length === 0) {
        addToast("info", "No logs found yet — daemon may have just started");
        setLogLines(["[No logs available]"]);
      } else {
        setLogLines(lines);
      }
    } catch (e) {
      addToast("error", `Failed to load logs: ${e}`);
      setLogLines([]);
    } finally {
      setLogLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      {/* Agent integration — project-scoped */}
      <section className="settings-section">
        <h2 className="section-title">Connect AI Agents</h2>
        <p className="section-desc">
          Writes an MCP config into each project's directory — only indexed projects receive Synapses context.
          Non-indexed projects are never touched.
        </p>

        {daemonRunning === false && (
          <div className="offline-banner" style={{ marginBottom: 12 }}>
            <AlertCircle size={14} />
            <span>Daemon is offline — start it from the Dashboard before connecting your agent.</span>
          </div>
        )}

        {projects.length === 0 ? (
          <p className="settings-hint">No indexed projects yet — add one in the Projects tab first.</p>
        ) : (
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
                    const isInstalled = detectedAgents.has(agent.id);
                    const key = `${project.path}::${agent.id}`;
                    const isConnecting = connecting === key;

                    return (
                      <button
                        key={agent.id}
                        className={[
                          "agent-chip",
                          isConnected ? "agent-chip-connected" : "",
                          !isInstalled ? "agent-chip-dim" : "",
                        ].join(" ").trim()}
                        onClick={() => connectAgent(agent.id, project.path)}
                        disabled={isConnecting}
                        title={
                          !isInstalled
                            ? `${agent.label} not detected — will write config anyway`
                            : isConnected
                            ? `Connected · click to re-apply`
                            : `Write ${agent.configFile}`
                        }
                      >
                        {isConnecting ? (
                          <RefreshCw size={11} className="spin" />
                        ) : isConnected ? (
                          <CheckCircle size={11} />
                        ) : (
                          <Plug size={11} />
                        )}
                        {agent.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Manual / generic copy-paste */}
        <div style={{ marginTop: 20 }}>
          <p className="settings-hint" style={{ marginBottom: 8 }}>
            Other editors — copy the snippet and add it to your agent's MCP config manually:
          </p>
          <div className="code-block">
            <pre>{MANUAL_SNIPPET}</pre>
            <button className="copy-btn" onClick={() => copyText(MANUAL_SNIPPET, "mcp")}>
              {copied === "mcp" ? <CheckCircle size={14} /> : <Copy size={14} />}
              {copied === "mcp" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
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

      {/* System Status */}
      <section className="settings-section">
        <h2 className="section-title">System Status</h2>
        <div className="diagnostic-cards">
          <div className="diagnostic-card">
            <div className="diagnostic-icon">🖥️</div>
            <div className="diagnostic-content">
              <div className="diagnostic-title">Daemon</div>
              <div className="diagnostic-status">
                {daemonRunning === null ? "Checking…" : daemonRunning ? "🟢 Running" : "🔴 Offline"}
              </div>
              <div className="diagnostic-detail">127.0.0.1:11435</div>
            </div>
          </div>
          <div className="diagnostic-card">
            <div className="diagnostic-icon">📊</div>
            <div className="diagnostic-content">
              <div className="diagnostic-title">Indexed Projects</div>
              <div className="diagnostic-status">{projects.length} project{projects.length !== 1 ? "s" : ""}</div>
              <div className="diagnostic-detail">Stored in synapses.db</div>
            </div>
          </div>
          <div className="diagnostic-card">
            <div className="diagnostic-icon">🔌</div>
            <div className="diagnostic-content">
              <div className="diagnostic-title">MCP Protocol</div>
              <div className="diagnostic-status">HTTP</div>
              <div className="diagnostic-detail">/mcp?project=&lt;path&gt;</div>
            </div>
          </div>
        </div>
      </section>

      {/* Log viewer */}
      <section className="settings-section">
        <h2 className="section-title">Daemon Logs</h2>
        <p className="section-desc">View recent output from the Synapses daemon process.</p>
        <button className="btn-secondary btn-sm" onClick={loadLogs} disabled={logLoading}>
          {logLoading ? <><RefreshCw size={12} className="spin" /> Loading…</> : "View last 100 lines"}
        </button>
        {logLines.length > 0 && (
          <div className="output-box" style={{ marginTop: 10 }}>
            <pre style={{ maxHeight: 320 }}>{logLines.join("\n")}</pre>
            <button className="output-close" onClick={() => setLogLines([])}>×</button>
          </div>
        )}
        {logLines.length === 0 && !logLoading && (
          <p className="settings-hint" style={{ marginTop: 8 }}>
            Location: <code>{dataDir || "~/.synapses"}/logs/daemon.log</code>
          </p>
        )}
      </section>

      {/* About */}
      <section className="settings-section">
        <h2 className="section-title">About Synapses</h2>
        <div className="about-intro">
          <div className="about-version">Version 0.2.0</div>
          <p>Local-first code intelligence for AI agents. Works with your favorite editors via MCP.</p>
        </div>

        <div className="about-features">
          <div className="feature-block">
            <div className="feature-icon">🧠</div>
            <h3>Code Graph Engine</h3>
            <p>Indexes all indexed projects into a queryable graph. No remote processing.</p>
          </div>
          <div className="feature-block">
            <div className="feature-icon">🔌</div>
            <h3>MCP Protocol</h3>
            <p>Model Context Protocol over HTTP at 127.0.0.1:11435/mcp?project=&lt;path&gt;</p>
          </div>
          <div className="feature-block">
            <div className="feature-icon">🛡️</div>
            <h3>Privacy First</h3>
            <p>No cloud upload, no telemetry. All data stays on your machine.</p>
          </div>
          <div className="feature-block">
            <div className="feature-icon">📦</div>
            <h3>Stack</h3>
            <p>Daemon (Go) · App (Tauri + React) · Storage (SQLite local)</p>
          </div>
        </div>

        <div className="about-agents">
          <h3 style={{ marginBottom: 12 }}>Supported Editors</h3>
          <div className="agent-tags">
            <span className="agent-tag">Claude Code</span>
            <span className="agent-tag">Cursor</span>
            <span className="agent-tag">Windsurf</span>
            <span className="agent-tag">Zed</span>
            <span className="agent-tag">VS Code</span>
            <span className="agent-tag">Antigravity</span>
          </div>
        </div>

        <div className="about-footer">
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
            © 2026 Synapses OS · <a href="#" onClick={(e) => { e.preventDefault(); }}>github.com/itachi-os/synapses</a>
          </p>
        </div>
      </section>
    </div>
  );
}
