import Database from "bun:sqlite";
import type { DatabaseConfig, PingStats } from "../types/interfaces";
import { MAX_GRAPH_SIZE } from "..";

interface LatencyStats {
  max_latency: number;
  avg_latency: number;
  percentile_99: number;
}

export class DatabaseService {
  private db: Database;
  public queryLimit: number;
  private maxStorageLimit: number = 10000000; // 10M records maximum storage
  private maxInitialGraphResults = 50;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.queryLimit = config.maxResults || 5000;
    this.maxInitialGraphResults = config.maxInitialGraphResults || 50;
    this.initDatabase();
  }

  private initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    // Create ping_results table to store the raw ping results
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ping_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        latency REAL,
        is_successful INTEGER
      )
    `);

    // Create ping_stats table to store aggregated stats
    this.db.run(`
      CREATE TABLE IF NOT EXISTS ping_stats (
        id INTEGER PRIMARY KEY,
        total_count INTEGER DEFAULT 0,
        total_sum REAL DEFAULT 0,
        historical_max REAL DEFAULT 0,
        historical_min REAL DEFAULT NULL,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

    this.db.run(`
        INSERT OR IGNORE INTO ping_stats (id) VALUES (1)
      `);

    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ping_results_timestamp 
      ON ping_results (timestamp)
    `);
  }

  public getLastTarget(): string | null {
    try {
      const result = this.db.query("SELECT value FROM settings WHERE key = 'last_target'").get() as { value: string } | null;
      return result?.value || null;
    } catch (error) {
      console.error("Error getting last target:", error);
      return null;
    }
  }

  public saveTarget(target: string): void {
    this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_target', ?)", [target]);
  }

  public saveResult(latency: number | null, isSuccessful: boolean): void {
    // Insert ping result
    this.db.run("INSERT INTO ping_results (latency, is_successful) VALUES (?, ?)", [latency, isSuccessful ? 1 : 0]);

    // Update running statistics
    if (isSuccessful && latency !== null) {
      this.db.run(
        `
      UPDATE ping_stats 
      SET 
        total_count = total_count + 1,
        total_sum = total_sum + ?,
        historical_max = MAX(historical_max, ?),
        historical_min = CASE 
          WHEN historical_min IS NULL THEN ? 
          ELSE MIN(historical_min, ?)
        END,
        last_updated = CURRENT_TIMESTAMP
      WHERE id = 1`,
        [latency, latency, latency, latency]
      );
    }
  }

  public loadHistoricalStats(): PingStats {
    // Get running statistics
    const stats = this.db
      .query(
        `
      SELECT 
        total_count,
        total_sum,
        historical_max,
        historical_min,
        (total_sum / NULLIF(total_count, 0)) as historical_avg
      FROM ping_stats 
      WHERE id = 1
    `
      )
      .get() as {
      total_count: number;
      total_sum: number;
      historical_max: number;
      historical_min: number;
      historical_avg: number;
    };

    // Get counts for recent window
    const countStats = this.db
      .query(
        `
      WITH limited_results AS (
        SELECT *
        FROM ping_results
        ORDER BY id DESC
        LIMIT ${this.queryLimit}
      )
      SELECT 
        COUNT(*) as total_pings,
        SUM(CASE WHEN is_successful = 1 THEN 1 ELSE 0 END) as successful_pings,
        SUM(CASE WHEN is_successful = 0 THEN 1 ELSE 0 END) as failed_pings
      FROM limited_results
    `
      )
      .get() as {
      total_pings: number;
      successful_pings: number;
      failed_pings: number;
    };

    // Get recent latencies for percentile calculation and graph
    const recentLatencies = this.db
      .query(
        `
      SELECT latency 
      FROM ping_results 
      WHERE is_successful = 1 AND latency IS NOT NULL
      ORDER BY id DESC 
      LIMIT ${MAX_GRAPH_SIZE}
    `
      )
      .all() as { latency: number }[];

    // Calculate 99th percentile from recent data
    const sortedLatencies = recentLatencies.map((r) => r.latency).sort((a, b) => a - b);
    const percentileIdx = Math.ceil(sortedLatencies.length * 0.99) - 1;
    const percentile99 = sortedLatencies[percentileIdx] || 0;

    return {
      totalPings: countStats.total_pings,
      successful: countStats.successful_pings,
      failed: countStats.failed_pings,
      latencies: recentLatencies.map((r) => r.latency).reverse(),
      stats: {
        maxLatency: stats.historical_max || 0,
        minLatency: stats.historical_min || 0,
        avgLatency: stats.historical_avg || 0,
        percentile99: percentile99,
      },
    };
  }

  public close(): void {
    this.db.close();
  }
}
