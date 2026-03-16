import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import App from "../App";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const mockInvoke = invoke as ReturnType<typeof vi.fn>;
const mockListen = listen as ReturnType<typeof vi.fn>;

// App uses HashRouter internally — no external MemoryRouter needed.

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

/**
 * Full invoke mock suitable for when AppShell is shown.
 * Covers all sub-page hooks that call invoke on mount.
 */
function setupFullAppInvokes(onboardingDone: boolean) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_onboarding_done") return Promise.resolve(onboardingDone);
    if (cmd === "get_service_status") return Promise.resolve([]);
    if (cmd === "get_sidecars") return Promise.resolve([]);
    if (cmd === "get_synapses_data_dir") return Promise.resolve("~/.synapses");
    if (cmd === "run_synapses_cmd") return Promise.resolve("[]");
    if (cmd === "get_data_sizes") return Promise.resolve({});
    if (cmd === "read_app_settings") return Promise.resolve({});
    if (cmd === "detect_installed_agents") return Promise.resolve([]);
    if (cmd === "check_ollama") return Promise.resolve(false);
    return Promise.resolve(null);
  });
}

/** Stub fetch so sub-pages that hit the daemon don't cause unhandled rejections. */
function stubFetchOffline() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("fetch not available in test"))
  );
}

describe("App component", () => {
  it("shows nothing (null) while invoke is still pending", () => {
    mockInvoke.mockReturnValue(new Promise(() => {}));
    stubFetchOffline();
    const { container } = render(<App />);
    expect(container.firstChild).toBeNull();
  });

  it("shows Onboarding when onboarding is not done (invoke returns false)", async () => {
    setupFullAppInvokes(false);
    stubFetchOffline();
    render(<App />);
    // Give React time to resolve the invoke
    await waitFor(() =>
      expect(screen.queryByText("Dashboard")).toBeNull()
    );
    // When Onboarding is shown the Sidebar nav is not present
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("shows AppShell (Dashboard route) when onboarding is done", async () => {
    setupFullAppInvokes(true);
    stubFetchOffline();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0)
    );
  });

  it("falls back to Onboarding when invoke throws", async () => {
    // First call (get_onboarding_done) rejects; subsequent calls for Onboarding sub-invokes succeed.
    let called = false;
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "get_onboarding_done") {
        if (!called) {
          called = true;
          return Promise.reject(new Error("tauri error"));
        }
      }
      if (cmd === "detect_installed_agents") return Promise.resolve([]);
      if (cmd === "check_ollama") return Promise.resolve(false);
      return Promise.resolve(null);
    });
    stubFetchOffline();
    render(<App />);
    // After rejection, onboardingDone becomes false → Onboarding shown
    // The Sidebar nav ("Dashboard" link) should NOT appear
    await waitFor(() =>
      expect(screen.queryByRole("navigation")).toBeNull()
    );
  });

  it("ServiceEventListener registers listen for service-offline and service-restarted", async () => {
    setupFullAppInvokes(true);
    stubFetchOffline();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0)
    );
    const listenCalls = mockListen.mock.calls.map((c) => c[0] as string);
    expect(listenCalls).toContain("service-offline");
    expect(listenCalls).toContain("service-restarted");
  });

  it("service-offline event causes 'went offline' toast", async () => {
    const listenCallbacks: Record<string, (e: { payload: string }) => void> = {};
    mockListen.mockImplementation((event: string, cb: (e: { payload: string }) => void) => {
      listenCallbacks[event] = cb;
      return Promise.resolve(() => {});
    });
    setupFullAppInvokes(true);
    stubFetchOffline();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0)
    );
    // Fire the service-offline callback
    await waitFor(() => expect(listenCallbacks["service-offline"]).toBeDefined());
    const { act } = await import("@testing-library/react");
    await act(async () => {
      listenCallbacks["service-offline"]({ payload: "synapses" });
    });
    await waitFor(() =>
      expect(screen.getByText(/went offline/i)).toBeDefined()
    );
  });

  it("service-restarted event causes 'was auto-restarted' toast", async () => {
    const listenCallbacks: Record<string, (e: { payload: string }) => void> = {};
    mockListen.mockImplementation((event: string, cb: (e: { payload: string }) => void) => {
      listenCallbacks[event] = cb;
      return Promise.resolve(() => {});
    });
    setupFullAppInvokes(true);
    stubFetchOffline();
    render(<App />);
    await waitFor(() =>
      expect(screen.queryAllByText("Dashboard").length).toBeGreaterThan(0)
    );
    await waitFor(() => expect(listenCallbacks["service-restarted"]).toBeDefined());
    const { act } = await import("@testing-library/react");
    await act(async () => {
      listenCallbacks["service-restarted"]({ payload: "synapses" });
    });
    await waitFor(() =>
      expect(screen.getByText(/was auto-restarted/i)).toBeDefined()
    );
  });
});
