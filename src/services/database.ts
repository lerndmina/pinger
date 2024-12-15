import Database from "bun:sqlite";
import type { DatabaseConfig, PingStats } from "../types/interfaces";

export class DatabaseService {
  private db: Database;
  private maxResults: number;

  constructor(config: DatabaseConfig) {
    this.db = new Database(config.path);
    this.maxResults = config.maxResults || 50000;
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
          LIMIT ?
        )
      )
    `,
      [this.maxResults]
    );
  }

  MAX_RESULTS_TO_LOAD = 50;

  public loadHistoricalStats(): PingStats {
    // Load last 5000 successful pings for latency history
    const latencyResults = this.db
      .query(
        `
        SELECT latency 
        FROM ping_results 
        WHERE is_successful = 1 
        ORDER BY id DESC 
        LIMIT ${this.MAX_RESULTS_TO_LOAD}
        `
      )
      .all() as { latency: number }[];

    // Load overall stats
    const statsResult = this.db
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

    return {
      totalPings: statsResult.total_pings,
      successful: statsResult.successful_pings,
      failed: statsResult.failed_pings,
      latencies: latencyResults.map((r) => r.latency).reverse(),
    };
  }

  public close(): void {
    this.db.close();
  }
}
