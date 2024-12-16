import type { PingStats, StopOptions } from "./types/interfaces";
import { Logger } from "./services/logger";
import { DatabaseService } from "./services/database";
import { ScreenManager } from "./ui/screen";
import { ping } from "./utils/ping";
import { join } from "path";
import { execSync } from "child_process";

export const MAX_GRAPH_SIZE = 50;
export const LOG_AFTER_PINGS = 10;
export const DEBUG = process.env.NODE_ENV === "development" || process.env.DEBUG === "true" || process.argv.includes("--debug");
export const MAX_LOG_LINES_BUFFER = 1000;
export const GITHUB_URL = "https://github.com/lerndmina/pinger";

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
        stats: {
          maxLatency: 0,
          avgLatency: 0,
          percentile99: 0,
        },
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
      this.stop({ force: true });
    });

    process.on("SIGTERM", () => {
      this.logger.log("Received SIGTERM, shutting down...", "INFO");
      this.stop({ force: true });
    });
  }

  private updateStats(latency: number | null, isSuccessful: boolean) {
    // Update basic counters
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

        // Calculate real-time statistics from recent latencies
        const recentLatencies = this.latencyHistory.slice(-50);
        this.stats.stats = {
          maxLatency: Math.max(...recentLatencies),
          avgLatency: recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length,
          percentile99: this.calculatePercentile(recentLatencies, 99),
        };
      }
    } else {
      this.stats.failed++;
    }

    // Save to database
    this.db.saveResult(latency, isSuccessful);
  }

  private calculatePercentile(arr: number[], p: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const pos = ((sorted.length - 1) * p) / 100;
    const base = Math.floor(pos);
    const rest = pos - base;

    if (sorted[base + 1] !== undefined) {
      return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
      return sorted[base];
    }
  }

  public async start() {
    try {
      // Initialize screen first
      this.screen.createLayout();

      // Perform pre-boot chores
      this.logger.cleanup(`7d`);

      // Validate target connectivity
      this.logger.log(`Validating connection to ${this.target}...`, "INFO");
      try {
        await ping(this.target);
        this.logger.log("Target validation successful", "INFO");
      } catch (error) {
        const shutdownMsg = [`Failed to reach target: ${error}`, `Target: "${this.target}"`].join("\n");
        this.logger.error(shutdownMsg);
        this.stop({ msg: shutdownMsg, sendHelp: true });
        process.exit(1);
      }

      // Main ping loop
      while (this.isRunning) {
        try {
          const latency = await ping(this.target);
          this.updateStats(latency, true);
          this.logger.log(`Ping successful: ${latency}ms`, "DEBUG");
        } catch (err) {
          const error = err as Error;
          this.updateStats(null, false);
          this.logger.log(`Ping failed: ${error.message}`, "DEBUG");
        }

        // Update display
        this.screen.updateDisplay({
          ...this.stats,
          latencies: this.latencyHistory,
        });

        // Log every LOG_AFTER_PINGS pings average, min, max, 99th percentile for the last 10 pings
        if (this.stats.totalPings % 10 === 0) {
          const recentLatencies = this.latencyHistory.slice(-LOG_AFTER_PINGS);
          const avgLatency = recentLatencies.reduce((a, b) => a + b, 0) / recentLatencies.length;
          const minLatency = Math.min(...recentLatencies);
          const maxLatency = Math.max(...recentLatencies);
          const percentile99 = this.calculatePercentile(recentLatencies, 99);

          this.logger.log(`Last ${LOG_AFTER_PINGS} pings: Avg: ${avgLatency.toFixed(2)}ms, Min: ${minLatency}ms, Max: ${maxLatency}ms, 99th %ile: ${percentile99}ms`, "INFO");
        }

        // Wait before next ping
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.logger.error(`Fatal error: ${error}`);
      this.stop({ msg: `Fatal error: ${error}` });
      process.exit(1);
    }
  }

  /**
   * Gracefully stops the pinger
   * @param msg Optional shutdown message
   * @param options Optional configuration for shutdown behavior
   */
  public stop(options: Partial<StopOptions> = {}) {
    const defaultOptions: StopOptions = {
      sendHelp: false,
      force: false,
      msg: undefined,
    };

    // Merge provided options with defaults
    const finalOptions = { ...defaultOptions, ...options };

    try {
      this.isRunning = false;
      this.screen.destroy();
      this.db.close();
      this.logger.log("Pinger stopped gracefully", "INFO");
      if (finalOptions.msg) {
        this.logger.log(finalOptions.msg, "ERROR");
      }
      if (finalOptions.force) process.exit(0);
      if (finalOptions.sendHelp) printHelpAndExit();
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  }
}

function randomString(arr: string[]): string {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const flags = process.argv.slice(2).filter((arg) => arg.startsWith("-"));

// Application entry point
async function main() {
  // Filter out node/bun path, script path, and anything starting with "-"
  const cleanArgs = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));
  const target = cleanArgs[0]; // First non-flag argument is the target

  if (flags.includes("--help") || flags.includes("-h")) printHelpAndExit();
  if (flags.includes("--version") || flags.includes("-v")) {
    const v = await getVersion();
    console.log(`Local Version: ${v.localSha}`);
    console.log(`Remote Version: ${v.upstreamVersion}`);
    if (!v.isUpToDate) {
      console.log("Your version differs from the latest release, perhaps you are out of date.");
      console.log("Consider updating:");
      console.log(`  ${GITHUB_URL}/releases/latest`);
    }

    process.exit(0);
  }

  try {
    const db = new DatabaseService({
      path: join(process.cwd(), "ping_history.sqlite"),
      maxResults: 50000,
    });

    const lastTarget = db.getLastTarget();

    // Use target from args or last used target
    const selectedTarget = target || lastTarget;

    if (!selectedTarget) {
      throw new Error("No target provided and no previous target found. Usage: bun run src/index.ts [--debug] <hostname>");
    }

    if (!selectedTarget.trim()) {
      throw new Error("Invalid target. Usage: bun run src/index.ts [--debug] <hostname>");
    }

    const pinger = new Pinger(selectedTarget);
    pinger.start().catch((error) => {
      console.error("Fatal error:", error);
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to start Pinger:", error);
    process.exit(1);
  }
}

function printHelpAndExit() {
  const possibleFlags = ["--debug", "--help", "--version", "--fresh"];
  const hostnameExamples = ["google.com", "1.1.1.1", "localhost", "127.0.0.1"];
  const description = [
    "Ping a target host and display latency statistics in a terminal UI",
    " - Usage: bun run src/index.ts <hostname>",
    ` - Example: bun run src/index.ts google.com`,
    ` - With debugging: bun run src/index.ts --debug ${randomString(hostnameExamples)}`,
    "Flags:",
    ...possibleFlags.map((flag) => `  ${flag}`),
    `You can use both hostnames and IP addresses as targets`,
    ...hostnameExamples.map((host) => `  ${host}`),
  ];

  console.log(description.join("\n"));
  process.exit(0);
}

async function getVersion() {
  // Get remote sha from github latest commit
  let response = await fetch("https://api.github.com/repos/lerndmina/pinger/commits/main");
  let data = await response.json();

  const upstreamSha = data.sha;

  // Get remote version from github latest release
  response = await fetch("https://api.github.com/repos/lerndmina/pinger/releases/latest");
  data = await response.json();

  const upstreamVersion = data.tag_name || "1.0.0";

  // Get local sha from git
  const localSha = execSync("git rev-parse HEAD").toString().trim();

  // Compare local and remote sha
  const isUpToDate = localSha === upstreamSha;

  return { localSha, upstreamVersion, upstreamSha, isUpToDate };
}

await main();
