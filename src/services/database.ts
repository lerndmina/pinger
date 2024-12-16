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
  private maxResults: number;
  private maxInitialGraphResults = 50;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.maxResults = config.maxResults || 5000;
    this.maxInitialGraphResults = config.maxInitialGraphResults || 50;
    this.initDatabase();
  }

  private initDatabase() {
    // Create necessary tables if they don't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS ping_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        latency REAL,
        is_successful INTEGER
      )
    `);

    // Create an index to improve query performance
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_ping_results_timestamp 
      ON ping_results (timestamp)
    `);
  }

  public getLastTarget(): string | null {
    try {
      const result = this.db.query("SELECT value FROM settings WHERE key = 'last_target'").get() as { value: string } | null;
      return result?.value || null; // This is correct, but let's add some logging
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

    // Maintain only the last maxResults results in the database
    this.db.run(
      `
      DELETE FROM ping_results 
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id 
          FROM ping_results 
          ORDER BY id DESC 
          ${this.maxResults > 0 && this.maxResults < Infinity ? `LIMIT ${this.maxResults}` : ""}
        )
      )
    `
    );
  }

  public loadHistoricalStats(): PingStats {
    // Calculate statistics directly in SQL
    const statsResult = this.db
      .query(
        `
      WITH recent_pings AS (
        SELECT latency
        FROM ping_results
        WHERE is_successful = 1
        ORDER BY id DESC
        LIMIT ${this.maxInitialGraphResults}
      ),
      sorted_latencies AS (
        SELECT latency, 
          ROW_NUMBER() OVER (ORDER BY latency) as row_num,
          COUNT(*) OVER () as total_count
        FROM recent_pings
      ),
      percentile_calc AS (
        SELECT latency
        FROM sorted_latencies
        WHERE row_num = CEIL(0.99 * total_count)
      )
      SELECT 
        MAX(rp.latency) as max_latency,
        AVG(rp.latency) as avg_latency,
        (SELECT latency FROM percentile_calc) as percentile_99
      FROM recent_pings rp
    `
      )
      .get() as LatencyStats;

    // Get counts for basic stats
    const countStats = this.db
      .query(
        `
      SELECT 
        COUNT(*) as total_pings,
        SUM(CASE WHEN is_successful = 1 THEN 1 ELSE 0 END) as successful_pings,
        SUM(CASE WHEN is_successful = 0 THEN 1 ELSE 0 END) as failed_pings
      FROM ping_results
    `
      )
      .get() as { total_pings: number; successful_pings: number; failed_pings: number };

    // Get only recent latencies for graph
    const recentLatencies = this.db
      .query(
        `
      SELECT latency 
      FROM ping_results 
      WHERE is_successful = 1 
      ORDER BY id DESC 
      LIMIT ${MAX_GRAPH_SIZE}
    `
      )
      .all() as { latency: number }[];

    return {
      totalPings: countStats.total_pings,
      successful: countStats.successful_pings,
      failed: countStats.failed_pings,
      latencies: recentLatencies.map((r) => r.latency).reverse(),
      stats: {
        maxLatency: statsResult.max_latency,
        avgLatency: statsResult.avg_latency,
        percentile99: statsResult.percentile_99,
      },
    };
  }

  public close(): void {
    this.db.close();
  }
}
