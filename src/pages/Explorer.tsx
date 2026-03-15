import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Search, AlertCircle, Loader } from "lucide-react";
import { useToast } from "../context/ToastContext";
import type { Project, EntityRow, SearchEntitiesResponse } from "../types";

export function Explorer() {
  const { addToast } = useToast();
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load projects on mount
  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    try {
      const raw = await invoke<string>("run_synapses_cmd", { args: ["list", "--json"] });
      const list = JSON.parse(raw) as Project[];
      setProjects(list);
      if (list.length > 0) {
        setSelectedProject(list[0].path);
      }
    } catch (e) {
      setError("Failed to load projects");
      addToast("error", "Failed to load projects");
    }
  }

  // Debounced search
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (!query.trim()) {
      setResults([]);
      setSearched(false);
      setError(null);
      return;
    }

    if (!selectedProject) {
      setResults([]);
      return;
    }

    debounceTimer.current = setTimeout(() => {
      performSearch();
    }, 300);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query, selectedProject]);

  async function performSearch() {
    if (!selectedProject || !query.trim()) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const encodedQuery = encodeURIComponent(query.trim());
      const encodedProject = encodeURIComponent(selectedProject);
      const response = await fetch(
        `http://127.0.0.1:11435/api/search_entities?project=${encodedProject}&q=${encodedQuery}`,
        { signal: AbortSignal.timeout(5000) }
      );

      if (!response.ok) {
        if (response.status === 404) {
          setError("Project not found. It may have been deleted.");
          setResults([]);
          return;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = (await response.json()) as SearchEntitiesResponse;
      setResults(data.entities || []);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("Failed to fetch") || msg.includes("network") ? "Daemon offline" : `Search failed: ${msg}`);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Entity Explorer</h1>
          <span className="page-subtitle">Search and browse entities across your projects</span>
        </div>
      </div>

      {/* Project selector */}
      {projects.length > 0 ? (
        <div className="explorer-controls">
          <div className="field-group">
            <label className="field-label">Project</label>
            <select
              className="text-input explorer-project-select"
              value={selectedProject || ""}
              onChange={(e) => setSelectedProject(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.path} value={p.path}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Search box */}
          <div className="field-group">
            <label className="field-label">Search</label>
            <div className="explorer-search-box">
              <Search size={16} className="explorer-search-icon" />
              <input
                type="text"
                className="text-input explorer-search-input"
                placeholder="Function, struct, file, endpoint…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                disabled={loading}
              />
              {loading && <Loader size={16} className="explorer-spinner" />}
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state-large">
          <AlertCircle size={48} className="empty-icon" />
          <p>No projects indexed yet.</p>
          <p className="empty-state-hint">Index a project from the Projects page to start exploring entities.</p>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="offline-banner">
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Results */}
      {projects.length > 0 && (
        <div className="explorer-results">
          {!searched ? (
            <div className="empty-state">
              <p>Enter a search term to find entities</p>
            </div>
          ) : results.length === 0 ? (
            <div className="empty-state">
              <p>No entities found. Try different keywords.</p>
            </div>
          ) : (
            <div className="an-table">
              <div className="an-table-head">
                <div className="an-table-row">
                  <div className="an-table-cell" style={{ flex: "0 0 35%" }}>
                    Entity
                  </div>
                  <div className="an-table-cell" style={{ flex: "0 0 15%" }}>
                    Type
                  </div>
                  <div className="an-table-cell" style={{ flex: "0 0 40%" }}>
                    File
                  </div>
                  <div className="an-table-cell" style={{ flex: "0 0 10%" }}>
                    Domain
                  </div>
                </div>
              </div>
              <div className="an-table-body">
                {results.map((entity) => (
                  <div key={entity.id} className="an-table-row">
                    <div className="an-table-cell" style={{ flex: "0 0 35%" }} title={entity.name}>
                      {entity.name}
                    </div>
                    <div className="an-table-cell" style={{ flex: "0 0 15%" }}>
                      <span className="entity-type-badge">{entity.type}</span>
                    </div>
                    <div className="an-table-cell an-table-cell-mono" style={{ flex: "0 0 40%" }} title={entity.file}>
                      {entity.file || "—"}
                    </div>
                    <div className="an-table-cell" style={{ flex: "0 0 10%" }}>
                      {entity.domain !== "code" && <DomainBadge domain={entity.domain} />}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DomainBadge({ domain }: { domain: string }) {
  return <span className={`domain-badge domain-badge--${domain}`}>{domain}</span>;
}
