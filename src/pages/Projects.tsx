import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, RefreshCw, Trash2, FolderOpen, Activity, ChevronDown, ChevronRight, Search, Loader } from "lucide-react";
import { useToast } from "../context/ToastContext";

interface EntityRow {
  id: string;
  name: string;
  type: string;
  file: string;
  domain: string;
}

interface IndexingProgress {
  state: "idle" | "indexing" | "ready";
  files_done: number;
  files_total: number;
  pct: number;
  label?: string;
}

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
  const [indexProgress, setIndexProgress] = useState<IndexingProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexStartRef = useRef<number | null>(null);
  const [elapsedSecs, setElapsedSecs] = useState(0);

  useEffect(() => {
    if (!indexingPath) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      if (indexStartRef.current != null)
        setElapsedSecs(Math.floor((Date.now() - indexStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [indexingPath]);

  // Search tab state
  const [activeTab, setActiveTab] = useState<"projects" | "search">("projects");
  const [searchProject, setSearchProject] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EntityRow[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadProjects(); }, []);

  // Auto-select first project for search when projects load
  useEffect(() => {
    if (projects.length > 0 && !searchProject) {
      setSearchProject(projects[0].path);
    }
  }, [projects, searchProject]);

  // Debounced entity search
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!searchQuery.trim() || !searchProject) {
      setSearchResults([]);
      setSearched(false);
      setSearchError(null);
      return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true);
      setSearchError(null);
      setSearched(true);
      try {
        const res = await fetch(
          `http://127.0.0.1:11435/api/search_entities?project=${encodeURIComponent(searchProject)}&q=${encodeURIComponent(searchQuery.trim())}`,
          { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setSearchResults(data.entities || []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setSearchError(msg.includes("Failed to fetch") ? "Daemon offline" : `Search failed: ${msg}`);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery, searchProject]);

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
    setIndexProgress(null);
    indexStartRef.current = Date.now();
    setElapsedSecs(0);
    setIndexOutput((o) => ({ ...o, [path]: "" }));

    pollRef.current = setInterval(async () => {
      try {
        const p = await invoke<IndexingProgress>("get_indexing_progress");
        if (p.state === "indexing" || p.state === "ready") setIndexProgress(p);
      } catch { /* ignore */ }
    }, 500);

    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", path] });
      setIndexOutput((o) => ({ ...o, [path]: out || "Indexed successfully." }));
      addToast("success", `${path.split("/").pop()} indexed successfully`);
      // Pre-register with the daemon so the first MCP connection is instant.
      invoke("preregister_project", { path }).catch(() => {});
      await loadProjects();
    } catch (e) {
      setIndexOutput((o) => ({ ...o, [path]: String(e) }));
      addToast("error", `Indexing failed: ${e}`);
    } finally {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      setIndexingPath(null);
      setIndexProgress(null);
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
    addToast("success", `SDLC phase set to ${phase}`);
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        {activeTab === "projects" && (
          <button className="btn-primary" onClick={addProject} disabled={!!indexingPath}>
            <Plus size={14} /> Add Project
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="page-tabs">
        <button
          className={`page-tab ${activeTab === "projects" ? "page-tab-active" : ""}`}
          onClick={() => setActiveTab("projects")}
        >
          Projects
        </button>
        <button
          className={`page-tab ${activeTab === "search" ? "page-tab-active" : ""}`}
          onClick={() => setActiveTab("search")}
        >
          Search Entities
        </button>
      </div>

      {/* ── Search tab ────────────────────────────────────────────── */}
      {activeTab === "search" && (
        <div>
          {projects.length === 0 ? (
            <div className="empty-state-large">
              <FolderOpen size={48} className="empty-icon" />
              <p>No projects indexed yet.</p>
              <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
                Add a project first, then search its entities here.
              </p>
            </div>
          ) : (
            <>
              <div className="explorer-controls">
                <div className="field-group">
                  <label className="field-label">Project</label>
                  <select
                    className="text-input explorer-project-select"
                    value={searchProject}
                    onChange={(e) => { setSearchProject(e.target.value); setSearchQuery(""); setSearchResults([]); setSearched(false); }}
                  >
                    {projects.map((p) => (
                      <option key={p.path} value={p.path}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field-group">
                  <label className="field-label">Search</label>
                  <div className="explorer-search-box">
                    <Search size={15} className="explorer-search-icon" />
                    <input
                      type="text"
                      className="text-input explorer-search-input"
                      placeholder="Function, struct, file, endpoint…"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      disabled={searchLoading}
                    />
                    {searchLoading && <Loader size={15} className="explorer-spinner" />}
                  </div>
                </div>
              </div>

              {searchError && (
                <div className="offline-banner" style={{ marginBottom: 12 }}>
                  <span>{searchError}</span>
                </div>
              )}

              <div className="explorer-results">
                {!searched ? (
                  <div className="empty-state"><p>Type to search code entities in the selected project</p></div>
                ) : searchResults.length === 0 ? (
                  <div className="empty-state"><p>No entities found. Try different keywords.</p></div>
                ) : (
                  <div className="an-table">
                    <div className="an-table-head">
                      <div className="an-table-row">
                        <div className="an-table-cell" style={{ flex: "0 0 35%" }}>Entity</div>
                        <div className="an-table-cell" style={{ flex: "0 0 15%" }}>Type</div>
                        <div className="an-table-cell" style={{ flex: "0 0 40%" }}>File</div>
                        <div className="an-table-cell" style={{ flex: "0 0 10%" }}>Domain</div>
                      </div>
                    </div>
                    <div className="an-table-body">
                      {searchResults.map((e) => (
                        <div key={e.id} className="an-table-row">
                          <div className="an-table-cell" style={{ flex: "0 0 35%" }} title={e.name}>{e.name}</div>
                          <div className="an-table-cell" style={{ flex: "0 0 15%" }}>
                            <span className="entity-type-badge">{e.type}</span>
                          </div>
                          <div className="an-table-cell an-table-cell-mono" style={{ flex: "0 0 40%" }} title={e.file}>
                            {e.file || "—"}
                          </div>
                          <div className="an-table-cell" style={{ flex: "0 0 10%" }}>
                            {e.domain !== "code" && (
                              <span className={`domain-badge domain-badge--${e.domain}`}>{e.domain}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Projects tab ──────────────────────────────────────────── */}
      {activeTab === "projects" && <>

      {/* Card for a brand-new project being indexed (not yet in the list) */}
      {indexingPath && !projects.some((p) => p.path === indexingPath) && (
        <div className="project-card" style={{ marginBottom: 12 }}>
          <div className="project-card-header">
            <div className="project-info" style={{ flex: 1 }}>
              <div className="project-name-row">
                <span className="project-name">{indexingPath.split("/").pop()}</span>
                <span className="project-indexing-badge">
                  <RefreshCw size={11} className="spin" /> indexing…
                </span>
              </div>
              <div className="project-path">{indexingPath}</div>
              <IndexProgressBar progress={indexProgress} elapsed={elapsedSecs} />
            </div>
          </div>
        </div>
      )}

      {projects.length === 0 && !indexingPath ? (
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
                    {isIndexing
                      ? <IndexProgressBar progress={indexProgress} elapsed={elapsedSecs} />
                      : (
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
                      )
                    }
                  </div>
                  <div className="project-actions">
                    <button
                      className="icon-btn"
                      title="Re-index"
                      onClick={() => doIndex(p.path)}
                      disabled={!!indexingPath}
                    >
                      <RefreshCw size={14} className={isIndexing ? "spin" : ""} />
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Remove"
                      onClick={() => removeProject(p.path)}
                      disabled={isIndexing}
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

      </>}
    </div>
  );
}

function IndexProgressBar({ progress, elapsed }: { progress: IndexingProgress | null; elapsed: number }) {
  const pct = progress?.pct ?? 0;
  const isResolving = !!progress?.label;
  const label = isResolving
    ? `${progress!.label} · ${elapsed}s`
    : progress && progress.files_total > 0
    ? `${progress.files_done.toLocaleString()} / ${progress.files_total.toLocaleString()} files · ${pct}%`
    : "Building file list…";
  return (
    <div className="index-progress-wrap">
      <div className="index-progress-bar-track">
        <div className={`index-progress-bar-fill${isResolving ? " is-resolving" : ""}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="index-progress-label">{label}</div>
    </div>
  );
}
