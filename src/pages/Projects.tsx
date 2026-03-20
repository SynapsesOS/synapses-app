import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Plus, RefreshCw, Trash2, FolderOpen, MoreHorizontal,
  Search, Loader, X,
} from "lucide-react";
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
  micro:  "var(--text-dim)",
  small:  "var(--text-muted)",
  medium: "var(--warning)",
  large:  "var(--accent)",
};

function scaleLabel(scale?: string): string {
  if (!scale) return "";
  return scale.charAt(0).toUpperCase() + scale.slice(1);
}

export function Projects() {
  const { addToast } = useToast();
  const [projects, setProjects]             = useState<Project[]>([]);
  const [indexingPath, setIndexingPath]     = useState<string | null>(null);
  const [, setIndexOutput]                  = useState<Record<string, string>>({});
  const [indexProgress, setIndexProgress]   = useState<IndexingProgress | null>(null);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const indexStartRef = useRef<number | null>(null);
  const [elapsedSecs, setElapsedSecs]       = useState(0);

  // Per-card overflow menu
  const [menuOpen, setMenuOpen]             = useState<string | null>(null);

  // Search drawer state
  const [searchOpen, setSearchOpen]         = useState(false);
  const [searchProject, setSearchProject]   = useState<string>("");
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchResults, setSearchResults]   = useState<EntityRow[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [searchError, setSearchError]       = useState<string | null>(null);
  const [searched, setSearched]             = useState(false);
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { loadProjects(); }, []);

  useEffect(() => {
    if (!indexingPath) { setElapsedSecs(0); return; }
    const id = setInterval(() => {
      if (indexStartRef.current != null)
        setElapsedSecs(Math.floor((Date.now() - indexStartRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [indexingPath]);

  useEffect(() => {
    if (projects.length > 0 && !searchProject)
      setSearchProject(projects[0].path);
  }, [projects, searchProject]);

  // Debounced entity search
  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    if (!searchQuery.trim() || !searchProject) {
      setSearchResults([]); setSearched(false); setSearchError(null); return;
    }
    searchDebounce.current = setTimeout(async () => {
      setSearchLoading(true); setSearchError(null); setSearched(true);
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
        setSearchError(msg.includes("Failed to fetch") ? "Engine offline" : `Search failed: ${msg}`);
        setSearchResults([]);
      } finally { setSearchLoading(false); }
    }, 300);
    return () => { if (searchDebounce.current) clearTimeout(searchDebounce.current); };
  }, [searchQuery, searchProject]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = () => setMenuOpen(null);
    setTimeout(() => document.addEventListener("click", handler), 0);
    return () => document.removeEventListener("click", handler);
  }, [menuOpen]);

  async function loadProjects() {
    try {
      const raw = await invoke<string>("run_synapses_cmd", { args: ["list", "--json"] });
      setProjects(JSON.parse(raw) as Project[]);
    } catch { setProjects([]); }
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
      } catch { /**/ }
    }, 500);

    try {
      const out = await invoke<string>("run_synapses_cmd", { args: ["index", "--path", path] });
      setIndexOutput((o) => ({ ...o, [path]: out || "Indexed successfully." }));
      addToast("success", `${path.split("/").pop()} indexed`);
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
    if (!confirm(`Remove "${path.split("/").pop()}" from Synapses?\n(This does not delete your files.)`)) return;
    try {
      await invoke("run_synapses_cmd", { args: ["reset", "--path", path] });
      addToast("info", `${path.split("/").pop()} removed`);
      await loadProjects();
    } catch (e) {
      addToast("error", `Remove failed: ${e}`);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <span className="page-subtitle">{projects.length} indexed</span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {projects.length > 0 && (
            <button
              className="btn-secondary"
              onClick={() => setSearchOpen((v) => !v)}
            >
              <Search size={14} /> Search code
            </button>
          )}
          <button className="btn-primary" onClick={addProject} disabled={!!indexingPath}>
            <Plus size={14} /> Add Project
          </button>
        </div>
      </div>

      {/* ── Search panel ────────────────────────────────────────────────── */}
      {searchOpen && projects.length > 0 && (
        <div className="search-panel">
          <div className="search-panel-header">
            <span className="search-panel-title">Search code elements</span>
            <button className="icon-btn" onClick={() => { setSearchOpen(false); setSearchQuery(""); }}>
              <X size={14} />
            </button>
          </div>
          <div className="search-panel-controls">
            <select
              className="text-input"
              style={{ width: 180, flexShrink: 0 }}
              value={searchProject}
              onChange={(e) => { setSearchProject(e.target.value); setSearchQuery(""); setSearchResults([]); setSearched(false); }}
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>{p.name}</option>
              ))}
            </select>
            <div className="search-box">
              <Search size={14} className="search-box-icon" />
              <input
                type="text"
                className="text-input search-box-input"
                placeholder="Function, struct, file…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoFocus
              />
              {searchLoading && <Loader size={14} className="spin" style={{ color: "var(--text-dim)", flexShrink: 0 }} />}
            </div>
          </div>

          {searchError && (
            <div className="offline-banner" style={{ marginTop: 8 }}>
              <span>{searchError}</span>
            </div>
          )}

          <div className="search-results">
            {!searched ? (
              <div className="empty-state">Type to search across {projects.find((p) => p.path === searchProject)?.name ?? "project"}</div>
            ) : searchResults.length === 0 ? (
              <div className="empty-state">No results found</div>
            ) : (
              <div className="an-table">
                <div className="an-table-head">
                  <div className="an-table-row">
                    <div className="an-table-cell" style={{ flex: "0 0 35%" }}>Name</div>
                    <div className="an-table-cell" style={{ flex: "0 0 15%" }}>Type</div>
                    <div className="an-table-cell" style={{ flex: "0 0 50%" }}>File</div>
                  </div>
                </div>
                <div className="an-table-body">
                  {searchResults.map((e) => (
                    <div key={e.id} className="an-table-row">
                      <div className="an-table-cell" style={{ flex: "0 0 35%" }} title={e.name}>{e.name}</div>
                      <div className="an-table-cell" style={{ flex: "0 0 15%" }}>
                        <span className="entity-type-badge">{e.type}</span>
                      </div>
                      <div className="an-table-cell an-table-cell-mono" style={{ flex: "0 0 50%" }} title={e.file}>
                        {e.file || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Project card grid ───────────────────────────────────────────── */}
      {projects.length === 0 && !indexingPath ? (
        <div className="empty-state-large">
          <FolderOpen size={48} className="empty-icon" />
          <p>No projects indexed yet</p>
          <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
            Add a project to give your AI agents deep code understanding
          </p>
          <button className="btn-primary" style={{ marginTop: 8 }} onClick={addProject}>
            <Plus size={14} /> Add your first project
          </button>
        </div>
      ) : (
        <div className="project-card-grid">
          {/* Card for new project being indexed (not yet in list) */}
          {indexingPath && !projects.some((p) => p.path === indexingPath) && (
            <div className="project-grid-card project-grid-card-indexing">
              <div className="pgc-header">
                <FolderOpen size={16} style={{ color: "var(--accent)" }} />
                <span className="pgc-name">{indexingPath.split("/").pop()}</span>
                <span className="pgc-badge pgc-badge-indexing">
                  <RefreshCw size={10} className="spin" /> indexing
                </span>
              </div>
              <div className="pgc-path">{indexingPath}</div>
              <IndexProgressBar progress={indexProgress} elapsed={elapsedSecs} />
            </div>
          )}

          {projects.map((p) => {
            const isIndexing = indexingPath === p.path;
            const scaleColor = p.scale ? SCALE_COLORS[p.scale] ?? "var(--text-dim)" : "var(--text-dim)";
            const isMenuOpen = menuOpen === p.path;

            return (
              <div key={p.path} className={`project-grid-card ${isIndexing ? "project-grid-card-indexing" : ""}`}>
                <div className="pgc-header">
                  <FolderOpen size={15} style={{ color: isIndexing ? "var(--text-dim)" : "var(--accent)" }} />
                  <span className="pgc-name" title={p.name}>{p.name}</span>
                  {p.scale && (
                    <span className="pgc-scale" style={{ color: scaleColor }}>
                      {scaleLabel(p.scale)}
                    </span>
                  )}
                  {isIndexing && (
                    <span className="pgc-badge pgc-badge-indexing">
                      <RefreshCw size={10} className="spin" /> indexing
                    </span>
                  )}
                </div>

                <div className="pgc-meta">
                  {p.files != null && (
                    <span>{p.files.toLocaleString()} files</span>
                  )}
                  {p.nodes != null && (
                    <span>{p.nodes.toLocaleString()} nodes</span>
                  )}
                </div>

                {isIndexing ? (
                  <IndexProgressBar progress={indexProgress} elapsed={elapsedSecs} />
                ) : (
                  <div className="pgc-footer">
                    <span className="pgc-time">
                      {p.last_indexed ? `Updated ${relativeTime(p.last_indexed)}` : "Never indexed"}
                    </span>
                    <div className="pgc-actions">
                      <button
                        className="btn-secondary pgc-action-btn"
                        title="Refresh index"
                        onClick={() => doIndex(p.path)}
                        disabled={!!indexingPath}
                      >
                        <RefreshCw size={12} />
                        Refresh
                      </button>
                      <div className="pgc-menu-wrap" style={{ position: "relative" }}>
                        <button
                          className="icon-btn"
                          onClick={(e) => { e.stopPropagation(); setMenuOpen(isMenuOpen ? null : p.path); }}
                          title="More options"
                        >
                          <MoreHorizontal size={14} />
                        </button>
                        {isMenuOpen && (
                          <div className="pgc-menu">
                            <button
                              className="pgc-menu-item pgc-menu-item-danger"
                              onClick={() => { setMenuOpen(null); removeProject(p.path); }}
                            >
                              <Trash2 size={13} />
                              Remove project
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Project card */}
          <button className="project-grid-card project-grid-add" onClick={addProject} disabled={!!indexingPath}>
            <Plus size={20} style={{ color: "var(--text-dim)" }} />
            <span className="pgc-add-label">Add Project</span>
            <span className="pgc-add-desc">Index a new codebase</span>
          </button>
        </div>
      )}
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
