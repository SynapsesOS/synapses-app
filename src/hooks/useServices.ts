import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SidecarInfo } from "../types";

export function useServices() {
  const [services, setServices] = useState<SidecarInfo[]>([]);
  const [startupError, setStartupError] = useState<string | null>(null);

  useEffect(() => {
    // Initial fetch
    invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});

    // Listen for real-time updates from the health watcher
    const unsub1 = listen<SidecarInfo[]>("service-status", (e) => setServices(e.payload));
    const unsub2 = listen<string>("service-restarted", () => {
      invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});
    });
    const unsub3 = listen<string>("service-offline", () => {
      invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});
    });
    // Startup failure events emitted by ensure_daemon_started before the health loop begins
    const unsub4 = listen<string>("service-binary-missing", () => {
      setStartupError("Synapses binary not found. Install it to ~/.synapses/bin/synapses");
      invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});
    });
    const unsub5 = listen<string>("service-start-failed", () => {
      setStartupError("Failed to start Synapses daemon. Check logs in Settings → Service Log.");
      invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});
    });
    const unsub6 = listen<string>("service-start-timeout", () => {
      setStartupError("Daemon started but isn't responding. Check Settings → Service Log.");
      invoke<SidecarInfo[]>("get_service_status").then(setServices).catch(() => {});
    });

    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
      unsub3.then((f) => f());
      unsub4.then((f) => f());
      unsub5.then((f) => f());
      unsub6.then((f) => f());
    };
  }, []);

  const restart = async (name: string) => {
    await invoke("restart_service", { name });
    const updated = await invoke<SidecarInfo[]>("get_service_status");
    setServices(updated);
  };

  const stop = async (name: string) => {
    await invoke("stop_service", { name });
    const updated = await invoke<SidecarInfo[]>("get_service_status");
    setServices(updated);
  };

  const enable = async (name: string) => {
    await invoke("enable_service", { name });
    const updated = await invoke<SidecarInfo[]>("get_service_status");
    setServices(updated);
  };

  return { services, restart, stop, enable, startupError };
}
