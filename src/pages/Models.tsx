import { useState, useEffect, useRef, useCallback } from "react";
import {
  Download,
  RefreshCw,
  CheckCircle,
  MemoryStick,
  Trash2,
  MessageSquare,
  X,
  AlertTriangle,
  Send,
  Power,
  Info,
  Layers,
  Zap,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "../context/ToastContext";

// ── Constants ─────────────────────────────────────────────────────────────────

const OLLAMA_URL_DEFAULT = "http://localhost:11434";

// All three intelligence levels use the SAME base model: qwen3.5:2b (Q8, ~2.7 GB).
// The difference is which Ollama "personas" (synapses/* identities) are active —
// not how much you download. Each persona is a ~1 KB Modelfile config, not a
// separate model. Ollama shares weights in RAM — all 5 tiers cost ~2.7 GB total.
//
// Optimal  — 4 tiers, Critic disabled (Librarian covers Guardian's role)
// Standard — all 5 tiers, Critic active. Recommended for most machines.
// Full     — identical to Standard (Full=Standard since the architecture pivot)
const INTELLIGENCE_LEVELS = {
  optimal: {
    label:         "Optimal",
    tagline:       "4 tiers, Critic off",
    description:   "All tiers except Critic are active. Librarian covers rule-violation explanations. Best for machines with 8 GB RAM — same 2.7 GB download as Standard.",
    activeTiers:   ["T0 · Sentry", "T2 · Librarian", "T3 · Navigator", "Archivist"],
    models:        ["qwen3.5:2b"] as string[],
    identities:    ["synapses/sentry", "synapses/librarian", "synapses/navigator", "synapses/archivist"],
    downloadLabel: "~2.7 GB",
    config: {
      ModelIngest: "synapses/sentry", ModelGuardian: "synapses/librarian",
      ModelEnrich: "synapses/librarian", ModelOrchestrate: "synapses/navigator",
      ModelArchivist: "synapses/archivist",
      Ingest: true, Guardian: true, Enrich: true, Orchestrate: true, Memorize: true,
    },
  },
  standard: {
    label:         "Standard",
    tagline:       "All 5 tiers active",
    description:   "Critic tier is fully active alongside Librarian. Violations get dedicated explanations. Recommended — same 2.7 GB download as every other mode.",
    activeTiers:   ["T0 · Sentry", "T1 · Critic", "T2 · Librarian", "T3 · Navigator", "Archivist"],
    models:        ["qwen3.5:2b"] as string[],
    identities:    ["synapses/sentry", "synapses/critic", "synapses/librarian", "synapses/navigator", "synapses/archivist"],
    downloadLabel: "~2.7 GB",
    config: {
      ModelIngest: "synapses/sentry", ModelGuardian: "synapses/critic",
      ModelEnrich: "synapses/librarian", ModelOrchestrate: "synapses/navigator",
      ModelArchivist: "synapses/archivist",
      Ingest: true, Guardian: true, Enrich: true, Orchestrate: true, Memorize: true,
    },
  },
  full: {
    label:         "Full",
    tagline:       "Same as Standard",
    description:   "Identical to Standard — all 5 tiers use the same qwen3.5:2b base. The architecture uses one shared model, so Full and Standard are equivalent.",
    activeTiers:   ["T0 · Sentry", "T1 · Critic", "T2 · Librarian", "T3 · Navigator", "Archivist"],
    models:        ["qwen3.5:2b"] as string[],
    identities:    ["synapses/sentry", "synapses/critic", "synapses/librarian", "synapses/navigator", "synapses/archivist"],
    downloadLabel: "~2.7 GB",
    config: {
      ModelIngest: "synapses/sentry", ModelGuardian: "synapses/critic",
      ModelEnrich: "synapses/librarian", ModelOrchestrate: "synapses/navigator",
      ModelArchivist: "synapses/archivist",
      Ingest: true, Guardian: true, Enrich: true, Orchestrate: true, Memorize: true,
    },
  },
} as const;

type IntelligenceLevel = keyof typeof INTELLIGENCE_LEVELS;

// The 5 Ollama personas that power the brain — all backed by qwen3.5:2b.
// Each is a ~1 KB Modelfile: a system prompt + JSON schema, no extra weights.
const BRAIN_IDENTITIES = [
  {
    tag:   "synapses/sentry",
    tier:  "T0 · Sentry",
    role:  "Classifies code entities and routes them to the right tier",
    note:  "Called on every file save — always resident in RAM",
  },
  {
    tag:   "synapses/critic",
    tier:  "T1 · Critic",
    role:  "Explains architectural rule violations and suggests concrete fixes",
    note:  "Responses cached per (ruleID, file) — LLM called once per unique violation",
  },
  {
    tag:   "synapses/librarian",
    tier:  "T2 · Librarian",
    role:  "Analyzes code graph slices for architectural patterns and risks",
    note:  "Also covers Guardian's role in Optimal mode",
  },
  {
    tag:   "synapses/navigator",
    tier:  "T3 · Navigator",
    role:  "Resolves multi-agent work scope conflicts",
    note:  "Cold standby — called only when agent conflicts are detected",
  },
  {
    tag:   "synapses/archivist",
    tier:  "Archivist",
    role:  "Synthesizes session tool-call transcripts into persistent memories",
    note:  "Runs at session end — stores only architectural discoveries",
  },
];

const SDLC_PHASES = [
  { key: "planning",    label: "Planning",    desc: "Agents explore freely. No quality gates or constraint enforcement — architectural rules are advisory only." },
  { key: "development", label: "Development", desc: "Full context with all rules active. Agents are guided to run validate_plan, claim work, and write tests." },
  { key: "testing",     label: "Testing",     desc: "Agents focus on test coverage only. Implementation context is stripped out. No new features allowed." },
  { key: "review",      label: "Review",      desc: "Strictest context: all violations flagged, full quality gates, PR checklist enforced by the Critic." },
  { key: "deployment",  label: "Deployment",  desc: "Agents are blocked from touching source files. Monitor-only mode — code is frozen." },
];

const QUALITY_MODES = [
  { key: "quick",      label: "Quick",      desc: "Gate: verify it compiles and the primary use-case works. No test or documentation requirement." },
  { key: "standard",   label: "Standard",   desc: "Gate: unit tests for modified functions, no architectural violations, key exports documented." },
  { key: "enterprise", label: "Enterprise", desc: "Gate: full tests + integration tests, all exports documented, PR review sign-off, CHANGELOG updated." },
];

// ── Utility helpers ───────────────────────────────────────────────────────────

// Strip ANSI escape codes so CLI output is readable in a browser <pre>.
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── Level helpers ─────────────────────────────────────────────────────────────

function recommendedLevel(ramGb: number): IntelligenceLevel {
  if (ramGb >= 16) return "standard";
  if (ramGb >= 8)  return "standard";
  return "optimal"; // 8 GB or less — Critic off saves CPU cycles
}

function detectLevel(cfg: BrainConfig): IntelligenceLevel | "custom" {
  for (const [key, level] of Object.entries(INTELLIGENCE_LEVELS)) {
    const c = level.config;
    if (
      cfg.ModelIngest     === c.ModelIngest     &&
      cfg.ModelGuardian   === c.ModelGuardian   &&
      cfg.ModelEnrich     === c.ModelEnrich     &&
      cfg.ModelOrchestrate === c.ModelOrchestrate &&
      cfg.ModelArchivist  === c.ModelArchivist  &&
      cfg.Ingest      === c.Ingest      &&
      cfg.Guardian    === c.Guardian    &&
      cfg.Enrich      === c.Enrich      &&
      cfg.Orchestrate === c.Orchestrate &&
      cfg.Memorize    === c.Memorize
    ) return key as IntelligenceLevel;
  }
  return "custom";
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrainConfig {
  OllamaURL: string;
  ModelIngest: string; ModelGuardian: string; ModelEnrich: string;
  ModelOrchestrate: string; ModelArchivist: string;
  TimeoutMS: number;
  DefaultPhase: string; DefaultMode: string;
  Ingest: boolean; Enrich: boolean; Guardian: boolean; Orchestrate: boolean; Memorize: boolean;
  [key: string]: string | number | boolean;
}

interface InstalledModel { name: string; size: number; modified_at: string; }
interface ChatMessage    { role: "user" | "assistant"; content: string; }
type PullStatus   = "idle" | "pulling" | "done" | "error";
type PullProgress = { completed?: number; total?: number; status?: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: BrainConfig = {
  OllamaURL: OLLAMA_URL_DEFAULT,
  ModelIngest: "", ModelGuardian: "", ModelEnrich: "", ModelOrchestrate: "", ModelArchivist: "",
  TimeoutMS: 30000,
  DefaultPhase: "development", DefaultMode: "standard",
  Ingest: true, Enrich: false, Guardian: false, Orchestrate: false, Memorize: false,
};

function fmtBytes(b: number): string {
  if (b >= 1_073_741_824) return `${(b / 1_073_741_824).toFixed(1)} GB`;
  if (b >= 1_048_576)     return `${(b / 1_048_576).toFixed(0)} MB`;
  return `${b} B`;
}
function fmtDate(iso: string): string {
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); }
  catch { return ""; }
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <AlertTriangle size={16} style={{ color: "var(--danger)" }} />
          <span className="modal-title">{title}</span>
        </div>
        <p className="modal-body">{message}</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={onCancel}>Cancel</button>
          <button className="btn-secondary btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

// ── Models Sidebar (View all downloaded) ──────────────────────────────────────

interface ModelsSidebarProps {
  models: InstalledModel[];
  runningModels: string[];
  onChat: (name: string) => void;
  onDelete: (name: string) => void;
  onClose: () => void;
}

function ModelsSidebar({ models, runningModels, onChat, onDelete, onClose }: ModelsSidebarProps) {
  return (
    <>
      <div className="chat-backdrop" onClick={onClose} />
      <div className="chat-panel" style={{ width: 460 }}>
        <div className="chat-panel-header">
          <div className="chat-panel-title">
            <div className="chat-panel-tier">Downloaded Models</div>
            <div className="chat-panel-model">{models.length} model{models.length !== 1 ? "s" : ""} installed via Ollama</div>
          </div>
          <button className="icon-btn" onClick={onClose}><X size={15} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
          {models.map((m) => {
            const isRunning = runningModels.includes(m.name);
            return (
              <div key={m.name} className="model-row" style={{ padding: "10px 14px" }}>
                <div className="model-info" style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="model-name" style={{ fontSize: 12 }}>{m.name}</span>
                    {isRunning && (
                      <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--success)" }}>
                        <span className="status-dot healthy" style={{ width: 5, height: 5 }} /> loaded
                      </span>
                    )}
                  </div>
                  <span className="model-desc">{fmtBytes(m.size)} · {fmtDate(m.modified_at)}</span>
                </div>
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button className="icon-btn" title="Test in chat" onClick={() => onChat(m.name)}>
                    <MessageSquare size={13} />
                  </button>
                  <button className="icon-btn icon-btn-danger" title="Delete model" onClick={() => onDelete(m.name)}>
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
          {models.length === 0 && (
            <div className="empty-state">No models installed yet.</div>
          )}
        </div>
      </div>
    </>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export function Models() {
  const { addToast } = useToast();

  // Brain config
  const [brainConfig, setBrainConfig] = useState<BrainConfig>(DEFAULT_CONFIG);

  // Ollama
  const [ollamaStatus, setOllamaStatus]       = useState<{ running: boolean; version?: string } | null>(null);
  const [installedModels, setInstalledModels] = useState<InstalledModel[]>([]);
  const [runningModels, setRunningModels]     = useState<string[]>([]);
  const [modelsLoading, setModelsLoading]     = useState(false);

  // System
  const [ramGb, setRamGb] = useState(0);

  // Ollama settings
  const [ollamaUrl, setOllamaUrl]         = useState(OLLAMA_URL_DEFAULT);
  const [timeoutMs, setTimeoutMs]         = useState(30000);
  const [maxModels, setMaxModels]         = useState(1);
  const [ollamaApplied, setOllamaApplied] = useState(false);

  // Pull state
  const [pullStatuses, setPullStatuses] = useState<Record<string, PullStatus>>({});
  const [pullProgress, setPullProgress] = useState<Record<string, PullProgress>>({});

  // Confirm modal
  const [confirmModal, setConfirmModal] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);

  // Models sidebar
  const [modelsSidebarOpen, setModelsSidebarOpen] = useState(false);

  // Chat panel
  const [chatOpen, setChatOpen]         = useState(false);
  const [chatModel, setChatModel]       = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatStreaming, setChatStreaming] = useState(false);
  const chatAbortRef  = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);

  // Brain setup state
  const [setupRunning, setSetupRunning] = useState(false);
  const [setupOutput, setSetupOutput]   = useState("");

  // ── Derived ────────────────────────────────────────────────────────────────

  const activeOllamaUrl = brainConfig.OllamaURL || OLLAMA_URL_DEFAULT;
  const installedNames  = installedModels.map((m) => m.name);
  const currentLevel    = detectLevel(brainConfig);
  const recLevel        = ramGb > 0 ? recommendedLevel(ramGb) : "standard";
  const budgetGb        = ramGb > 0 ? parseFloat((ramGb * 0.18).toFixed(1)) : null;

  // Brain setup derived state
  const normName = (n: string) => n.replace(/:latest$/, "");
  const baseModelInstalled  = installedNames.some((n) => normName(n) === "qwen3.5:2b");
  const registeredIds       = BRAIN_IDENTITIES.filter((id) =>
    installedNames.some((n) => normName(n) === id.tag)
  );
  const missingIds          = BRAIN_IDENTITIES.filter((id) =>
    !installedNames.some((n) => normName(n) === id.tag)
  );
  const brainReady = baseModelInstalled && missingIds.length === 0;


  // ── Mount ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      const [ram, status, configRaw] = await Promise.allSettled([
        invoke<number>("get_system_ram_gb"),
        invoke<{ running: boolean; version?: string }>("check_ollama"),
        invoke<string>("read_brain_config"),
      ]);

      const gb = ram.status === "fulfilled" ? ram.value : 0;
      setRamGb(gb);

      if (status.status === "fulfilled")
        setOllamaStatus({ running: status.value.running, version: status.value.version });

      let cfg = { ...DEFAULT_CONFIG };
      if (configRaw.status === "fulfilled") {
        try { cfg = { ...DEFAULT_CONFIG, ...JSON.parse(configRaw.value) }; } catch { /**/ }
      }

      // Auto-apply RAM-based recommendation if brain tiers have never been configured
      if (!cfg.ModelIngest && gb > 0) {
        const rec = recommendedLevel(gb);
        cfg = { ...cfg, ...INTELLIGENCE_LEVELS[rec].config };
      }

      setBrainConfig(cfg);
      setOllamaUrl(cfg.OllamaURL || OLLAMA_URL_DEFAULT);
      setTimeoutMs(cfg.TimeoutMS || 30000);
      if (gb > 0) setMaxModels(gb >= 16 ? 2 : 1);

      if (status.status === "fulfilled" && status.value.running)
        await refreshModels(cfg.OllamaURL || OLLAMA_URL_DEFAULT);
    }
    load();
  }, []);

  // Chat scroll
  useEffect(() => {
    if (chatScrollRef.current)
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
  }, [chatMessages]);

  // ── Config helpers ─────────────────────────────────────────────────────────

  async function refreshModels(url?: string) {
    const base = url ?? activeOllamaUrl;
    setModelsLoading(true);
    try {
      const [tagsRes, psRes] = await Promise.allSettled([
        fetch(`${base}/api/tags`).then((r) => r.json()),
        fetch(`${base}/api/ps`).then((r) => r.json()),
      ]);
      if (tagsRes.status === "fulfilled")
        setInstalledModels((tagsRes.value?.models ?? []) as InstalledModel[]);
      if (psRes.status === "fulfilled")
        setRunningModels((psRes.value?.models ?? []).map((m: { name: string }) => m.name));
    } finally { setModelsLoading(false); }
  }

  async function writeBrainConfig(cfg: BrainConfig) {
    await invoke("write_brain_config", { content: JSON.stringify(cfg) });
  }

  // ── Intelligence level ─────────────────────────────────────────────────────

  async function applyLevel(level: IntelligenceLevel) {
    const updated = { ...brainConfig, ...INTELLIGENCE_LEVELS[level].config };
    setBrainConfig(updated);
    try {
      await writeBrainConfig(updated);
      addToast("success", `Intelligence level set to ${INTELLIGENCE_LEVELS[level].label}. Applies on next brain session.`);
    } catch (e) { addToast("error", `Failed to save: ${e}`); }
  }

  // ── Pull ───────────────────────────────────────────────────────────────────

  const pullModel = useCallback(async (modelName: string) => {
    if (!modelName.trim()) return;
    setPullStatuses((p) => ({ ...p, [modelName]: "pulling" }));
    setPullProgress((p) => ({ ...p, [modelName]: {} }));
    try {
      const res = await fetch(`${activeOllamaUrl}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: modelName, stream: true }),
        signal: AbortSignal.timeout(600_000),
      });
      if (!res.ok) throw new Error("pull failed");
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          try {
            const j = JSON.parse(line) as PullProgress;
            if ((j as { error?: string }).error) throw new Error((j as { error?: string }).error);
            setPullProgress((p) => ({ ...p, [modelName]: j }));
          } catch (inner: unknown) {
            if (inner instanceof Error && inner.message !== "SyntaxError") throw inner;
          }
        }
      }
      setPullStatuses((p) => ({ ...p, [modelName]: "done" }));
      addToast("success", `${modelName} downloaded.`);
      await refreshModels();
    } catch {
      setPullStatuses((p) => ({ ...p, [modelName]: "error" }));
      addToast("error", `Failed to download ${modelName}`);
    }
  }, [activeOllamaUrl]);

  // ── Ollama settings ────────────────────────────────────────────────────────

  async function applyOllamaSettings() {
    try {
      const updated = { ...brainConfig, OllamaURL: ollamaUrl, TimeoutMS: timeoutMs };
      await Promise.all([writeBrainConfig(updated), invoke("set_ollama_max_models", { count: maxModels })]);
      setBrainConfig(updated);
      setOllamaApplied(true);
      addToast("success", "Settings saved. Restart Ollama for max-models to take effect.", 6000);
      setTimeout(() => setOllamaApplied(false), 3000);
    } catch (e) { addToast("error", `Failed: ${e}`); }
  }

  // ── Brain setup ────────────────────────────────────────────────────────────

  async function setupBrain() {
    setSetupRunning(true);
    setSetupOutput("");
    try {
      // --skip-pull:  base model must already be downloaded before calling this.
      //               The UI ensures qwen3.5:2b is pulled first.
      // --skip-smoke: smoke tests block the Tauri main thread up to 225 s (5 tiers × 45 s).
      //               The UI verifies registration independently via /api/tags after this call.
      // --no-color:   ANSI escape codes appear as garbage in a browser <pre>.
      const out = await invoke<string>("run_synapses_cmd", {
        args: ["brain", "setup", "--skip-pull", "--skip-smoke", "--no-color",
               "--ollama", activeOllamaUrl,
               "--mode", currentLevel !== "custom" ? currentLevel : "standard"],
      });
      setSetupOutput(stripAnsi(out));
      addToast("success", "AI tier identities registered successfully.");
      await refreshModels();
    } catch (e) {
      setSetupOutput(stripAnsi(String(e)));
      addToast("error", "Brain setup failed — see output below.");
    } finally {
      setSetupRunning(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────────────────────

  function requestDelete(name: string) {
    setConfirmModal({
      title: "Delete model",
      message: `Delete "${name}" from Ollama? This cannot be undone. You will need to download it again to use it.`,
      onConfirm: () => { setConfirmModal(null); doDelete(name); },
    });
  }

  async function doDelete(name: string) {
    try {
      const res = await fetch(`${activeOllamaUrl}/api/delete`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      addToast("success", `"${name}" deleted.`);
      await refreshModels();
    } catch (e) { addToast("error", `Delete failed: ${e}`); }
  }

  // ── SDLC / Quality Mode ────────────────────────────────────────────────────

  async function setPhase(phase: string) {
    const updated = { ...brainConfig, DefaultPhase: phase };
    setBrainConfig(updated);
    try { await writeBrainConfig(updated); }
    catch (e) { addToast("error", `Failed: ${e}`); }
  }

  async function setMode(mode: string) {
    const updated = { ...brainConfig, DefaultMode: mode };
    setBrainConfig(updated);
    try { await writeBrainConfig(updated); }
    catch (e) { addToast("error", `Failed: ${e}`); }
  }

  // ── Chat ───────────────────────────────────────────────────────────────────

  function openChat(model: string) {
    chatAbortRef.current?.abort();
    setChatModel(model); setChatMessages([]); setChatInput("");
    setChatStreaming(false); setChatOpen(true);
    if (modelsSidebarOpen) setModelsSidebarOpen(false);
  }

  async function closeChat() {
    chatAbortRef.current?.abort();
    setChatOpen(false);
    // Unload model from Ollama memory immediately
    if (chatModel) {
      try {
        await fetch(`${activeOllamaUrl}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: chatModel, prompt: "", keep_alive: 0 }),
          signal: AbortSignal.timeout(3000),
        });
      } catch { /* best-effort */ }
    }
    await refreshModels();
  }

  async function sendChat(text?: string) {
    const msg = (text ?? chatInput).trim();
    if (!msg || chatStreaming || !chatModel) return;
    setChatInput("");
    const msgs: ChatMessage[] = [...chatMessages, { role: "user", content: msg }];
    setChatMessages(msgs);
    setChatStreaming(true);
    chatAbortRef.current = new AbortController();
    let buf = "";
    try {
      const res = await fetch(`${activeOllamaUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: chatModel, messages: msgs, stream: true }),
        signal: chatAbortRef.current.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error("no body");
      const decoder = new TextDecoder();
      setChatMessages((p) => [...p, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value).split("\n").filter(Boolean)) {
          try {
            buf += JSON.parse(line)?.message?.content ?? "";
            setChatMessages((p) => { const u = [...p]; u[u.length - 1] = { role: "assistant", content: buf }; return u; });
          } catch { /**/ }
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError")
        addToast("error", `Chat error: ${err.message}`);
    } finally { setChatStreaming(false); }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────

  function PullProgressRow({ modelName }: { modelName: string }) {
    const status = pullStatuses[modelName] ?? "idle";
    const prog   = pullProgress[modelName];
    const pct    = prog?.total && prog?.completed ? Math.round((prog.completed / prog.total) * 100) : null;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)", fontFamily: "monospace", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {modelName}
        </span>
        {status === "pulling" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, maxWidth: 220 }}>
            <div className="pull-progress-bar-track" style={{ flex: 1 }}>
              <div className="pull-progress-bar-fill" style={{ width: `${pct ?? 0}%` }} />
            </div>
            <span style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
              {pct != null ? `${pct}%` : (prog?.status ?? "…")}
            </span>
          </div>
        )}
        {status === "done"  && <CheckCircle size={12} style={{ color: "var(--success)", flexShrink: 0 }} />}
        {status === "error" && (
          <button className="btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => pullModel(modelName)}>retry</button>
        )}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="page">

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Models & Brain</h1>
          <p className="page-subtitle">Configure the intelligence engine that powers Synapses agents.</p>
        </div>
        {ollamaStatus !== null && (
          <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, flexShrink: 0,
            color: ollamaStatus.running ? "var(--success)" : "var(--danger)" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
              background: ollamaStatus.running ? "var(--success)" : "var(--danger)" }} />
            {ollamaStatus.running ? `Ollama ${ollamaStatus.version ?? "running"}` : "Ollama offline"}
          </span>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 0 — BRAIN SETUP
          ════════════════════════════════════════════════════════════════════ */}
      <section className="settings-section">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 4 }}>Brain Setup</h2>
            <p className="page-subtitle" style={{ margin: 0, fontSize: 12 }}>
              One model download. Five AI tiers. All intelligence runs locally on your machine.
            </p>
          </div>
          {brainReady && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--success)", flexShrink: 0, paddingTop: 2 }}>
              <CheckCircle size={14} /> Brain Ready
            </span>
          )}
        </div>

        {/* Base model card */}
        <div className="resource-card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Layers size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>qwen3.5:2b</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 10 }}>
                    ~2.7 GB · Q8 quantization · Qwen 3.5 2B
                  </span>
                </div>
                {baseModelInstalled
                  ? <span style={{ fontSize: 11, color: "var(--success)", display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <CheckCircle size={12} /> downloaded
                    </span>
                  : <span style={{ fontSize: 11, color: "var(--warning)", flexShrink: 0 }}>not downloaded</span>
                }
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 8px" }}>
                This is the <strong style={{ color: "var(--text)" }}>foundation model</strong> for all 5 AI tiers.
                Download it once — every tier shares the same 2.7 GB in RAM.
                No separate model per tier, no extra downloads ever.
              </p>
              {!baseModelInstalled && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <PullProgressRow modelName="qwen3.5:2b" />
                  <button
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "7px 16px", alignSelf: "flex-start" }}
                    onClick={() => pullModel("qwen3.5:2b")}
                    disabled={pullStatuses["qwen3.5:2b"] === "pulling"}
                  >
                    <Download size={12} /> Download qwen3.5:2b (~2.7 GB)
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* AI tier identities */}
        <div className="resource-card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <Zap size={18} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>AI Tier Identities</span>
                  <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 10 }}>
                    5 personas · ~1 KB each · no extra download
                  </span>
                </div>
                <span style={{ fontSize: 11, color: registeredIds.length === BRAIN_IDENTITIES.length ? "var(--success)" : "var(--text-dim)", flexShrink: 0 }}>
                  {registeredIds.length} / {BRAIN_IDENTITIES.length} registered
                </span>
              </div>
              <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
                Each persona is a Modelfile — a small config that gives the base model a specialized role and JSON output schema.
                Think of them as "roles" for the same actor.
              </p>

              {/* Identity rows — hide until Ollama status is known to prevent "○ missing" flash */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
                {ollamaStatus === null ? (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", padding: "6px 2px" }}>
                    Checking Ollama...
                  </div>
                ) : BRAIN_IDENTITIES.map((id) => {
                  const registered = installedNames.some((n) => normName(n) === id.tag);
                  return (
                    <div key={id.tag} style={{
                      display: "flex", alignItems: "flex-start", gap: 10,
                      padding: "8px 10px", borderRadius: "var(--radius-sm)",
                      background: registered ? "rgba(34,197,94,0.05)" : "var(--surface)",
                      border: `1px solid ${registered ? "rgba(34,197,94,0.2)" : "var(--border)"}`,
                    }}>
                      <span style={{ fontSize: 11, marginTop: 1, flexShrink: 0, color: registered ? "var(--success)" : "var(--text-dim)" }}>
                        {registered ? "✓" : "○"}
                      </span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                          <code style={{ fontSize: 11, color: "var(--accent)" }}>{id.tag}</code>
                          <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3,
                            background: "var(--surface2)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
                            {id.tier}
                          </span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{id.role}</div>
                        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2, fontStyle: "italic" }}>{id.note}</div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Register button — only shown when base model is installed but identities are missing */}
              {baseModelInstalled && missingIds.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <button
                    className="btn-primary"
                    style={{ fontSize: 12, padding: "7px 16px", alignSelf: "flex-start" }}
                    onClick={setupBrain}
                    disabled={setupRunning}
                  >
                    {setupRunning
                      ? <><RefreshCw size={12} className="spin" /> Registering tiers...</>
                      : <><Zap size={12} /> Register {missingIds.length} missing tier{missingIds.length > 1 ? "s" : ""}</>
                    }
                  </button>
                  {setupOutput && (
                    <pre style={{
                      fontSize: 10, color: "var(--text-muted)", background: "var(--surface)",
                      border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                      padding: "8px 10px", overflowX: "auto", maxHeight: 180, whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                    }}>
                      {setupOutput}
                    </pre>
                  )}
                </div>
              )}

              {/* Not installed yet — explain that base model must come first */}
              {!baseModelInstalled && missingIds.length > 0 && (
                <p style={{ fontSize: 11, color: "var(--text-dim)", margin: 0 }}>
                  Download qwen3.5:2b first — then register the AI tier identities in one click.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* All ready state */}
        {brainReady && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--success)" }}>
            <CheckCircle size={14} />
            All 5 AI tier identities are registered and ready. Select an intelligence level below.
          </div>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 1 — INTELLIGENCE LEVEL
          ════════════════════════════════════════════════════════════════════ */}
      <section className="settings-section">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div>
            <h2 className="section-title" style={{ marginBottom: 4 }}>Intelligence Level</h2>
            <p className="page-subtitle" style={{ margin: 0, fontSize: 12 }}>
              Pick how much of the brain to run. Synapses automatically routes each job to the right model.
            </p>
          </div>
          {ramGb > 0 && budgetGb && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", flexShrink: 0, paddingTop: 2 }}>
              <MemoryStick size={12} />
              {ramGb} GB RAM · budget <strong style={{ color: "var(--text)" }}>{budgetGb} GB</strong>
            </div>
          )}
        </div>

        {/* Level cards */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          {(Object.entries(INTELLIGENCE_LEVELS) as [IntelligenceLevel, typeof INTELLIGENCE_LEVELS[IntelligenceLevel]][]).map(([key, level]) => {
            const isSelected    = currentLevel === key;
            const isRecommended = key === recLevel;
            return (
              <div
                key={key}
                onClick={() => applyLevel(key)}
                style={{
                  flex: 1,
                  padding: "14px 16px",
                  borderRadius: "var(--radius)",
                  border: `1.5px solid ${isSelected ? "var(--accent)" : "var(--border)"}`,
                  background: isSelected ? "rgba(99,102,241,0.07)" : "var(--surface2)",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                  position: "relative",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {/* Recommended badge */}
                {isRecommended && (
                  <span style={{
                    position: "absolute", top: -9, left: 12,
                    fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                    background: "var(--accent)", color: "#fff",
                    padding: "2px 7px", borderRadius: 4,
                  }}>
                    Recommended
                  </span>
                )}

                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>{level.label}</div>
                    <div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{level.tagline}</div>
                  </div>
                  {isSelected && <CheckCircle size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />}
                </div>

                {/* Description */}
                <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
                  {level.description}
                </p>

                {/* Active tiers */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {level.activeTiers.map((t) => (
                    <span key={t} style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 4,
                      background: isSelected ? "rgba(99,102,241,0.15)" : "var(--surface)",
                      color: isSelected ? "var(--accent)" : "var(--text-dim)",
                      border: `1px solid ${isSelected ? "rgba(99,102,241,0.3)" : "var(--border)"}`,
                      fontWeight: 600,
                    }}>
                      {t}
                    </span>
                  ))}
                </div>

                {/* Download size */}
                <div style={{ fontSize: 11, color: "var(--text-dim)", display: "flex", alignItems: "center", gap: 4 }}>
                  <Download size={10} />
                  {level.downloadLabel} · qwen3.5:2b · {level.identities.length} tier{level.identities.length > 1 ? "s" : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Custom configuration notice */}
        {currentLevel === "custom" && (
          <div className="resource-card" style={{ marginBottom: 14, gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Info size={13} style={{ color: "var(--accent)" }} />
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                Custom configuration active. Select a level above to switch to a preset.
              </span>
            </div>
          </div>
        )}

        {/* Download / ready status for selected level */}
        {currentLevel !== "custom" && (
          <>
            {!brainReady ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}>
                <Info size={13} style={{ color: "var(--accent)" }} />
                Complete Brain Setup above to activate the {INTELLIGENCE_LEVELS[currentLevel].label} level.
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--success)" }}>
                <CheckCircle size={14} />
                {INTELLIGENCE_LEVELS[currentLevel].label} level is active.
              </div>
            )}
          </>
        )}
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 2 — MANAGE OLLAMA
          ════════════════════════════════════════════════════════════════════ */}
      <section className="settings-section">
        <h2 className="section-title">Manage Ollama</h2>

        {ollamaStatus !== null && !ollamaStatus.running && (
          <div className="offline-banner" style={{ marginBottom: 16 }}>
            <AlertTriangle size={14} /> Ollama is not running — start it to manage models.
          </div>
        )}

        <div className="resource-card" style={{ gap: 14, marginBottom: 16 }}>
          <div>
            <label className="field-label">Server URL</label>
            <input className="text-input" style={{ width: "100%" }} value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
          </div>

          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label className="field-label">
                Concurrent Models in Memory
                <code style={{ fontSize: 9, letterSpacing: 0, textTransform: "none", marginLeft: 6, color: "var(--text-dim)" }}>OLLAMA_MAX_LOADED_MODELS</code>
              </label>
              <select className="select-input" style={{ width: "100%" }} value={maxModels}
                onChange={(e) => setMaxModels(Number(e.target.value))}>
                <option value={1}>1 — swap on demand  (~1.9 GB peak)</option>
                <option value={2}>2 — two models ready (~3.9 GB peak)</option>
                <option value={3}>3 — three models     (~5.8 GB peak)</option>
                <option value={4}>4 — keep all loaded  (~7.8 GB peak)</option>
              </select>
              <p className="settings-hint">
                Lower = less RAM. Higher = fewer model-swap delays (3–8 s each).
                {ramGb >= 16 ? " For Full level, 2 is optimal." : " For Minimal/Standard, 1 is sufficient."}
                {" "}Needs an Ollama restart to take effect.
              </p>
            </div>

            <div style={{ minWidth: 150 }}>
              <label className="field-label">Request Timeout</label>
              <div className="pull-row">
                <input className="text-input" type="number" min={1000} max={300000} step={1000}
                  value={timeoutMs} onChange={(e) => setTimeoutMs(Number(e.target.value))} style={{ width: 110 }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>ms</span>
              </div>
              <p className="settings-hint">Per-LLM-request timeout. Default: 30 000 ms.</p>
            </div>
          </div>

          <div>
            <button className={ollamaApplied ? "btn-secondary" : "btn-primary"}
              style={{ fontSize: 12, padding: "7px 18px" }} onClick={applyOllamaSettings}>
              {ollamaApplied ? <><CheckCircle size={12} /> Applied</> : <><Power size={12} /> Apply Settings</>}
            </button>
          </div>
        </div>

        {/* Downloaded models — slim row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {installedModels.length > 0
              ? `${installedModels.length} model${installedModels.length !== 1 ? "s" : ""} downloaded`
              : "No models downloaded yet"}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="icon-btn" onClick={() => refreshModels()} disabled={modelsLoading} title="Refresh">
              <RefreshCw size={12} className={modelsLoading ? "spin" : ""} />
            </button>
            {installedModels.length > 0 && (
              <button className="btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={() => setModelsSidebarOpen(true)}>
                Manage
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ════════════════════════════════════════════════════════════════════
          SECTION 3 — BRAIN BEHAVIOR
          ════════════════════════════════════════════════════════════════════ */}
      <section className="settings-section">
        <h2 className="section-title">Brain Behavior</h2>

        <div className="resource-card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Info size={13} style={{ color: "var(--accent)", flexShrink: 0, marginTop: 1 }} />
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.65, margin: 0 }}>
              These settings affect every agent connected to this project. The phase reshapes what context sections agents receive on every <code>get_context</code> call — which rules are enforced, which quality checklists are injected, and what guidance text agents see. Saved to <code>brain.json</code>; active on next brain session.
            </p>
          </div>
        </div>

        {/* SDLC Phase */}
        <div style={{ marginBottom: 24 }}>
          <label className="field-label" style={{ marginBottom: 8 }}>SDLC Phase</label>
          <div className="sdlc-selector" style={{ marginBottom: 10 }}>
            {SDLC_PHASES.map((p) => (
              <button key={p.key} className={`sdlc-btn ${brainConfig.DefaultPhase === p.key ? "sdlc-btn-active" : ""}`}
                onClick={() => setPhase(p.key)}>{p.label}</button>
            ))}
          </div>
          <p className="settings-hint">{SDLC_PHASES.find((p) => p.key === brainConfig.DefaultPhase)?.desc}</p>
        </div>

        {/* Quality Mode */}
        <div>
          <label className="field-label" style={{ marginBottom: 8 }}>Quality Mode</label>
          <div className="sdlc-selector" style={{ marginBottom: 10 }}>
            {QUALITY_MODES.map((q) => (
              <button key={q.key} className={`sdlc-btn ${brainConfig.DefaultMode === q.key ? "sdlc-btn-active" : ""}`}
                onClick={() => setMode(q.key)}>{q.label}</button>
            ))}
          </div>
          <p className="settings-hint">{QUALITY_MODES.find((q) => q.key === brainConfig.DefaultMode)?.desc}</p>
        </div>
      </section>

      {/* ── Models sidebar (view all) ────────────────────────────────────── */}
      {modelsSidebarOpen && (
        <ModelsSidebar
          models={installedModels}
          runningModels={runningModels}
          onChat={openChat}
          onDelete={requestDelete}
          onClose={() => setModelsSidebarOpen(false)}
        />
      )}

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {chatOpen && (
        <>
          <div className="chat-backdrop" onClick={closeChat} />
          <div className="chat-panel">
            <div className="chat-panel-header">
              <div className="chat-panel-title">
                <div className="chat-panel-tier">Test Model</div>
                <div className="chat-panel-model">{chatModel}</div>
              </div>
              <button className="icon-btn" onClick={closeChat}><X size={15} /></button>
            </div>
            <div className="chat-messages" ref={chatScrollRef}>
              {chatMessages.length === 0 && (
                <div className="empty-state" style={{ marginTop: 24 }}>Send a message to test this model.</div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} className={`chat-bubble ${msg.role === "user" ? "chat-bubble-user" : "chat-bubble-assistant"}`}
                  style={{ whiteSpace: "pre-wrap" }}>
                  {msg.content}
                  {chatStreaming && i === chatMessages.length - 1 && msg.role === "assistant" && (
                    <span style={{ opacity: 0.5 }}> ▍</span>
                  )}
                </div>
              ))}
            </div>
            <div className="chat-presets">
              {["Introduce yourself", "What is your role?", "Review: function add(a,b){return a+b}"].map((p) => (
                <button key={p} className="btn-ghost" style={{ fontSize: 11, padding: "4px 8px" }}
                  onClick={() => sendChat(p)} disabled={chatStreaming}>{p}</button>
              ))}
            </div>
            <div className="chat-input-row">
              <input className="text-input" placeholder="Message…" value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendChat()}
                disabled={chatStreaming} />
              <button className="btn-primary" style={{ padding: "8px 12px", flexShrink: 0 }}
                onClick={() => sendChat()} disabled={!chatInput.trim() || chatStreaming}>
                {chatStreaming ? <RefreshCw size={13} className="spin" /> : <Send size={13} />}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Confirm modal ────────────────────────────────────────────────── */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}
