import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, RefreshCw, Trash2, FolderOpen, Activity, ChevronDown, ChevronRight } from "lucide-react";
import { useToast } from "../context/ToastContext";

const BRAIN_URL = "http://localhost:11435";
const SDLC_PHASES = ["development", "testing", "review", "production"] as const;
type SdlcPhase = (typeof SDLC_PHASES)[number];

interface Project {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  edges?: number;
  scale?: string;
  last_indexed?: string;
  status?: string;
}

function relativeTime(iso?: string): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

const SCALE_COLORS: Record<string, string> = {
  micro: "var(--text-dim)",
  small: "var(--text-muted)",
  medium: "var(--warning)",
  large: "var(--accent)",
};

export function Projects() {
  const { addToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [indexingPath, setIndexingPath] = useState<string | null>(null);
  const [indexOutput, setIndexOutput] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sdlcPhases, setSdlcPhases] = useState<Record<string, SdlcPhase>>({});

  useEffect(() => { loadProjects(); }, []);

  async function loadProjects() {
    try {
      const raw = await invoke<string>("run_synapses_cmd", { args: ["list", "--json"] });
      const list = JSON.parse(raw) as Project[];
      setProjects(list);
    } catch {
      setProjects([]);
    }
  }

  async function addProject() {
    const selected = await open({ directory: true, multiple: false, title: "Select project directory" });
    if (!selected || typeof selected !== "string") return;
    await doIndex(selected);
  }

  async function doIndex(path: string) {
    setIndexingPath(path);
    setIndexOutput((o) => ({ ...o, [path]: "Indexing…" }));
    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", path] });
      setIndexOutput((o) => ({ ...o, [path]: out || "Indexed successfully." }));
      addToast("success", `${path.split("/").pop()} indexed successfully`);
      await loadProjects();
    } catch (e) {
      setIndexOutput((o) => ({ ...o, [path]: String(e) }));
      addToast("error", `Indexing failed: ${e}`);
    } finally {
      setIndexingPath(null);
    }
  }

  async function removeProject(path: string) {
    if (!confirm(`Remove ${path} from Synapses? (Does not delete files)`)) return;
    try {
      await invoke("run_synapses_cmd", { args: ["reset", "--path", path] });
      addToast("info", `${path.split("/").pop()} removed`);
      await loadProjects();
    } catch (e) {
      addToast("error", `Remove failed: ${e}`);
    }
  }

  async function setSdlcForProject(projectPath: string, phase: SdlcPhase) {
    setSdlcPhases((s) => ({ ...s, [projectPath]: phase }));
    try {
      await fetch(`${BRAIN_URL}/v1/sdlc/phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase, project: projectPath }),
        signal: AbortSignal.timeout(5000),
      });
      addToast("success", `SDLC phase set to ${phase}`);
    } catch {
      addToast("warning", "Brain offline — phase applied locally only");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button className="btn-primary" onClick={addProject} disabled={!!indexingPath}>
          <Plus size={14} /> Add Project
        </button>
      </div>

      {projects.length === 0 ? (
        <div className="empty-state-large">
          <FolderOpen size={48} className="empty-icon" />
          <p>No projects indexed yet.</p>
          <button className="btn-primary" onClick={addProject}>
            <Plus size={14} /> Add your first project
          </button>
        </div>
      ) : (
        <div className="project-list">
          {projects.map((p) => {
            const isIndexing = indexingPath === p.path;
            const isExpanded = expanded === p.path;
            const output = indexOutput[p.path];
            const phase = sdlcPhases[p.path] ?? "development";
            const scaleColor = p.scale ? SCALE_COLORS[p.scale] ?? "var(--text-dim)" : "var(--text-dim)";

            return (
              <div key={p.path} className={`project-card ${isExpanded ? "project-card-expanded" : ""}`}>
                {/* Header row */}
                <div className="project-card-header">
                  <button
                    className="project-expand-btn"
                    onClick={() => setExpanded(isExpanded ? null : p.path)}
                  >
                    {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  </button>
                  <div className="project-info">
                    <div className="project-name-row">
                      <span className="project-name">{p.name}</span>
                      {p.scale && (
                        <span className="project-scale-badge" style={{ color: scaleColor, borderColor: scaleColor }}>
                          {p.scale}
                        </span>
                      )}
                      {isIndexing && (
                        <span className="project-indexing-badge">
                          <RefreshCw size={11} className="spin" /> indexing…
                        </span>
                      )}
                    </div>
                    <div className="project-path">{p.path}</div>
                    <div className="project-meta-row">
                      {p.nodes != null && (
                        <span className="project-meta-item">
                          <Activity size={11} /> {p.nodes.toLocaleString()} nodes
                        </span>
                      )}
                      {p.files != null && (
                        <span className="project-meta-item">{p.files.toLocaleString()} files</span>
                      )}
                      {p.edges != null && (
                        <span className="project-meta-item">{p.edges.toLocaleString()} edges</span>
                      )}
                      {p.last_indexed && (
                        <span className="project-meta-item">indexed {relativeTime(p.last_indexed)}</span>
                      )}
                    </div>
                  </div>
                  <div className="project-actions">
                    <button
                      className="icon-btn"
                      title="Re-index"
                      onClick={() => doIndex(p.path)}
                      disabled={isIndexing}
                    >
                      <RefreshCw size={14} className={isIndexing ? "spin" : ""} />
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Remove"
                      onClick={() => removeProject(p.path)}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Expanded section */}
                {isExpanded && (
                  <div className="project-card-detail">
                    {/* SDLC phase */}
                    <div className="project-sdlc">
                      <span className="field-label">SDLC Phase</span>
                      <div className="sdlc-selector sdlc-selector-sm">
                        {SDLC_PHASES.map((ph) => (
                          <button
                            key={ph}
                            className={`sdlc-btn sdlc-btn-sm ${phase === ph ? "sdlc-btn-active" : ""}`}
                            onClick={() => setSdlcForProject(p.path, ph)}
                          >
                            {ph.charAt(0).toUpperCase() + ph.slice(1)}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Index output */}
                    {output && (
                      <div className="project-output">
                        <div className="project-output-label">Last indexing output</div>
                        <pre className="project-output-pre">{output}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
