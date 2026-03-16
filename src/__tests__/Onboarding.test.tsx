import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { Onboarding } from "../pages/Onboarding";

// ---------------------------------------------------------------------------
// Mocks — use vi.hoisted so the spy reference is available inside vi.mock factories
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
const { mockOpen } = vi.hoisted(() => ({ mockOpen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------
function setupDefaultInvokeMocks() {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "detect_installed_agents") return Promise.resolve([]);
    if (cmd === "check_ollama") return Promise.resolve({ running: false });
    if (cmd === "run_synapses_cmd") return Promise.resolve("Indexed successfully.");
    if (cmd === "set_onboarding_done") return Promise.resolve(undefined);
    if (cmd === "check_mcp_config") return Promise.resolve(false);
    if (cmd === "write_mcp_config") return Promise.resolve("");
    return Promise.resolve(undefined);
  });
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderOnboarding(onComplete = vi.fn()) {
  return render(<Onboarding onComplete={onComplete} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultInvokeMocks();
  });

  // -------------------------------------------------------------------------
  // Step 0 — Welcome
  // -------------------------------------------------------------------------
  describe("Step 0 — Welcome", () => {
    it("renders 'Welcome to Synapses' title on initial mount", () => {
      renderOnboarding();
      expect(screen.getByText("Welcome to Synapses")).toBeDefined();
    });

    it("shows 'Get started' button on step 0", () => {
      renderOnboarding();
      expect(screen.getByText(/Get started/i)).toBeDefined();
    });

    it("clicking 'Get started' advances to step 1", async () => {
      renderOnboarding();
      await act(async () => {
        fireEvent.click(screen.getByText(/Get started/i));
      });
      expect(screen.getByText("Index your first project")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Step 1 — Index project
  // -------------------------------------------------------------------------
  describe("Step 1 — Index project", () => {
    async function goToStep1() {
      renderOnboarding();
      await act(async () => {
        fireEvent.click(screen.getByText(/Get started/i));
      });
    }

    it("shows 'Index your first project' title", async () => {
      await goToStep1();
      expect(screen.getByText("Index your first project")).toBeDefined();
    });

    it("has 'Choose project directory' button", async () => {
      await goToStep1();
      expect(screen.getByText(/Choose project directory/i)).toBeDefined();
    });

    it("shows 'Skip for now' when no project has been indexed", async () => {
      await goToStep1();
      expect(screen.getByText(/Skip for now/i)).toBeDefined();
    });

    it("'Skip for now' navigates to step 2", async () => {
      await goToStep1();
      await act(async () => {
        fireEvent.click(screen.getByText(/Skip for now/i));
      });
      expect(screen.getByText("AI Intelligence (optional)")).toBeDefined();
    });

    it("'Back' button returns to step 0", async () => {
      await goToStep1();
      await act(async () => {
        fireEvent.click(screen.getByText("Back"));
      });
      expect(screen.getByText("Welcome to Synapses")).toBeDefined();
    });

    it("shows indexed path after successful indexing", async () => {
      mockOpen.mockResolvedValue("/home/user/myproject");

      await goToStep1();

      await act(async () => {
        fireEvent.click(screen.getByText(/Choose project directory/i));
      });

      await waitFor(() => {
        expect(screen.getByText("/home/user/myproject")).toBeDefined();
      });
    });

    it("shows 'Continue' (not 'Skip for now') after project is indexed", async () => {
      mockOpen.mockResolvedValue("/home/user/myproject");

      await goToStep1();

      await act(async () => {
        fireEvent.click(screen.getByText(/Choose project directory/i));
      });

      await waitFor(() => {
        // The forward nav button should now say "Continue"
        const forwardBtn = screen.getByText(/Continue/i);
        expect(forwardBtn).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Step 2 — Ollama / AI Brain
  // -------------------------------------------------------------------------
  describe("Step 2 — AI Intelligence", () => {
    async function goToStep2() {
      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
    }

    it("shows 'AI Intelligence (optional)' title", async () => {
      await goToStep2();
      expect(screen.getByText("AI Intelligence (optional)")).toBeDefined();
    });

    it("shows 'Detecting Ollama…' initially while check_ollama is pending", async () => {
      let resolveOllama!: (v: unknown) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve([]);
        if (cmd === "check_ollama") return new Promise((res) => { resolveOllama = res; });
        return Promise.resolve(undefined);
      });

      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => {
        const skipBtns = screen.getAllByText(/Skip for now/i);
        fireEvent.click(skipBtns[0]);
      });

      expect(screen.getByText("Detecting Ollama…")).toBeDefined();

      // Resolve to clean up
      act(() => { resolveOllama({ running: false }); });
    });

    it("shows 'Ollama not found' when check_ollama returns { running: false }", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve([]);
        if (cmd === "check_ollama") return Promise.resolve({ running: false });
        return Promise.resolve(undefined);
      });

      await goToStep2();

      await waitFor(() => {
        expect(screen.getByText(/Ollama not found/i)).toBeDefined();
      });
    });

    it("shows 'Ollama 0.3.0 detected' when check_ollama returns running with version", async () => {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve([]);
        if (cmd === "check_ollama")
          return Promise.resolve({ running: true, version: "0.3.0", models: [] });
        return Promise.resolve(undefined);
      });

      await goToStep2();

      await waitFor(() => {
        expect(screen.getByText(/Ollama 0.3.0 detected/i)).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Step 3 — Connect agent
  // -------------------------------------------------------------------------
  describe("Step 3 — Connect AI agent", () => {
    async function goToStep3() {
      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
    }

    it("shows 'Connect your AI agent' title", async () => {
      await goToStep3();
      expect(screen.getByText("Connect your AI agent")).toBeDefined();
    });

    it("shows warning callout when no project was indexed", async () => {
      await goToStep3();
      expect(screen.getByText(/No project indexed yet/i)).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Step 4 — Privacy
  // Step 3's forward button is disabled={!indexedPath}, so we must index a
  // project first to make the Continue/Skip button enabled on step 3.
  // -------------------------------------------------------------------------
  describe("Step 4 — Privacy", () => {
    async function goToStep4() {
      // Set up so indexing succeeds and dialog returns a path
      mockOpen.mockResolvedValue("/home/user/myproject");

      renderOnboarding();
      // step 0 → 1
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      // step 1: pick a project so indexedPath is set
      await act(async () => { fireEvent.click(screen.getByText(/Choose project directory/i)); });
      await waitFor(() => { expect(screen.getByText("/home/user/myproject")).toBeDefined(); });
      // step 1 → 2
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
      // step 2 → 3
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      // step 3 → 4: indexedPath is set, so Continue button is enabled
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
    }

    it("shows 'Your data stays local' title", async () => {
      await goToStep4();
      expect(screen.getByText("Your data stays local")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // Step 5 — Done
  // -------------------------------------------------------------------------
  describe("Step 5 — Done", () => {
    async function goToStep5() {
      mockOpen.mockResolvedValue("/home/user/myproject");

      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Choose project directory/i)); });
      await waitFor(() => { expect(screen.getByText("/home/user/myproject")).toBeDefined(); });
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      // step 4 → 5
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
    }

    it("shows 'You're all set!' title", async () => {
      await goToStep5();
      expect(screen.getByText(/You're all set!/i)).toBeDefined();
    });

    it("shows 'Open Dashboard' button", async () => {
      await goToStep5();
      expect(screen.getByText(/Open Dashboard/i)).toBeDefined();
    });

    it("'Open Dashboard' calls invoke('set_onboarding_done') and onComplete", async () => {
      mockOpen.mockResolvedValue("/home/user/myproject");
      const onComplete = vi.fn();
      render(<Onboarding onComplete={onComplete} />);

      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Choose project directory/i)); });
      await waitFor(() => { expect(screen.getByText("/home/user/myproject")).toBeDefined(); });
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });

      await act(async () => {
        fireEvent.click(screen.getByText(/Open Dashboard/i));
      });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("set_onboarding_done");
        expect(onComplete).toHaveBeenCalledTimes(1);
      });
    });
  });

  // -------------------------------------------------------------------------
  // Step 2 — Pull progress states
  // -------------------------------------------------------------------------
  describe("Step 2 — pull progress UI", () => {
    async function goToStep2WithOllamaOk() {
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve([]);
        if (cmd === "check_ollama") return Promise.resolve({ running: true, version: "0.3.0", models: [] });
        if (cmd === "pull_model") return new Promise(() => {}); // never resolves
        return Promise.resolve(undefined);
      });
      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
      await waitFor(() => expect(screen.getByText(/Ollama 0.3.0 detected/i)).toBeDefined());
    }

    it("shows percentage when pull progress has total > 0", async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const mockListenFn = listen as ReturnType<typeof vi.fn>;
      const listenCallbacks: Record<string, (e: { payload: unknown }) => void> = {};
      mockListenFn.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
        listenCallbacks[event] = cb;
        return Promise.resolve(() => {});
      });

      await goToStep2WithOllamaOk();

      // Click the Pull button for synapses/sentry
      const pullBtn = screen.getAllByText("Pull")[0];
      await act(async () => { fireEvent.click(pullBtn); });

      // Fire the pull progress event with total > 0
      await act(async () => {
        listenCallbacks["ollama-pull-progress"]?.({
          payload: { model: "synapses/sentry", status: "downloading", completed: 500, total: 1000 },
        });
      });

      await waitFor(() =>
        expect(screen.getByText("50%")).toBeDefined()
      );
    });

    it("shows status text when pull progress has total = 0", async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const mockListenFn = listen as ReturnType<typeof vi.fn>;
      const listenCallbacks: Record<string, (e: { payload: unknown }) => void> = {};
      mockListenFn.mockImplementation((event: string, cb: (e: { payload: unknown }) => void) => {
        listenCallbacks[event] = cb;
        return Promise.resolve(() => {});
      });

      await goToStep2WithOllamaOk();

      const pullBtn = screen.getAllByText("Pull")[0];
      await act(async () => { fireEvent.click(pullBtn); });

      await act(async () => {
        listenCallbacks["ollama-pull-progress"]?.({
          payload: { model: "synapses/sentry", status: "verifying sha256", completed: 0, total: 0 },
        });
      });

      await waitFor(() =>
        expect(screen.getByText("verifying sha256")).toBeDefined()
      );
    });
  });

  // -------------------------------------------------------------------------
  // Step 3 — detected agents branch
  // -------------------------------------------------------------------------
  describe("Step 3 — detected agents", () => {
    async function goToStep3WithProject() {
      const { open: mockOpenFn } = await import("@tauri-apps/plugin-dialog");
      (mockOpenFn as ReturnType<typeof vi.fn>).mockResolvedValue("/home/user/myproject");
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve(["claude", "cursor"]);
        if (cmd === "check_ollama") return Promise.resolve({ running: false });
        if (cmd === "run_synapses_cmd") return Promise.resolve("Indexed successfully.");
        if (cmd === "set_onboarding_done") return Promise.resolve(undefined);
        if (cmd === "check_mcp_config") return Promise.resolve(false);
        if (cmd === "write_mcp_config") return Promise.resolve("");
        return Promise.resolve(undefined);
      });

      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Choose project directory/i)); });
      await waitFor(() => expect(screen.getByText("/home/user/myproject")).toBeDefined());
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });
    }

    it("shows detected agent count message when agents are detected", async () => {
      await goToStep3WithProject();
      await waitFor(() =>
        expect(screen.getByText(/2 agents detected on your machine/i)).toBeDefined()
      );
    });

    it("shows spinning state while write_mcp_config is in flight", async () => {
      let resolveMcp!: (v: string) => void;
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "detect_installed_agents") return Promise.resolve(["claude", "cursor"]);
        if (cmd === "check_ollama") return Promise.resolve({ running: false });
        if (cmd === "run_synapses_cmd") return Promise.resolve("Indexed successfully.");
        if (cmd === "set_onboarding_done") return Promise.resolve(undefined);
        if (cmd === "check_mcp_config") return Promise.resolve(false);
        if (cmd === "write_mcp_config") return new Promise<string>((res) => { resolveMcp = res; });
        return Promise.resolve(undefined);
      });

      const { open: mockOpenFn } = await import("@tauri-apps/plugin-dialog");
      (mockOpenFn as ReturnType<typeof vi.fn>).mockResolvedValue("/home/user/myproject");

      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Choose project directory/i)); });
      await waitFor(() => expect(screen.getByText("/home/user/myproject")).toBeDefined());
      await act(async () => { fireEvent.click(screen.getByText(/Continue/i)); });
      await act(async () => { fireEvent.click(screen.getByText(/Skip for now/i)); });

      // Click Claude Code editor card to start writing
      await waitFor(() => expect(screen.getByText("Claude Code")).toBeDefined());
      await act(async () => { fireEvent.click(screen.getByText("Claude Code")); });

      // The writing state should show spin class
      await waitFor(() => {
        const spinning = document.querySelector(".editor-connect-card .spin");
        expect(spinning).not.toBeNull();
      });

      // Resolve to clean up
      act(() => { resolveMcp(""); });
    });
  });

  // -------------------------------------------------------------------------
  // Progress dots
  // -------------------------------------------------------------------------
  describe("Progress dots", () => {
    it("renders 6 progress dots", () => {
      renderOnboarding();
      const dots = document.querySelectorAll(".progress-dot");
      expect(dots.length).toBe(6);
    });

    it("first dot has 'active' class on step 0", () => {
      renderOnboarding();
      const dots = document.querySelectorAll(".progress-dot");
      expect(dots[0].classList.contains("active")).toBe(true);
    });

    it("second dot has 'active' class on step 1", async () => {
      renderOnboarding();
      await act(async () => { fireEvent.click(screen.getByText(/Get started/i)); });
      const dots = document.querySelectorAll(".progress-dot");
      expect(dots[1].classList.contains("active")).toBe(true);
    });
  });
});
