import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Memory } from "../pages/Memory";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  );
}

const PULSE_SUMMARY = {
  summary: {
    sessions: 12,
    total_tool_calls: 300,
    tokens_saved: 75000,
    tasks_completed: 8,
  },
};

afterEach(() => {
  vi.restoreAllMocks();
});

function setupOnlineEnv() {
  mockInvoke.mockResolvedValue("~/.synapses");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(PULSE_SUMMARY),
    })
  );
}

function setupOfflineEnv() {
  mockInvoke.mockResolvedValue("~/.synapses");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Failed to fetch"))
  );
}

describe("Memory page", () => {
  it("shows 'Memory' title", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    expect(screen.getByText("Memory")).toBeDefined();
  });

  it("shows 'Session Memory' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Session Memory")).toBeDefined()
    );
  });

  it("shows 'AI Enrichments' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("AI Enrichments")).toBeDefined()
    );
  });

  it("shows 'Web Cache' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Web Cache")).toBeDefined()
    );
  });

  it("shows 'Code Graph' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Code Graph")).toBeDefined()
    );
  });

  it("shows 'Agent Task Memory' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Agent Task Memory")).toBeDefined()
    );
  });

  it("shows 'Annotations & Rules' card", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Annotations & Rules")).toBeDefined()
    );
  });

  it("shows offline placeholder when pulse fetch fails", async () => {
    setupOfflineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Daemon offline/i)).toBeDefined()
    );
  });

  it("shows sessions stat when pulse is online", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Sessions (30d)")).toBeDefined()
    );
    expect(screen.getByText("12")).toBeDefined();
  });

  it("shows Memory Architecture section", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Memory Architecture")).toBeDefined()
    );
  });

  it("shows 3 tier labels: Episodic, Semantic, Behavioral", async () => {
    setupOnlineEnv();
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("Memory Architecture")).toBeDefined()
    );
    expect(screen.getAllByText("Episodic").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Semantic").length).toBeGreaterThan(0);
    expect(screen.getByText("Behavioral")).toBeDefined();
  });

  it("refresh button exists and triggers re-fetch", async () => {
    setupOnlineEnv();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(PULSE_SUMMARY),
    });
    vi.stubGlobal("fetch", mockFetch);
    render(<Memory />, { wrapper: Wrapper });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const refreshBtn = screen.getByTitle("Refresh");
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
