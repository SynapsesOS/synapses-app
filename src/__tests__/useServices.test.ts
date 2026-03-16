import { renderHook, act } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useServices } from "../hooks/useServices";
import type { SidecarInfo } from "../types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const mockInvoke = vi.mocked(invoke);
const mockListen = vi.mocked(listen);

const makeService = (name: string, status = "running"): SidecarInfo => ({
  name,
  status,
  pid: 1234,
  uptime_secs: 60,
  restart_count: 0,
  enabled: true,
});

describe("useServices", () => {
  let listenCallbacks: Record<string, Function>;
  let unsubFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    listenCallbacks = {};
    unsubFn = vi.fn();

    mockListen.mockImplementation((event: string, cb: Function) => {
      listenCallbacks[event] = cb;
      return Promise.resolve(unsubFn);
    });

    mockInvoke.mockResolvedValue([]);
  });

  it("has initial state: services=[], startupError=null", () => {
    const { result } = renderHook(() => useServices());
    expect(result.current.services).toEqual([]);
    expect(result.current.startupError).toBeNull();
  });

  it("calls invoke('get_service_status') on mount", async () => {
    await act(async () => {
      renderHook(() => useServices());
    });
    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
  });

  it("sets services from invoke result", async () => {
    const services = [makeService("synapses")];
    mockInvoke.mockResolvedValueOnce(services);

    const { result } = await act(async () => renderHook(() => useServices()));

    expect(result.current.services).toEqual(services);
  });

  it("calls listen 6 times for all events", async () => {
    await act(async () => {
      renderHook(() => useServices());
    });

    expect(mockListen).toHaveBeenCalledTimes(6);
    const events = mockListen.mock.calls.map((c) => c[0]);
    expect(events).toContain("service-status");
    expect(events).toContain("service-restarted");
    expect(events).toContain("service-offline");
    expect(events).toContain("service-binary-missing");
    expect(events).toContain("service-start-failed");
    expect(events).toContain("service-start-timeout");
  });

  it("service-status event updates services", async () => {
    const { result } = await act(async () => renderHook(() => useServices()));

    const incoming = [makeService("synapses"), makeService("scout")];

    await act(async () => {
      listenCallbacks["service-status"]({ payload: incoming });
    });

    expect(result.current.services).toEqual(incoming);
  });

  it("service-restarted event re-fetches service status", async () => {
    const refreshed = [makeService("synapses", "running")];
    mockInvoke.mockResolvedValue(refreshed);

    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue(refreshed);

    await act(async () => {
      await listenCallbacks["service-restarted"]({ payload: "synapses" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
    expect(result.current.services).toEqual(refreshed);
  });

  it("service-offline event re-fetches service status", async () => {
    await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([makeService("synapses", "stopped")]);

    await act(async () => {
      await listenCallbacks["service-offline"]({ payload: "synapses" });
    });

    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
  });

  it("service-binary-missing sets startupError and re-fetches", async () => {
    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([]);

    await act(async () => {
      await listenCallbacks["service-binary-missing"]({ payload: "" });
    });

    expect(result.current.startupError).toBe(
      "Synapses binary not found. Install it to ~/.synapses/bin/synapses"
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
  });

  it("service-start-failed sets startupError and re-fetches", async () => {
    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([]);

    await act(async () => {
      await listenCallbacks["service-start-failed"]({ payload: "" });
    });

    expect(result.current.startupError).toBe(
      "Failed to start Synapses daemon. Check logs in Settings → Service Log."
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
  });

  it("service-start-timeout sets startupError and re-fetches", async () => {
    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValue([]);

    await act(async () => {
      await listenCallbacks["service-start-timeout"]({ payload: "" });
    });

    expect(result.current.startupError).toBe(
      "Daemon started but isn't responding. Check Settings → Service Log."
    );
    expect(mockInvoke).toHaveBeenCalledWith("get_service_status");
  });

  it("restart(name) calls invoke('restart_service', { name }) then get_service_status", async () => {
    const updated = [makeService("synapses", "running")];
    mockInvoke.mockResolvedValue([]);

    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValueOnce(undefined); // restart_service
    mockInvoke.mockResolvedValueOnce(updated);   // get_service_status

    await act(async () => {
      await result.current.restart("synapses");
    });

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "restart_service", { name: "synapses" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_service_status");
    expect(result.current.services).toEqual(updated);
  });

  it("stop(name) calls invoke('stop_service', { name }) then get_service_status", async () => {
    const updated = [makeService("synapses", "stopped")];
    mockInvoke.mockResolvedValue([]);

    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.stop("synapses");
    });

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "stop_service", { name: "synapses" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_service_status");
    expect(result.current.services).toEqual(updated);
  });

  it("enable(name) calls invoke('enable_service', { name }) then get_service_status", async () => {
    const updated = [makeService("synapses", "running")];
    mockInvoke.mockResolvedValue([]);

    const { result } = await act(async () => renderHook(() => useServices()));

    mockInvoke.mockClear();
    mockInvoke.mockResolvedValueOnce(undefined);
    mockInvoke.mockResolvedValueOnce(updated);

    await act(async () => {
      await result.current.enable("synapses");
    });

    expect(mockInvoke).toHaveBeenNthCalledWith(1, "enable_service", { name: "synapses" });
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "get_service_status");
    expect(result.current.services).toEqual(updated);
  });

  it("calls unsub functions on unmount", async () => {
    const { unmount } = await act(async () => renderHook(() => useServices()));

    await act(async () => {
      unmount();
    });

    // 6 listeners were registered; each unsub should be called once
    expect(unsubFn).toHaveBeenCalledTimes(6);
  });
});
