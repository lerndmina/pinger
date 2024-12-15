import type { PingStats } from "./types/interfaces";
import { Logger } from "./services/logger";
import { DatabaseService } from "./services/database";
import { ScreenManager } from "./ui/screen";
import { ping } from "./utils/ping";
import { join } from "path";

class Pinger {
  private logger: Logger;
  private db: DatabaseService;
  private screen: ScreenManager;
  private isRunning = true;
  private stats: PingStats;
  private target: string;
  private latencyHistory: number[] = [];

  constructor(target?: string) {
    try {
      // Initialize core services
      this.logger = new Logger({
        baseDir: join(process.cwd(), "src", "logs"),
        maxLogLength: 80,
      });

      this.db = new DatabaseService({
        path: join(process.cwd(), "ping_history.sqlite"),
        maxResults: 50000,
      });

      // Initialize target
      this.target = this.initializeTarget(target);

      // Load historical data
      this.stats = this.loadInitialStats();

      // Initialize UI
      this.screen = new ScreenManager(this.target, this.logger);

      // Setup error handlers
      this.setupErrorHandling();

      // Log startup
      this.logger.log(`Pinger initialized with target: ${this.target}`, "INFO");
    } catch (error) {
      console.error("Failed to initialize Pinger:", error);
      process.exit(1);
    }
  }

  private initializeTarget(target?: string): string {
    const lastTarget = this.db.getLastTarget();
    const selectedTarget = target || lastTarget;

    if (!selectedTarget) {
      throw new Error("No target provided and no previous target found");
    }

    // Save the current target
    this.db.saveTarget(selectedTarget);
    return selectedTarget;
  }

  private loadInitialStats(): PingStats {
    try {
      const stats = this.db.loadHistoricalStats();
      this.latencyHistory = stats.latencies;
      return stats;
    } catch (error) {
      this.logger.error(`Failed to load historical stats: ${error}`);
      return {
        totalPings: 0,
        successful: 0,
        failed: 0,
        latencies: [],
      };
    }
  }

  private setupErrorHandling() {
    process.on("uncaughtException", (error) => {
      this.logger.error(`Uncaught Exception: ${error.message}`);
      this.stop();
      process.exit(1);
    });

    process.on("unhandledRejection", (reason, promise) => {
      this.logger.error(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
      this.stop();
      process.exit(1);
    });

    // Handle graceful shutdown
    process.on("SIGINT", () => {
      this.logger.log("Received SIGINT, shutting down...", "INFO");
      this.stop();
      process.exit(0);
    });

    process.on("SIGTERM", () => {
      this.logger.log("Received SIGTERM, shutting down...", "INFO");
      this.stop();
      process.exit(0);
    });
  }

  private updateStats(latency: number | null, isSuccessful: boolean) {
    // Update in-memory stats
    this.stats.totalPings++;
    if (isSuccessful) {
      this.stats.successful++;
      if (latency !== null) {
        this.stats.latencies.push(latency);
        this.latencyHistory.push(latency);

        // Keep history at a reasonable size
        if (this.latencyHistory.length > 5000) {
          this.latencyHistory.shift();
        }
      }
    } else {
      this.stats.failed++;
    }

    // Save to database
    this.db.saveResult(latency, isSuccessful);
  }

  public async start() {
    try {
      // Initialize screen
      this.screen.createLayout();

      // Main ping loop
      while (this.isRunning) {
        try {
          const latency = await ping(this.target);
          this.updateStats(latency, true);
          this.logger.log(`Ping successful: ${latency}ms`, "INFO");
        } catch (err) {
          const error = err as Error;
          this.updateStats(null, false);
          this.logger.log(`Ping failed: ${error.message}`, "WARN");
        }

        // Update display
        this.screen.updateDisplay({
          ...this.stats,
          latencies: this.latencyHistory,
        });

        // Wait before next ping
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.logger.error(`Fatal error: ${error}`);
      this.stop();
      process.exit(1);
    }
  }

  public stop() {
    try {
      this.isRunning = false;
      this.screen.destroy();
      this.db.close();
      this.logger.log("Pinger stopped gracefully", "INFO");
    } catch (error) {
      console.error("Error during shutdown:", error);
    }
  }
}

// Application entry point
function main() {
  const target = process.argv[2];

  try {
    // Create a temporary DatabaseService to check for last target
    const db = new DatabaseService({
      path: join(process.cwd(), "ping_history.sqlite"),
      maxResults: 50000,
    });

    const lastTarget = db.getLastTarget();

    if (!target && !lastTarget) {
      console.error("Error: Target is required. Usage: bun run src/index.ts <target>");
      process.exit(1);
    }

    const pinger = new Pinger(target); // will use lastTarget if target is undefined
    pinger.start().catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start Pinger:", error);
    process.exit(1);
  }
}

main();
