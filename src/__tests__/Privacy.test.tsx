import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Privacy } from "../pages/Privacy";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  );
}

function setupInvokeMocks({
  dataSizes = { synapses: 1024 * 1024 },
  appSettings = { log_tool_calls: true },
  projectsJson = "[]",
}: {
  dataSizes?: Record<string, number>;
  appSettings?: Record<string, unknown>;
  projectsJson?: string;
} = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_data_sizes") return Promise.resolve(dataSizes);
    if (cmd === "read_app_settings") return Promise.resolve(appSettings);
    if (cmd === "run_synapses_cmd") return Promise.resolve(projectsJson);
    if (cmd === "write_app_settings") return Promise.resolve(undefined);
    if (cmd === "wipe_all_data") return Promise.resolve(undefined);
    if (cmd === "clear_agent_memory") return Promise.resolve(undefined);
    if (cmd === "clear_activity_logs") return Promise.resolve(undefined);
    if (cmd === "clear_web_cache") return Promise.resolve(undefined);
    return Promise.resolve(undefined);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Privacy page", () => {
  it("shows 'Privacy & Data' title", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    expect(screen.getByText("Privacy & Data")).toBeDefined();
  });

  it("shows privacy pillars", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("100% Local")).toBeDefined());
    expect(screen.getByText("No Telemetry")).toBeDefined();
    expect(screen.getByText("Precise AI Context")).toBeDefined();
    expect(screen.getByText("You're in Control")).toBeDefined();
  });

  it("shows 'What We Store' section", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("What We Store")).toBeDefined()
    );
  });

  it("shows all 4 data category card titles", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Code Snapshots")).toBeDefined());
    expect(screen.getByText("Agent Memory")).toBeDefined();
    expect(screen.getByText("Activity Log")).toBeDefined();
    expect(screen.getByText("Web Docs Cache")).toBeDefined();
  });

  it("clicking a category card expands it", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Code Snapshots")).toBeDefined());
    // Detail text should not be visible yet
    expect(screen.queryByText(/Function\/class names/i)).toBeNull();
    fireEvent.click(screen.getByText("Code Snapshots"));
    await waitFor(() =>
      expect(screen.getByText(/Function\/class names/i)).toBeDefined()
    );
  });

  it("clicking expanded category card collapses it", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Code Snapshots")).toBeDefined());
    fireEvent.click(screen.getByText("Code Snapshots"));
    await waitFor(() =>
      expect(screen.getByText(/Function\/class names/i)).toBeDefined()
    );
    fireEvent.click(screen.getByText("Code Snapshots"));
    await waitFor(() =>
      expect(screen.queryByText(/Function\/class names/i)).toBeNull()
    );
  });

  it("shows danger zone section", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByText(/Danger Zone/i)
      ).toBeDefined()
    );
  });

  it("shows 'Wipe Everything' button", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => {
      const btns = screen.getAllByText("Wipe Everything");
      expect(btns.length).toBeGreaterThan(0);
    });
  });

  /** Helper: find the Wipe Everything <button> (not the title div). */
  function getWipeButton() {
    return screen.getAllByText("Wipe Everything").find(
      (el) => el.tagName === "BUTTON"
    ) as HTMLElement;
  }

  it("clicking 'Wipe Everything' shows confirm modal", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(getWipeButton()).toBeDefined());
    fireEvent.click(getWipeButton());
    await waitFor(() =>
      expect(screen.getByText("Wipe all data?")).toBeDefined()
    );
  });

  it("clicking Cancel in confirm modal closes it", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(getWipeButton()).toBeDefined());
    fireEvent.click(getWipeButton());
    await waitFor(() =>
      expect(screen.getByText("Wipe all data?")).toBeDefined()
    );
    fireEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(screen.queryByText("Wipe all data?")).toBeNull()
    );
  });

  it("clicking confirm calls invoke('wipe_all_data')", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(getWipeButton()).toBeDefined());
    fireEvent.click(getWipeButton());
    await waitFor(() =>
      expect(screen.getByText("Yes, delete permanently")).toBeDefined()
    );
    fireEvent.click(screen.getByText("Yes, delete permanently"));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("wipe_all_data")
    );
  });

  it("shows activity log toggle switch", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { hidden: true })
      ).toBeDefined()
    );
  });

  it("toggle switch fires invoke('write_app_settings')", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("switch", { hidden: true })).toBeDefined()
    );
    const toggle = screen.getByRole("switch", { hidden: true });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        "write_app_settings",
        expect.objectContaining({ settings: expect.objectContaining({ log_tool_calls: false }) })
      )
    );
  });

  it("shows db size and project count in header when data is loaded", async () => {
    setupInvokeMocks({
      dataSizes: { synapses: 1024 * 1024 },
      projectsJson: JSON.stringify([{ path: "/p1", name: "proj1" }]),
    });
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/1\.0 MB/)).toBeDefined()
    );
    expect(screen.getByText(/1 project/)).toBeDefined();
  });

  it("shows project selector in delete project section", async () => {
    setupInvokeMocks({
      projectsJson: JSON.stringify([{ path: "/p1", name: "myproj" }]),
    });
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("myproj")).toBeDefined()
    );
    expect(screen.getByText("Select project…")).toBeDefined();
  });

  it("clicking 'Open in Finder' in expanded Code Snapshots calls invoke('open_data_dir')", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Code Snapshots")).toBeDefined());
    // Expand the Code Snapshots card
    fireEvent.click(screen.getByText("Code Snapshots"));
    await waitFor(() =>
      expect(screen.getByText(/Open in Finder/i)).toBeDefined()
    );
    fireEvent.click(screen.getByText(/Open in Finder/i));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("open_data_dir")
    );
  });

  it("clicking 'Clear cache' in expanded Web Docs Cache calls invoke('clear_web_cache')", async () => {
    setupInvokeMocks();
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("Web Docs Cache")).toBeDefined());
    // Expand the Web Docs Cache card
    fireEvent.click(screen.getByText("Web Docs Cache"));
    await waitFor(() => expect(screen.getByText(/Clear cache/i)).toBeDefined());
    fireEvent.click(screen.getByText(/Clear cache/i));
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith("clear_web_cache")
    );
  });

  it("clicking activity log toggle calls invoke('write_app_settings') and shows 'Saved' indicator", async () => {
    setupInvokeMocks({ appSettings: { log_tool_calls: true } });
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByRole("switch", { hidden: true })).toBeDefined()
    );
    const toggle = screen.getByRole("switch", { hidden: true });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        "write_app_settings",
        expect.objectContaining({ settings: expect.objectContaining({ log_tool_calls: false }) })
      )
    );
    // "Saved" indicator should appear
    await waitFor(() =>
      expect(screen.getByText("Saved")).toBeDefined()
    );
  });

  it("Delete button is disabled when no project is selected", async () => {
    setupInvokeMocks({
      projectsJson: JSON.stringify([{ path: "/p1", name: "myproj" }]),
    });
    render(<Privacy />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Select project…")).toBeDefined()
    );
    // Find the Delete button in the danger actions — it has class btn-danger btn-sm
    const deleteButtons = screen.getAllByRole("button");
    const deleteBtn = deleteButtons.find(
      (b) => b.textContent?.includes("Delete") && !b.textContent?.includes("Deleting")
        && b.className?.includes("btn-danger")
    );
    expect(deleteBtn).toBeDefined();
    expect((deleteBtn as HTMLButtonElement).disabled).toBe(true);
  });
});
