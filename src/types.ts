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

export type EntityType = "function" | "method" | "struct" | "interface" | "file" | "package" | "unknown";
export type DomainType = "code" | "api" | "infra" | "docs" | "issues" | "custom";

export interface EntityRow {
  id: string;
  name: string;
  type: EntityType;
  file: string;
  domain: DomainType;
}

export interface SearchEntitiesResponse {
  entities: EntityRow[];
  total: number;
  query: string;
}
