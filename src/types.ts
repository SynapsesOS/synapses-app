export type ServiceStatus = "healthy" | "degraded" | "offline" | "disabled" | "starting";

export interface SidecarInfo {
  name: string;
  port: number;
  status: ServiceStatus;
  consecutive_failures: number;
  restarts_total: number;
  pid?: number;
}

export interface Project {
  path: string;
  name: string;
  status: "healthy" | "stale" | "unindexed";
  node_count?: number;
  last_indexed?: string;
}
