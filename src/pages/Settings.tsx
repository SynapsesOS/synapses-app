import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, CheckCircle } from "lucide-react";

export function Settings() {
  const [dataDir, setDataDir] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [doctorOut, setDoctorOut] = useState("");

  useEffect(() => {
    invoke<string>("get_synapses_data_dir").then(setDataDir).catch(() => {});
  }, []);

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        synapses: {
          command: "synapses",
          args: ["start"],
        },
      },
    },
    null,
    2
  );

  async function copyText(text: string, key: string) {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  async function runDoctor() {
    setDoctorOut("Running diagnostics…");
    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["doctor"] });
      setDoctorOut(out);
    } catch (e) {
      setDoctorOut(String(e));
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <section className="settings-section">
        <h2 className="section-title">Connect Your AI Agent</h2>
        <p className="section-desc">
          Add this to your MCP configuration file to connect Claude Code, Cursor, or any MCP-compatible agent.
        </p>
        <div className="code-block">
          <pre>{mcpConfig}</pre>
          <button
            className="copy-btn"
            onClick={() => copyText(mcpConfig, "mcp")}
          >
            {copied === "mcp" ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied === "mcp" ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="settings-hint">
          Config file locations: <code>~/.claude/settings.json</code> (Claude Code) ·{" "}
          <code>~/.cursor/mcp.json</code> (Cursor)
        </p>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Service Ports</h2>
        <div className="port-table">
          {[
            { name: "Core (MCP)", value: "stdio (per project)" },
            { name: "Brain", value: "11435" },
            { name: "Scout", value: "11436" },
            { name: "Pulse", value: "11437" },
          ].map((row) => (
            <div key={row.name} className="port-row">
              <span className="port-name">{row.name}</span>
              <code className="port-value">{row.value}</code>
            </div>
          ))}
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Data Directory</h2>
        <div className="code-block">
          <pre>{dataDir || "~/.synapses"}</pre>
          <button
            className="copy-btn"
            onClick={() => copyText(dataDir, "dir")}
          >
            {copied === "dir" ? <CheckCircle size={14} /> : <Copy size={14} />}
            {copied === "dir" ? "Copied!" : "Copy"}
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2 className="section-title">Diagnostics</h2>
        <button className="btn-secondary" onClick={runDoctor}>
          Run synapses doctor
        </button>
        {doctorOut && (
          <div className="output-box" style={{ marginTop: 12 }}>
            <pre>{doctorOut}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
