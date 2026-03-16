import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Agents } from "../pages/Agents";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  );
}

const AGENTS_PAYLOAD = {
  agents: [
    {
      agent_id: "claude-main",
      sessions: 5,
      tool_calls: 120,
      tokens_saved: 60000,
      last_seen: "2026-03-15",
    },
  ],
  tools: [{ name: "get_context", calls: 80, avg_ms: 150, error_rate: 0.02 }],
};

function makeSuccessFetch(payload = AGENTS_PAYLOAD) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

function makeFailFetch() {
  return vi.fn().mockRejectedValue(new Error("Failed to fetch"));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Agents page", () => {
  it("shows 'Agents' title", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    // title appears in both online and offline renders
    expect(screen.getAllByText("Agents").length).toBeGreaterThan(0);
  });

  it("shows offline banner when fetch fails", async () => {
    vi.stubGlobal("fetch", makeFailFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Agent data unavailable/i)).toBeDefined()
    );
  });

  it("shows empty state when agents array is empty", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch({ agents: [], tools: [] }));
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No agent sessions recorded/i)).toBeDefined()
    );
  });

  it("shows agents when data is present", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("claude-main")).toBeDefined()
    );
  });

  it("shows sessions, tool calls, and tokens saved badges", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("claude-main")).toBeDefined());
    expect(screen.getByText("5 sessions")).toBeDefined();
    expect(screen.getByText("120 calls")).toBeDefined();
    expect(screen.getByText(/saved/i)).toBeDefined();
  });

  it("clicking agent card expands details", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("claude-main")).toBeDefined());
    // detail grid should not exist yet
    expect(screen.queryByText("Sessions")).toBeNull();
    fireEvent.click(screen.getByText("claude-main").closest("button")!);
    await waitFor(() =>
      expect(screen.getByText("Sessions")).toBeDefined()
    );
  });

  it("clicking expanded agent card collapses details", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("claude-main")).toBeDefined());
    const btn = screen.getByText("claude-main").closest("button")!;
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByText("Sessions")).toBeDefined());
    fireEvent.click(btn);
    await waitFor(() => expect(screen.queryByText("Sessions")).toBeNull());
  });

  it("shows tool usage table when tools are present", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Tool Usage/i)).toBeDefined()
    );
    expect(screen.getByText("get_context")).toBeDefined();
  });

  it("renders 7d and 30d day selector buttons", async () => {
    vi.stubGlobal("fetch", makeSuccessFetch());
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText("7d")).toBeDefined());
    expect(screen.getByText("30d")).toBeDefined();
  });

  it("clicking 30d re-fetches with days=30", async () => {
    const mockFetch = makeSuccessFetch();
    vi.stubGlobal("fetch", mockFetch);
    render(<Agents />, { wrapper: Wrapper });
    // Wait for initial fetch to complete
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const callsBefore = mockFetch.mock.calls.length;
    fireEvent.click(screen.getByText("30d"));
    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore)
    );
    const urls = mockFetch.mock.calls.map((c) => c[0] as string);
    expect(urls.some((url) => url.includes("days=30"))).toBe(true);
  });

  it("refresh button exists and triggers re-fetch", async () => {
    const mockFetch = makeSuccessFetch();
    vi.stubGlobal("fetch", mockFetch);
    render(<Agents />, { wrapper: Wrapper });
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const refreshBtn = screen.getByTitle("Refresh");
    fireEvent.click(refreshBtn);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
  });
});
