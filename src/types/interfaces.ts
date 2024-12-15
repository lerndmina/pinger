export interface PingStats {
  totalPings: number;
  successful: number;
  failed: number;
  latencies: number[];
}

export interface LoggerConfig {
  baseDir?: string;
  maxLogLength?: number;
}

export interface DatabaseConfig {
  path: string;
  maxResults?: number;
}
