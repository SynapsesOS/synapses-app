import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Explorer } from "../pages/Explorer";
import { invoke } from "@tauri-apps/api/core";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter>
      <ToastProvider>{children}</ToastProvider>
    </MemoryRouter>
  );
}

const PROJECTS_JSON = JSON.stringify([
  { path: "/proj", name: "myproject", status: "healthy" },
]);

const SEARCH_RESPONSE = {
  entities: [
    { id: "1", name: "MyFunction", type: "function", file: "cmd/main.go", domain: "code" },
  ],
  total: 1,
  query: "MyFunction",
};

function makeSearchFetch(payload = SEARCH_RESPONSE) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(payload),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Renders Explorer, waits for projects to load, then installs fake timers. */
async function renderAndWaitForProjects(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  render(<Explorer />, { wrapper: Wrapper });
  await waitFor(() =>
    expect(screen.getByPlaceholderText(/Function, struct, file/i)).toBeDefined()
  );
  // Projects are loaded — now install fake timers so debounce is controllable
  vi.useFakeTimers();
  return screen.getByPlaceholderText(/Function, struct, file/i);
}

describe("Explorer page", () => {
  it("shows 'Entity Explorer' title", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    vi.stubGlobal("fetch", makeSearchFetch());
    render(<Explorer />, { wrapper: Wrapper });
    expect(screen.getByText("Entity Explorer")).toBeDefined();
  });

  it("shows empty state when no projects are indexed", async () => {
    mockInvoke.mockResolvedValue(JSON.stringify([]));
    vi.stubGlobal("fetch", makeSearchFetch());
    render(<Explorer />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/No projects indexed yet/i)).toBeDefined()
    );
  });

  it("shows project selector when projects are present", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    vi.stubGlobal("fetch", makeSearchFetch());
    render(<Explorer />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText("myproject")).toBeDefined()
    );
    expect(screen.getByText("Project")).toBeDefined();
  });

  it("shows search input when projects are present", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    vi.stubGlobal("fetch", makeSearchFetch());
    render(<Explorer />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(
        screen.getByPlaceholderText(/Function, struct, file/i)
      ).toBeDefined()
    );
  });

  it("shows 'Enter a search term to find entities' initial state", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    vi.stubGlobal("fetch", makeSearchFetch());
    render(<Explorer />, { wrapper: Wrapper });
    await waitFor(() =>
      expect(screen.getByText(/Enter a search term to find entities/i)).toBeDefined()
    );
  });

  it("shows results table when search succeeds", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const mockFetch = makeSearchFetch();
    const input = await renderAndWaitForProjects(mockFetch);
    fireEvent.change(input, { target: { value: "MyFunction" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("MyFunction")).toBeDefined());
  });

  it("shows entity name, type, file, domain columns", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const input = await renderAndWaitForProjects(makeSearchFetch());
    fireEvent.change(input, { target: { value: "MyFunction" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() => expect(screen.getByText("Entity")).toBeDefined());
    expect(screen.getByText("Type")).toBeDefined();
    expect(screen.getByText("File")).toBeDefined();
    expect(screen.getByText("Domain")).toBeDefined();
  });

  it("shows 'No entities found' when search returns empty", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const emptyFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ entities: [], total: 0, query: "xyz" }),
    });
    const input = await renderAndWaitForProjects(emptyFetch);
    fireEvent.change(input, { target: { value: "xyz" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText(/No entities found/i)).toBeDefined()
    );
  });

  it("shows error banner when fetch fails", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const errorFetch = vi.fn().mockRejectedValue(new Error("some error"));
    const input = await renderAndWaitForProjects(errorFetch);
    fireEvent.change(input, { target: { value: "test" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText(/Search failed/i)).toBeDefined()
    );
  });

  it("shows 'Daemon offline' error when fetch fails with network error", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const networkFetch = vi.fn().mockRejectedValue(new Error("Failed to fetch"));
    const input = await renderAndWaitForProjects(networkFetch);
    fireEvent.change(input, { target: { value: "test" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText("Daemon offline")).toBeDefined()
    );
  });

  it("shows 'Project not found' error on HTTP 404", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const notFoundFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const input = await renderAndWaitForProjects(notFoundFetch);
    fireEvent.change(input, { target: { value: "test" } });
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() =>
      expect(screen.getByText(/Project not found/i)).toBeDefined()
    );
  });

  it("debounce: typing triggers search after 300ms, not immediately", async () => {
    mockInvoke.mockResolvedValue(PROJECTS_JSON);
    const mockFetch = makeSearchFetch();
    const input = await renderAndWaitForProjects(mockFetch);
    // After projects loaded, mockFetch has 0 calls (project loading uses invoke)
    const callsBefore = mockFetch.mock.calls.length;
    fireEvent.change(input, { target: { value: "test" } });
    // Should not have fired yet
    expect(mockFetch.mock.calls.length).toBe(callsBefore);
    act(() => { vi.advanceTimersByTime(300); });
    vi.useRealTimers();
    await waitFor(() =>
      expect(mockFetch.mock.calls.length).toBeGreaterThan(callsBefore)
    );
  });
});
