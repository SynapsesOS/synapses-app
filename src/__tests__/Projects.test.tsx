import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Projects } from "../pages/Projects";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
const { mockOpen } = vi.hoisted(() => ({ mockOpen: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mockOpen }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
interface ProjectData {
  path: string;
  name: string;
  nodes?: number;
  files?: number;
  edges?: number;
  scale?: string;
  last_indexed?: string;
  status?: string;
}

const makeProject = (overrides: Partial<ProjectData> = {}): ProjectData => ({
  path: "/home/user/myproject",
  name: "myproject",
  nodes: 100,
  files: 20,
  edges: 300,
  scale: "small",
  ...overrides,
});

function renderProjects() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Projects />
      </ToastProvider>
    </MemoryRouter>
  );
}

function setupListMock(projects: ProjectData[]) {
  mockInvoke.mockImplementation((cmd: string, args?: { args?: string[] }) => {
    if (cmd === "run_synapses_cmd") {
      const cmdArgs = args?.args ?? [];
      if (cmdArgs.includes("list")) return Promise.resolve(JSON.stringify(projects));
      if (cmdArgs.includes("index")) return Promise.resolve("Indexed successfully.");
      if (cmdArgs.includes("reset")) return Promise.resolve("");
    }
    return Promise.resolve(undefined);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Projects", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupListMock([]);
  });

  // -------------------------------------------------------------------------
  // Title
  // -------------------------------------------------------------------------
  it("shows 'Projects' page title", () => {
    renderProjects();
    expect(screen.getByText("Projects")).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------
  describe("empty state", () => {
    it("shows 'No projects indexed yet.' when no projects", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("No projects indexed yet.")).toBeDefined();
      });
    });

    it("shows 'Add your first project' button in empty state", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText(/Add your first project/i)).toBeDefined();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Projects list
  // -------------------------------------------------------------------------
  describe("project list with one project", () => {
    beforeEach(() => {
      setupListMock([makeProject()]);
    });

    it("shows project name", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });
    });

    it("shows project path", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("/home/user/myproject")).toBeDefined();
      });
    });

    it("shows scale badge when project has scale", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("small")).toBeDefined();
      });
    });

    it("does not show scale badge when project has no scale", async () => {
      setupListMock([makeProject({ scale: undefined })]);
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });
      expect(screen.queryByText("small")).toBeNull();
    });

    it("clicking expand chevron shows SDLC Phase section", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const expandBtn = document.querySelector(".project-expand-btn") as HTMLButtonElement;
      await act(async () => { fireEvent.click(expandBtn); });

      expect(screen.getByText("SDLC Phase")).toBeDefined();
    });

    it("clicking expand chevron again collapses details", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const expandBtn = document.querySelector(".project-expand-btn") as HTMLButtonElement;
      await act(async () => { fireEvent.click(expandBtn); });
      expect(screen.getByText("SDLC Phase")).toBeDefined();

      await act(async () => { fireEvent.click(expandBtn); });
      expect(screen.queryByText("SDLC Phase")).toBeNull();
    });

    it("shows all 4 SDLC phase buttons when expanded", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const expandBtn = document.querySelector(".project-expand-btn") as HTMLButtonElement;
      await act(async () => { fireEvent.click(expandBtn); });

      expect(screen.getByText("Development")).toBeDefined();
      expect(screen.getByText("Testing")).toBeDefined();
      expect(screen.getByText("Review")).toBeDefined();
      expect(screen.getByText("Production")).toBeDefined();
    });

    it("clicking a SDLC phase button marks it active", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const expandBtn = document.querySelector(".project-expand-btn") as HTMLButtonElement;
      await act(async () => { fireEvent.click(expandBtn); });

      const testingBtn = screen.getByText("Testing");
      await act(async () => { fireEvent.click(testingBtn); });

      expect(testingBtn.classList.contains("sdlc-btn-active")).toBe(true);
    });

    it("re-index button triggers indexing via run_synapses_cmd index", async () => {
      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const reindexBtn = screen.getByTitle("Re-index");
      await act(async () => { fireEvent.click(reindexBtn); });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "run_synapses_cmd",
          expect.objectContaining({ args: expect.arrayContaining(["index"]) })
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Add Project button
  // -------------------------------------------------------------------------
  describe("Add Project", () => {
    it("shows 'Add Project' button in the page header", async () => {
      renderProjects();
      // The header button has this text; getAllByText to handle duplicates
      const btns = screen.getAllByText(/Add Project/i);
      expect(btns.length).toBeGreaterThan(0);
    });

    it("shows 'indexing…' badge while indexing is in progress", async () => {
      let resolveIndex!: (v: string) => void;
      mockInvoke.mockImplementation((cmd: string, args?: { args?: string[] }) => {
        if (cmd === "run_synapses_cmd") {
          const cmdArgs = args?.args ?? [];
          if (cmdArgs.includes("list")) return Promise.resolve(JSON.stringify([makeProject()]));
          if (cmdArgs.includes("index")) return new Promise<string>((res) => { resolveIndex = res; });
        }
        return Promise.resolve(undefined);
      });
      mockOpen.mockResolvedValue("/home/user/myproject");

      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      const addBtn = screen.getAllByText(/Add Project/i)[0];
      await act(async () => { fireEvent.click(addBtn); });

      await waitFor(() => {
        expect(screen.getByText(/indexing…/i)).toBeDefined();
      });

      // Clean up the hanging promise
      act(() => { resolveIndex("done"); });
    });

    it("calls open() then invokes run_synapses_cmd index with selected path", async () => {
      mockOpen.mockResolvedValue("/home/user/newproject");
      mockInvoke.mockImplementation((cmd: string, args?: { args?: string[] }) => {
        if (cmd === "run_synapses_cmd") {
          const cmdArgs = args?.args ?? [];
          if (cmdArgs.includes("list")) return Promise.resolve(JSON.stringify([]));
          if (cmdArgs.includes("index")) return Promise.resolve("Indexed successfully.");
        }
        return Promise.resolve(undefined);
      });

      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("No projects indexed yet.")).toBeDefined();
      });

      await act(async () => {
        fireEvent.click(screen.getByText(/Add your first project/i));
      });

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith(
          expect.objectContaining({ directory: true })
        );
        expect(mockInvoke).toHaveBeenCalledWith(
          "run_synapses_cmd",
          expect.objectContaining({
            args: expect.arrayContaining(["index", "--path", "/home/user/newproject"]),
          })
        );
      });
    });
  });

  // -------------------------------------------------------------------------
  // Remove project
  // -------------------------------------------------------------------------
  describe("Remove project", () => {
    beforeEach(() => {
      setupListMock([makeProject()]);
    });

    it("calls run_synapses_cmd reset when remove is confirmed", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(true);

      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      await act(async () => { fireEvent.click(screen.getByTitle("Remove")); });

      await waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith(
          "run_synapses_cmd",
          expect.objectContaining({ args: expect.arrayContaining(["reset"]) })
        );
      });
    });

    it("does NOT call run_synapses_cmd reset when remove is cancelled", async () => {
      vi.spyOn(window, "confirm").mockReturnValue(false);

      renderProjects();
      await waitFor(() => {
        expect(screen.getByText("myproject")).toBeDefined();
      });

      await act(async () => { fireEvent.click(screen.getByTitle("Remove")); });

      expect(mockInvoke).not.toHaveBeenCalledWith(
        "run_synapses_cmd",
        expect.objectContaining({ args: expect.arrayContaining(["reset"]) })
      );
    });
  });
});
