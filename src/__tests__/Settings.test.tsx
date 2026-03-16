import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Toasts } from "../components/Toasts";
import { Settings } from "../pages/Settings";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));

// jsdom does not implement navigator.clipboard — provide a minimal stub
Object.defineProperty(navigator, "clipboard", {
  value: { writeText: vi.fn().mockResolvedValue(undefined) },
  writable: true,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface ProjectData {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  scale?: string;
  last_indexed?: string;
  status?: string;
}

const makeProject = (overrides: Partial<ProjectData> = {}): ProjectData => ({
  path: "/home/user/myproject",
  name: "myproject",
  nodes: 100,
  files: 20,
  ...overrides,
});

function setupDefaultMocks(projects: ProjectData[] = [], logLines: string[] = []) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_synapses_data_dir") return Promise.resolve("~/.synapses");
    if (cmd === "run_synapses_cmd") return Promise.resolve(JSON.stringify(projects));
    if (cmd === "detect_installed_agents") return Promise.resolve([]);
    if (cmd === "get_service_status") return Promise.resolve([]);
    if (cmd === "get_log_lines") return Promise.resolve(logLines);
    if (cmd === "check_mcp_config") return Promise.resolve(false);
    return Promise.resolve(undefined);
  });
}

function renderSettings() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Settings />
        <Toasts />
      </ToastProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  // -------------------------------------------------------------------------
  // Page title & section headings
  // -------------------------------------------------------------------------
  it("shows 'Settings' page title", () => {
    renderSettings();
    expect(screen.getByText("Settings")).toBeDefined();
  });

  it("shows 'Connect AI Agents' section title", () => {
    renderSettings();
    expect(screen.getByText("Connect AI Agents")).toBeDefined();
  });

  it("shows 'Data Directory' section title", () => {
    renderSettings();
    expect(screen.getByText("Data Directory")).toBeDefined();
  });

  it("shows 'System Status' section title", () => {
    renderSettings();
    expect(screen.getByText("System Status")).toBeDefined();
  });

  it("shows 'Daemon Logs' section title", () => {
    renderSettings();
    expect(screen.getByText("Daemon Logs")).toBeDefined();
  });

  it("shows 'About Synapses' section title", () => {
    renderSettings();
    expect(screen.getByText("About Synapses")).toBeDefined();
  });

  it("shows 'Version 0.2.0'", () => {
    renderSettings();
    expect(screen.getByText("Version 0.2.0")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Agent integration — empty project state
  // -------------------------------------------------------------------------
  it("shows 'No indexed projects yet' hint when projects list is empty", async () => {
    setupDefaultMocks([]);
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText(/No indexed projects yet/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Agent integration — with projects
  // -------------------------------------------------------------------------
  describe("with indexed projects", () => {
    beforeEach(() => {
      setupDefaultMocks([makeProject()]);
    });

    it("shows project name in the agent matrix", async () => {
      renderSettings();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });
    });

    it("shows all 6 agent chip labels", async () => {
      renderSettings();
      await waitFor(() => {
        // agent-chip buttons are rendered inside .agent-chips
        const chips = document.querySelectorAll(".agent-chip");
        const labels = Array.from(chips).map((c) => c.textContent?.trim());
        expect(labels.some((l) => l?.includes("Claude Code"))).toBe(true);
        expect(labels.some((l) => l?.includes("Cursor"))).toBe(true);
        expect(labels.some((l) => l?.includes("Windsurf"))).toBe(true);
        expect(labels.some((l) => l?.includes("Zed"))).toBe(true);
        expect(labels.some((l) => l?.includes("VS Code"))).toBe(true);
        expect(labels.some((l) => l?.includes("Antigravity"))).toBe(true);
      });
    });
  });

  // -------------------------------------------------------------------------
  // About — supported editors
  // -------------------------------------------------------------------------
  it("shows all 6 supported editor tags in the About section", async () => {
    renderSettings();
    await waitFor(() => {
      const tags = document.querySelectorAll(".agent-tag");
      const labels = Array.from(tags).map((t) => t.textContent);
      expect(labels).toContain("Claude Code");
      expect(labels).toContain("Cursor");
      expect(labels).toContain("Windsurf");
      expect(labels).toContain("Zed");
      expect(labels).toContain("VS Code");
      expect(labels).toContain("Antigravity");
    });
  });

  // -------------------------------------------------------------------------
  // MCP snippet copy button
  // -------------------------------------------------------------------------
  it("shows Copy button(s) on the page", async () => {
    renderSettings();
    await waitFor(() => {
      const copyBtns = screen.getAllByText(/Copy/i);
      expect(copyBtns.length).toBeGreaterThan(0);
    });
  });

  it("Copy button in MCP snippet block calls navigator.clipboard.writeText with snippet JSON", async () => {
    renderSettings();

    await waitFor(() => {
      expect(screen.getAllByText(/Copy/i).length).toBeGreaterThan(0);
    });

    const codeBlocks = document.querySelectorAll(".code-block");
    const snippetBlock = Array.from(codeBlocks).find((b) =>
      b.textContent?.includes("mcpServers")
    );
    expect(snippetBlock).toBeDefined();

    const copyBtn = snippetBlock!.querySelector(".copy-btn") as HTMLButtonElement;
    await act(async () => { fireEvent.click(copyBtn); });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("mcpServers")
    );
  });

  // -------------------------------------------------------------------------
  // Daemon Logs
  // -------------------------------------------------------------------------
  it("'View last 100 lines' button calls invoke('get_log_lines', { n: 100 })", async () => {
    setupDefaultMocks([], ["2026-01-01 INFO started"]);
    renderSettings();

    const btn = await screen.findByText(/View last 100 lines/i);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_log_lines", { n: 100 });
    });
  });

  it("shows log lines in output box after loading", async () => {
    setupDefaultMocks([], ["2026-01-01 INFO started"]);
    renderSettings();

    const btn = await screen.findByText(/View last 100 lines/i);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => {
      expect(screen.getByText("2026-01-01 INFO started")).toBeDefined();
    });
  });

  it("shows '[No logs available]' when get_log_lines returns empty array", async () => {
    setupDefaultMocks([], []);
    renderSettings();

    const btn = await screen.findByText(/View last 100 lines/i);
    await act(async () => { fireEvent.click(btn); });

    await waitFor(() => {
      expect(screen.getByText("[No logs available]")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Data directory
  // -------------------------------------------------------------------------
  it("shows the data directory path returned by get_synapses_data_dir", async () => {
    renderSettings();
    await waitFor(() => {
      // The data dir is rendered in a <pre> inside the Data Directory code-block
      expect(screen.getByText("~/.synapses")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // System status diagnostic cards
  // -------------------------------------------------------------------------
  it("shows 'Daemon' diagnostic card title", () => {
    renderSettings();
    expect(screen.getByText("Daemon")).toBeDefined();
  });

  it("shows 'Indexed Projects' diagnostic card title", async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getByText("Indexed Projects")).toBeDefined();
    });
  });

  it("shows 'MCP Protocol' diagnostic card title", () => {
    renderSettings();
    // "MCP Protocol" appears in both the System Status card and the About section
    const matches = screen.getAllByText("MCP Protocol");
    expect(matches.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // connectAgent success path
  // -------------------------------------------------------------------------
  it("clicking agent chip calls invoke('write_mcp_config') and shows success toast", async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_synapses_data_dir") return Promise.resolve("~/.synapses");
      if (cmd === "run_synapses_cmd") return Promise.resolve(JSON.stringify([{ path: "/proj/myapp", name: "myapp" }]));
      if (cmd === "detect_installed_agents") return Promise.resolve(["claude"]);
      if (cmd === "get_service_status") return Promise.resolve([]);
      if (cmd === "get_log_lines") return Promise.resolve([]);
      if (cmd === "check_mcp_config") return Promise.resolve(false);
      if (cmd === "write_mcp_config") return Promise.resolve("ok");
      return Promise.resolve(undefined);
    });
    renderSettings();

    // Wait for the agent chip to appear
    await waitFor(() => {
      const chips = document.querySelectorAll(".agent-chip");
      expect(chips.length).toBeGreaterThan(0);
    });

    // Click the Claude Code chip
    const chips = Array.from(document.querySelectorAll(".agent-chip"));
    const claudeChip = chips.find((c) => c.textContent?.includes("Claude Code")) as HTMLElement;
    expect(claudeChip).toBeDefined();

    await act(async () => { fireEvent.click(claudeChip); });

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("write_mcp_config", expect.objectContaining({ editor: "claude" }))
    );
    await waitFor(() => {
      const toastMsgs = document.querySelectorAll(".toast-message");
      const found = Array.from(toastMsgs).some((el) =>
        el.textContent?.includes("Claude Code connected")
      );
      expect(found).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // copyText — data directory copy button
  // -------------------------------------------------------------------------
  it("clicking data directory copy button calls clipboard.writeText and shows 'Copied to clipboard' toast", async () => {
    setupDefaultMocks();
    renderSettings();

    await waitFor(() => expect(screen.getByText("~/.synapses")).toBeDefined());

    // Find the Data Directory code-block and its copy button
    const codeBlocks = document.querySelectorAll(".code-block");
    const dirBlock = Array.from(codeBlocks).find((b) => b.textContent?.includes("~/.synapses") && !b.textContent?.includes("mcpServers"));
    expect(dirBlock).toBeDefined();

    const copyBtn = dirBlock!.querySelector(".copy-btn") as HTMLButtonElement;
    await act(async () => { fireEvent.click(copyBtn); });

    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith("~/.synapses")
    );
    await waitFor(() => {
      const toastMsgs = document.querySelectorAll(".toast-message");
      const found = Array.from(toastMsgs).some((el) =>
        el.textContent?.includes("Copied to clipboard")
      );
      expect(found).toBe(true);
    });
  });
});
