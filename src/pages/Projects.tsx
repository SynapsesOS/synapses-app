import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Plus, RefreshCw, Trash2, FolderOpen } from "lucide-react";

interface Project {
  path: string;
  name: string;
  nodes?: number;
  last_indexed?: string;
}

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
const [indexingPath, setIndexingPath] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("");

  useEffect(() => {
    loadProjects();
  }, []);

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
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Select project directory",
    });
    if (!selected || typeof selected !== "string") return;

    setIndexingPath(selected);
    setOutput("Indexing…");
    try {
      const out = await invoke<string>("run_synapses_cmd", {
        args: ["index", "--path", selected],
      });
      setOutput(out || "Indexed successfully.");
      await loadProjects();
    } catch (e) {
      setOutput(String(e));
    } finally {
      setIndexingPath(null);
    }
  }

  async function reindex(path: string) {
    setIndexingPath(path);
    setOutput("Re-indexing…");
    try {
      const out = await invoke<string>("run_synapses_cmd", {
        args: ["index", "--path", path],
      });
      setOutput(out || "Done.");
      await loadProjects();
    } catch (e) {
      setOutput(String(e));
    } finally {
      setIndexingPath(null);
    }
  }

  async function removeProject(path: string) {
    if (!confirm(`Remove ${path} from Synapses? (Does not delete files)`)) return;
    try {
      await invoke("run_synapses_cmd", { args: ["reset", "--path", path] });
      await loadProjects();
    } catch (e) {
      setOutput(String(e));
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">Projects</h1>
        <button className="btn-primary" onClick={addProject} disabled={!!indexingPath}>
          <Plus size={14} />
          Add Project
        </button>
      </div>

      {output && (
        <div className="output-box">
          <pre>{output}</pre>
          <button className="output-close" onClick={() => setOutput("")}>×</button>
        </div>
      )}

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
          {projects.map((p) => (
            <div key={p.path} className="project-row">
              <div className="project-info">
                <div className="project-name">{p.name}</div>
                <div className="project-path">{p.path}</div>
                {p.nodes !== undefined && (
                  <div className="project-meta">{p.nodes.toLocaleString()} nodes</div>
                )}
              </div>
              <div className="project-actions">
                <button
                  className="icon-btn"
                  title="Re-index"
                  onClick={() => reindex(p.path)}
                  disabled={indexingPath === p.path}
                >
                  <RefreshCw size={14} className={indexingPath === p.path ? "spin" : ""} />
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
          ))}
        </div>
      )}
    </div>
  );
}
