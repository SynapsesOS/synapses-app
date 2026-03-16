import { vi, describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import { Dashboard } from "../pages/Dashboard";
import type { SidecarInfo } from "../types";

// ---------------------------------------------------------------------------
// Mocks
// vi.mock is hoisted — use vi.hoisted() to share the spy reference
// ---------------------------------------------------------------------------
const { mockInvoke, mockListen } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockListen: vi.fn().mockImplementation(() => Promise.resolve(() => {})),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mockListen }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const makeService = (overrides: Partial<SidecarInfo> = {}): SidecarInfo => ({
  name: "synapses",
  port: 11435,
  status: "healthy",
  consecutive_failures: 0,
  restarts_total: 0,
  ...overrides,
});

function renderDashboard() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockResolvedValue([]);
  });

  it("renders 'Dashboard' title", () => {
    renderDashboard();
    expect(screen.getByText("Dashboard")).toBeDefined();
  });

  it("shows 'Checking…' subtitle when invoke returns empty array", async () => {
    mockInvoke.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Checking…")).toBeDefined();
    });
  });

  it("shows '1/1 services healthy' subtitle when one healthy service is returned", async () => {
    mockInvoke.mockResolvedValue([makeService({ status: "healthy" })]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("1/1 services healthy")).toBeDefined();
    });
  });

  it("shows '0/2 services healthy' when two services and none healthy", async () => {
    mockInvoke.mockResolvedValue([
      makeService({ name: "synapses", status: "offline" }),
      makeService({ name: "other", status: "degraded" }),
    ]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("0/2 services healthy")).toBeDefined();
    });
  });

  it("shows empty state 'Checking service status…' when no services", async () => {
    mockInvoke.mockResolvedValue([]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("Checking service status…")).toBeDefined();
    });
  });

  it("renders a ServiceCard for each service returned", async () => {
    mockInvoke.mockResolvedValue([makeService({ name: "synapses", status: "healthy" })]);
    renderDashboard();
    await waitFor(() => {
      expect(screen.getByText("synapses")).toBeDefined();
    });
  });

  describe("Quick Actions", () => {
    it("shows 'Add Project' quick action link", () => {
      renderDashboard();
      expect(screen.getByText("Add Project")).toBeDefined();
    });

    it("shows 'Connect Agent' quick action link", () => {
      renderDashboard();
      expect(screen.getByText("Connect Agent")).toBeDefined();
    });

    it("shows 'Analytics' quick action link", () => {
      renderDashboard();
      expect(screen.getByText("Analytics")).toBeDefined();
    });

    it("shows 'Privacy & Data' quick action link", () => {
      renderDashboard();
      expect(screen.getByText("Privacy & Data")).toBeDefined();
    });

    it("'Add Project' links to /projects", () => {
      renderDashboard();
      const link = screen.getByText("Add Project").closest("a");
      expect(link?.getAttribute("href")).toBe("/projects");
    });

    it("'Connect Agent' links to /settings", () => {
      renderDashboard();
      const link = screen.getByText("Connect Agent").closest("a");
      expect(link?.getAttribute("href")).toBe("/settings");
    });

    it("'Analytics' links to /analytics", () => {
      renderDashboard();
      const link = screen.getByText("Analytics").closest("a");
      expect(link?.getAttribute("href")).toBe("/analytics");
    });

    it("'Privacy & Data' links to /privacy", () => {
      renderDashboard();
      const link = screen.getByText("Privacy & Data").closest("a");
      expect(link?.getAttribute("href")).toBe("/privacy");
    });
  });

  it("shows 'Quick Actions' section heading", () => {
    renderDashboard();
    expect(screen.getByText("Quick Actions")).toBeDefined();
  });

  it("shows 'Services' section heading", () => {
    renderDashboard();
    expect(screen.getByText("Services")).toBeDefined();
  });

  describe("startupError banner", () => {
    function setupListenCapture() {
      const callbacks: Record<string, () => void> = {};
      mockListen.mockImplementation((event: string, cb: () => void) => {
        callbacks[event] = cb;
        return Promise.resolve(() => {});
      });
      return callbacks;
    }

    it("shows 'Synapses binary not found' when service-binary-missing fires", async () => {
      const callbacks = setupListenCapture();
      renderDashboard();
      await waitFor(() => expect(callbacks["service-binary-missing"]).toBeDefined());
      const { act } = await import("@testing-library/react");
      await act(async () => { callbacks["service-binary-missing"](); });
      await waitFor(() =>
        expect(screen.getByText(/Synapses binary not found/i)).toBeDefined()
      );
    });

    it("shows 'Failed to start Synapses daemon' when service-start-failed fires", async () => {
      const callbacks = setupListenCapture();
      renderDashboard();
      await waitFor(() => expect(callbacks["service-start-failed"]).toBeDefined());
      const { act } = await import("@testing-library/react");
      await act(async () => { callbacks["service-start-failed"](); });
      await waitFor(() =>
        expect(screen.getByText(/Failed to start Synapses daemon/i)).toBeDefined()
      );
    });

    it("shows 'Daemon started but isn't responding' when service-start-timeout fires", async () => {
      const callbacks = setupListenCapture();
      renderDashboard();
      await waitFor(() => expect(callbacks["service-start-timeout"]).toBeDefined());
      const { act } = await import("@testing-library/react");
      await act(async () => { callbacks["service-start-timeout"](); });
      await waitFor(() =>
        expect(screen.getByText(/Daemon started but isn't responding/i)).toBeDefined()
      );
    });
  });
});
