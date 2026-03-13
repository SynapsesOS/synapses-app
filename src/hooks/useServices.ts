import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { SidecarInfo } from "../types";

export function useServices() {
  const [services, setServices] = useState<SidecarInfo[]>([]);

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

    return () => {
      unsub1.then((f) => f());
      unsub2.then((f) => f());
      unsub3.then((f) => f());
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

  return { services, restart, stop };
}
