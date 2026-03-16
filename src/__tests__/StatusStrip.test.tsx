import { render, screen, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { StatusStrip } from "../components/StatusStrip";
import type { SidecarInfo, ServiceStatus } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const mockInvoke = invoke as ReturnType<typeof vi.fn>;

function makeService(
  name: string,
  status: ServiceStatus,
  overrides: Partial<SidecarInfo> = {}
): SidecarInfo {
  return {
    name,
    port: 11435,
    status,
    consecutive_failures: 0,
    restarts_total: 0,
    pid: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("StatusStrip", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('shows "Checking services…" when the services array is empty', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText("Checking services…")).toBeDefined()
    );
  });

  it('shows "1/1 services healthy" when there is 1 healthy service', async () => {
    mockInvoke.mockResolvedValue([makeService("synapses", "healthy")]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText("1/1 services healthy")).toBeDefined()
    );
  });

  it('shows "1 service offline" when 1 out of 1 service is offline', async () => {
    mockInvoke.mockResolvedValue([makeService("synapses", "offline")]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText("1 service offline")).toBeDefined()
    );
  });

  it('shows "2 services offline" when 2 services are offline', async () => {
    mockInvoke.mockResolvedValue([
      makeService("synapses", "offline"),
      makeService("other", "offline"),
    ]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText("2 services offline")).toBeDefined()
    );
  });

  it('shows "Degraded" when a service is degraded (and none are offline)', async () => {
    mockInvoke.mockResolvedValue([
      makeService("synapses", "healthy"),
      makeService("other", "degraded"),
    ]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText("Degraded")).toBeDefined()
    );
  });

  it('shows "Synapses" brand text always', async () => {
    mockInvoke.mockResolvedValue([]);
    render(<StatusStrip />);
    // The brand text is static — it's present immediately
    expect(screen.getByText("Synapses")).toBeDefined();
  });

  it("renders the status dot span", async () => {
    mockInvoke.mockResolvedValue([]);
    render(<StatusStrip />);
    const dot = document.querySelector(".status-strip-dot");
    expect(dot).not.toBeNull();
  });

  it("offline status takes priority over degraded in the label", async () => {
    mockInvoke.mockResolvedValue([
      makeService("synapses", "offline"),
      makeService("other", "degraded"),
    ]);
    render(<StatusStrip />);
    await waitFor(() =>
      expect(screen.getByText(/service.*offline/)).toBeDefined()
    );
    expect(screen.queryByText("Degraded")).toBeNull();
  });
});
