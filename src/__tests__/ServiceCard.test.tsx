import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { act } from "@testing-library/react";
import { ServiceCard } from "../components/ServiceCard";
import type { SidecarInfo, ServiceStatus } from "../types";

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------
const makeInfo = (overrides: Partial<SidecarInfo> = {}): SidecarInfo => ({
  name: "synapses",
  port: 11435,
  status: "healthy",
  consecutive_failures: 0,
  restarts_total: 0,
  pid: 1234,
  ...overrides,
});

function renderCard(
  overrides: Partial<SidecarInfo> = {},
  callbacks: {
    onRestart?: (name: string) => void;
    onStop?: (name: string) => void;
    onEnable?: (name: string) => Promise<void>;
  } = {}
) {
  const onRestart = callbacks.onRestart ?? vi.fn();
  const onStop = callbacks.onStop ?? vi.fn();
  const onEnable = callbacks.onEnable ?? vi.fn().mockResolvedValue(undefined);

  render(
    <ServiceCard
      info={makeInfo(overrides)}
      onRestart={onRestart}
      onStop={onStop}
      onEnable={onEnable}
    />
  );
  return { onRestart, onStop, onEnable };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ServiceCard", () => {
  describe("service name and description", () => {
    it("renders the service name", () => {
      renderCard();
      expect(screen.getByText("synapses")).toBeDefined();
    });

    it("shows the description for the known service name 'synapses'", () => {
      renderCard({ name: "synapses" });
      expect(
        screen.getByText("Code intelligence daemon · port 11435")
      ).toBeDefined();
    });

    it("shows empty description for an unknown service name", () => {
      renderCard({ name: "unknown-service" });
      const desc = document.querySelector(".service-desc");
      expect(desc).not.toBeNull();
      expect(desc!.textContent).toBe("");
    });
  });

  describe("status labels", () => {
    const cases: [ServiceStatus, string][] = [
      ["healthy", "Healthy"],
      ["degraded", "Degraded"],
      ["offline", "Offline"],
      ["disabled", "Disabled"],
      ["starting", "Starting…"],
    ];

    for (const [status, label] of cases) {
      it(`shows "${label}" for status "${status}"`, () => {
        renderCard({ status });
        expect(screen.getByText(label)).toBeDefined();
      });
    }
  });

  describe("action buttons — non-disabled status", () => {
    it("shows a Restart button when status is not disabled", () => {
      renderCard({ status: "healthy" });
      expect(screen.getByTitle("Restart")).toBeDefined();
    });

    it("shows a Stop button when status is not disabled", () => {
      renderCard({ status: "healthy" });
      expect(screen.getByTitle("Stop")).toBeDefined();
    });

    it("does NOT show an Enable button when status is not disabled", () => {
      renderCard({ status: "healthy" });
      expect(screen.queryByTitle("Enable")).toBeNull();
    });

    it("calls onRestart with the service name when Restart is clicked", () => {
      const { onRestart } = renderCard({ status: "healthy" });
      fireEvent.click(screen.getByTitle("Restart"));
      expect(onRestart).toHaveBeenCalledWith("synapses");
    });

    it("calls onStop with the service name when Stop is clicked", () => {
      const { onStop } = renderCard({ status: "healthy" });
      fireEvent.click(screen.getByTitle("Stop"));
      expect(onStop).toHaveBeenCalledWith("synapses");
    });
  });

  describe("action buttons — disabled status", () => {
    it("does NOT show a Restart button when disabled", () => {
      renderCard({ status: "disabled" });
      expect(screen.queryByTitle("Restart")).toBeNull();
    });

    it("does NOT show a Stop button when disabled", () => {
      renderCard({ status: "disabled" });
      expect(screen.queryByTitle("Stop")).toBeNull();
    });

    it("shows an Enable (Play) button when disabled", () => {
      renderCard({ status: "disabled" });
      expect(screen.getByTitle("Enable")).toBeDefined();
    });

    it("calls onEnable with the service name when Enable is clicked", async () => {
      const onEnable = vi.fn().mockResolvedValue(undefined);
      renderCard({ status: "disabled" }, { onEnable });

      await act(async () => {
        fireEvent.click(screen.getByTitle("Enable"));
      });

      expect(onEnable).toHaveBeenCalledWith("synapses");
    });

    it("shows spinning icon while enabling and restores after", async () => {
      // onEnable resolves after a tick so we can observe the intermediate state
      let resolveEnable!: () => void;
      const onEnable = vi.fn().mockImplementation(
        () => new Promise<void>((res) => { resolveEnable = res; })
      );

      renderCard({ status: "disabled" }, { onEnable });

      // Before click: title is "Enable"
      const btn = screen.getByTitle("Enable");
      expect(btn.getAttribute("disabled")).toBeNull();

      act(() => {
        fireEvent.click(btn);
      });

      // After click, while the promise is pending: button should be disabled
      // and title should be "Starting…"
      await waitFor(() =>
        expect(screen.getByTitle("Starting…")).toBeDefined()
      );
      expect(screen.getByTitle("Starting…").hasAttribute("disabled")).toBe(true);

      // Resolve the promise
      await act(async () => {
        resolveEnable();
      });

      // After resolution: back to "Enable" title
      await waitFor(() =>
        expect(screen.getByTitle("Enable")).toBeDefined()
      );
    });
  });

  describe("restart count", () => {
    it("shows 'Auto-restarted Nx' when restarts_total > 0", () => {
      renderCard({ restarts_total: 3 });
      expect(screen.getByText("Auto-restarted 3×")).toBeDefined();
    });

    it("does NOT show restart count when restarts_total === 0", () => {
      renderCard({ restarts_total: 0 });
      expect(screen.queryByText(/Auto-restarted/)).toBeNull();
    });
  });
});
