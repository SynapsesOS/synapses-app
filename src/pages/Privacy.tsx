import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  FolderOpen,
  Trash2,
  RefreshCw,
  CheckCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  X,
} from "lucide-react";
import { useToast } from "../context/ToastContext";

interface Project {
  path: string;
  name: string;
}

function fmtBytes(b: number): string {
  if (b >= 1024 * 1024 * 1024) return (b / (1024 * 1024 * 1024)).toFixed(1) + " GB";
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + " MB";
  if (b >= 1024) return (b / 1024).toFixed(1) + " KB";
  return b + " B";
}

export function Privacy() {
  const { addToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [dbSize, setDbSize] = useState(0);
  const [projects, setProjects] = useState<Project[]>([]);
  const [logToolCalls, setLogToolCalls] = useState(true);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Set<string>>(new Set());
  const [confirmModal, setConfirmModal] = useState<{
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  const [clearingWebCache, setClearingWebCache] = useState(false);
  const [clearingMemory, setClearingMemory] = useState(false);
  const [clearingLogs, setClearingLogs] = useState(false);
  const [wipingAll, setWipingAll] = useState(false);
  const [selectedProject, setSelectedProject] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sizes, saved, projectsRaw] = await Promise.all([
        invoke<Record<string, number>>("get_data_sizes"),
        invoke<Record<string, unknown>>("read_app_settings"),
        invoke<string>("run_synapses_cmd", { args: ["list", "--json"] })
          .then((r) => JSON.parse(r) as Project[])
          .catch(() => [] as Project[]),
      ]);
      setDbSize(sizes.synapses ?? 0);
      setProjects(projectsRaw);
      if (saved.log_tool_calls !== undefined) {
        setLogToolCalls(saved.log_tool_calls as boolean);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  async function toggleLogToolCalls() {
    const next = !logToolCalls;
    setLogToolCalls(next);
    try {
      await invoke("write_app_settings", { settings: { log_tool_calls: next } });
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2000);
    } catch { /* non-fatal */ }
  }

  function toggleCard(id: string) {
    setExpandedCards((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleClearAgentMemory() {
    setClearingMemory(true);
    setConfirmModal(null);
    try {
      await invoke("clear_agent_memory");
      addToast("success", "Agent memory cleared across all projects");
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally {
      setClearingMemory(false);
    }
  }

  async function handleClearActivityLogs() {
    setClearingLogs(true);
    setConfirmModal(null);
    try {
      await invoke("clear_activity_logs");
      addToast("success", "Activity logs cleared");
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally {
      setClearingLogs(false);
    }
  }

  async function handleClearWebCache() {
    setClearingWebCache(true);
    try {
      await invoke("clear_web_cache");
      addToast("success", "Web documentation cache cleared");
      loadData();
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally {
      setClearingWebCache(false);
    }
  }

  async function handleDeleteProject(path: string) {
    setDeletingProject(true);
    setConfirmModal(null);
    try {
      await invoke("run_synapses_cmd", { args: ["reset", "-path", path] });
      addToast("success", "Project data deleted");
      setSelectedProject("");
      loadData();
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally {
      setDeletingProject(false);
    }
  }

  async function handleWipeAll() {
    setWipingAll(true);
    setConfirmModal(null);
    try {
      await invoke("wipe_all_data");
      addToast("success", "All data wiped");
      setProjects([]);
      setDbSize(0);
    } catch (e) {
      addToast("error", `Failed: ${e}`);
    } finally {
      setWipingAll(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Privacy & Data</h1>
          <span className="page-subtitle">You own your data — here's everything Synapses stores</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {settingsSaved && (
            <span style={{ fontSize: 12, color: "var(--success)", display: "flex", alignItems: "center", gap: 4 }}>
              <CheckCircle size={12} /> Saved
            </span>
          )}
          <button className="btn-ghost" onClick={loadData} title="Refresh">
            <RefreshCw size={14} className={loading ? "spin" : ""} />
          </button>
        </div>
      </div>

      {/* Privacy Promise */}
      <div className="privacy-pillars">
        <div className="privacy-pillar">
          <div className="privacy-pillar-icon">🔒</div>
          <div className="privacy-pillar-title">100% Local</div>
          <div className="privacy-pillar-desc">All data lives on your machine. No cloud servers, no remote databases.</div>
        </div>
        <div className="privacy-pillar">
          <div className="privacy-pillar-icon">🚫</div>
          <div className="privacy-pillar-title">No Telemetry</div>
          <div className="privacy-pillar-desc">Nothing sent to Anthropic, GitHub, or any third party. Ever.</div>
        </div>
        <div className="privacy-pillar">
          <div className="privacy-pillar-icon">⚡</div>
          <div className="privacy-pillar-title">Precise AI Context</div>
          <div className="privacy-pillar-desc">Your AI gets code structure — names, relationships, rules. Never raw file content.</div>
        </div>
        <div className="privacy-pillar">
          <div className="privacy-pillar-icon">🧠</div>
          <div className="privacy-pillar-title">You're in Control</div>
          <div className="privacy-pillar-desc">Inspect, clear, or delete any data at any time from this screen.</div>
        </div>
      </div>

      {/* What We Store */}
      <section className="settings-section">
        <div className="section-header-row">
          <h2 className="section-title">What We Store</h2>
          {dbSize > 0 && <span className="section-meta">{fmtBytes(dbSize)} total · {projects.length} project{projects.length !== 1 ? "s" : ""}</span>}
        </div>
        <p className="section-desc" style={{ marginBottom: 16 }}>Tap any category to see exactly what's inside and how to clear it.</p>
        <div className="data-category-list">

          <DataCategoryCard
            id="code"
            icon="📸"
            title="Code Snapshots"
            summary="The structure of your code — function names, file locations, and how everything connects."
            note="We never read the actual content inside your functions. Only the shape of your code."
            badge="Per project"
            expanded={expandedCards.has("code")}
            onToggle={() => toggleCard("code")}
            action={
              <button className="btn-secondary btn-sm" onClick={() => invoke("open_data_dir").catch(() => {})}>
                <FolderOpen size={11} /> Open in Finder
              </button>
            }
          >
            <div className="data-tech-detail">
              <div className="detail-row"><strong>Stored:</strong> Function/class names, file paths, call relationships, import graphs, architecture rules you've defined.</div>
              <div className="detail-row"><strong>Not stored:</strong> Actual source code content, function bodies, comments, string literals.</div>
              <div className="detail-row"><strong>Location:</strong> <code>~/.synapses/cache/&lt;project&gt;.db</code> — one database per indexed project.</div>
            </div>
          </DataCategoryCard>

          <DataCategoryCard
            id="memory"
            icon="🧩"
            title="Agent Memory"
            summary="Plans, tasks, and decisions your AI saves so it can pick up exactly where it left off."
            note="This is what makes your AI feel like it actually remembers your project across sessions."
            badge="Per project"
            expanded={expandedCards.has("memory")}
            onToggle={() => toggleCard("memory")}
            action={
              <button
                className="btn-secondary btn-sm btn-danger-hover"
                disabled={clearingMemory}
                onClick={() => setConfirmModal({
                  title: "Clear all agent memory?",
                  message: "This will permanently delete all plans, tasks, decisions, and learned patterns across every indexed project. Your code index is preserved. This cannot be undone.",
                  onConfirm: handleClearAgentMemory,
                })}
              >
                {clearingMemory ? <><RefreshCw size={11} className="spin" /> Clearing…</> : <><Trash2 size={11} /> Clear memory</>}
              </button>
            }
          >
            <div className="data-tech-detail">
              <div className="detail-row"><strong>Stored:</strong> Plans and task lists agents create, what was done and what's still pending, past decisions and patterns, code quality notes.</div>
              <div className="detail-row"><strong>Why:</strong> When you start a new session, your agent resumes mid-task rather than starting from scratch.</div>
              <div className="detail-row"><strong>Multi-agent:</strong> Each AI agent (Claude, Cursor, etc.) tags its own memory. Clearing removes all agents' memory across all projects.</div>
            </div>
          </DataCategoryCard>

          <DataCategoryCard
            id="activity"
            icon="📊"
            title="Activity Log"
            summary="A record of which tools your AI used and how fast — powers the Analytics screen."
            note="Only metadata is logged (tool name + duration). Never the content your AI was reading."
            badge={
              <span className={`privacy-badge ${logToolCalls ? "badge-on" : "badge-off"}`}>
                {logToolCalls ? "Recording" : "Paused"}
              </span>
            }
            expanded={expandedCards.has("activity")}
            onToggle={() => toggleCard("activity")}
            action={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn-secondary btn-sm btn-danger-hover"
                  disabled={clearingLogs}
                  onClick={() => setConfirmModal({
                    title: "Clear activity logs?",
                    message: "This will permanently delete all recorded tool call logs across every indexed project. Cannot be undone.",
                    onConfirm: handleClearActivityLogs,
                  })}
                >
                  {clearingLogs ? <><RefreshCw size={11} className="spin" /> Clearing…</> : <><Trash2 size={11} /> Clear</>}
                </button>
                <button
                  className={`toggle ${logToolCalls ? "toggle-on" : ""}`}
                  onClick={toggleLogToolCalls}
                  role="switch"
                  aria-checked={logToolCalls}
                  title={logToolCalls ? "Recording — click to pause" : "Paused — click to resume"}
                >
                  <span className="toggle-thumb" />
                </button>
              </div>
            }
          >
            <div className="data-tech-detail">
              <div className="detail-row"><strong>Stored:</strong> Tool name, which agent called it, duration in milliseconds, success or failure, timestamp.</div>
              <div className="detail-row"><strong>Not stored:</strong> What the agent was reading, the responses it received, or any code content.</div>
              <div className="detail-row"><strong>Effect:</strong> When paused, the Analytics screen stops receiving new data. Existing logs are preserved until cleared.</div>
            </div>
          </DataCategoryCard>

          <DataCategoryCard
            id="webcache"
            icon="🌐"
            title="Web Docs Cache"
            summary="Documentation pages your AI fetched — package docs, READMEs. Saved for faster repeat lookups."
            note="Regular pages auto-clear after 24 hours. Package docs are kept until you re-index."
            badge="Auto-clears"
            expanded={expandedCards.has("webcache")}
            onToggle={() => toggleCard("webcache")}
            action={
              <button className="btn-secondary btn-sm" onClick={handleClearWebCache} disabled={clearingWebCache}>
                {clearingWebCache
                  ? <><RefreshCw size={11} className="spin" /> Clearing…</>
                  : <><Trash2 size={11} /> Clear cache</>}
              </button>
            }
          >
            <div className="data-tech-detail">
              <div className="detail-row"><strong>Stored:</strong> Text content of documentation pages your agents explicitly fetched.</div>
              <div className="detail-row"><strong>TTL:</strong> Regular URLs expire after 24 hours automatically. Go package docs are version-pinned.</div>
              <div className="detail-row"><strong>Control:</strong> Turn off "Cache web documentation" in Privacy Controls to disable caching entirely.</div>
            </div>
          </DataCategoryCard>

        </div>
      </section>

      {/* Your Data, Your Choice */}
      <section className="settings-section">
        <h2 className="section-title">Your Data, Your Choice</h2>

        <div className="danger-zone">
          <div className="danger-zone-header">
            <AlertTriangle size={13} />
            <span>Danger Zone — these actions cannot be undone</span>
          </div>
          <div className="danger-actions">
            <div className="danger-action-row">
              <div className="danger-action-info">
                <div className="danger-action-title">Delete Project Data</div>
                <div className="danger-action-desc">Removes the index and all agent memory for one project</div>
              </div>
              <div className="danger-action-controls">
                <select
                  className="project-select"
                  value={selectedProject}
                  onChange={(e) => setSelectedProject(e.target.value)}
                >
                  <option value="">Select project…</option>
                  {projects.map((p) => (
                    <option key={p.path} value={p.path}>{p.name}</option>
                  ))}
                </select>
                <button
                  className="btn-danger btn-sm"
                  disabled={!selectedProject || deletingProject}
                  onClick={() => setConfirmModal({
                    title: "Delete project data?",
                    message: `This will permanently remove the code index and all agent memory for "${projects.find((p) => p.path === selectedProject)?.name}". Cannot be undone.`,
                    onConfirm: () => handleDeleteProject(selectedProject),
                  })}
                >
                  {deletingProject ? <><RefreshCw size={11} className="spin" /> Deleting…</> : <><Trash2 size={11} /> Delete</>}
                </button>
              </div>
            </div>
            <div className="danger-divider" />
            <div className="danger-action-row">
              <div className="danger-action-info">
                <div className="danger-action-title">Wipe Everything</div>
                <div className="danger-action-desc">Removes all indexes, agent memory, logs, and settings across every project</div>
              </div>
              <button
                className="btn-danger btn-sm"
                disabled={wipingAll}
                onClick={() => setConfirmModal({
                  title: "Wipe all data?",
                  message: "This permanently deletes ALL indexes, agent memory, logs, and settings for every project. You will need to re-index from scratch.",
                  onConfirm: handleWipeAll,
                })}
              >
                {wipingAll ? <><RefreshCw size={11} className="spin" /> Wiping…</> : "Wipe Everything"}
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Confirm Modal */}
      {confirmModal && (
        <div className="modal-overlay" onClick={() => setConfirmModal(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <AlertTriangle size={18} style={{ color: "var(--danger)" }} />
              <h3>{confirmModal.title}</h3>
              <button className="modal-close" onClick={() => setConfirmModal(null)}>
                <X size={14} />
              </button>
            </div>
            <p className="modal-message">{confirmModal.message}</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmModal(null)}>Cancel</button>
              <button className="btn-danger" onClick={confirmModal.onConfirm}>Yes, delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DataCategoryCard({
  icon, title, summary, note, badge, expanded, onToggle, action, children,
}: {
  id: string;
  icon: string;
  title: string;
  summary: string;
  note: string;
  badge: React.ReactNode;
  expanded: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className={`data-category-card ${expanded ? "expanded" : ""}`}>
      <div className="data-category-header" onClick={onToggle}>
        <span className="data-category-icon">{icon}</span>
        <div className="data-category-main">
          <div className="data-category-title-row">
            <span className="data-category-title">{title}</span>
            {typeof badge === "string"
              ? <span className="privacy-badge">{badge}</span>
              : badge}
          </div>
          <div className="data-category-summary">{summary}</div>
        </div>
        <div className="data-category-end">
          {action && <span onClick={(e) => e.stopPropagation()}>{action}</span>}
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </div>
      {expanded && (
        <div className="data-category-body">
          <div className="data-category-note">💡 {note}</div>
          {children}
        </div>
      )}
    </div>
  );
}

