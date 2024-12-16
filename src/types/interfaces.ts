// Update interfaces.ts:
export interface PingStats {
  totalPings: number;
  successful: number;
  failed: number;
  latencies: number[]; // Only recent ones for graph
  stats: {
    maxLatency: number;
    avgLatency: number;
    percentile99: number;
  };
}

export interface LoggerConfig {
  baseDir?: string;
  maxLogLength?: number;
}

export interface DatabaseConfig {
  path: string;
  maxResults?: number;
  maxInitialGraphResults?: number;
}

export interface StopOptions {
  sendHelp?: boolean;
  force?: boolean;
  msg?: string;
}
