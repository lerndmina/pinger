import type { PingStats, StopOptions } from "./types/interfaces";
import { mkdirSync, copyFileSync, unlinkSync } from "fs";
import { Logger } from "./services/logger";
import { DatabaseService } from "./services/database";
import { ScreenManager } from "./ui/screen";
import { ping } from "./utils/ping";
import { join } from "path";
import { exec, execSync } from "child_process";
import { existsSync } from "fs";
import { Command } from "commander";
import parseSize from "./utils/parseSize";
import { update } from "./utils/update";
import { sleep } from "bun";

export const MAX_GRAPH_SIZE = 50;
export const LOG_AFTER_PINGS = 10;
export const DEBUG = process.env.NODE_ENV === "development" || process.env.DEBUG === "true" || process.argv.includes("--debug") || process.argv.includes("-d");
export const MAX_LOG_LINES_BUFFER = 1000;
export const GITHUB_URL = "https://github.com/lerndmina/pinger";

// Initialise program
export const program = new Command()
  .name("pinger")
  .description("Network latency monitoring tool")
  .argument("[target]", "hostname or IP to ping")
  .helpOption("-h, --help", "display help for command")
  .option("-d, --debug", "enable debug logging")
  .option("-f, --fresh", "reset database")
  .option("-e, --exit", "exit after cleaning database (with --fresh)")
  .option("-v, --version", "output the version number")
  .option("-l, --load-count <size>", "number of results to load (max 99m, supports k/m suffix)", parseSize);

class Pinger {
  private logger: Logger;
  private db: DatabaseService;
  private screen: ScreenManager;
  private isRunning = true;
  private stats: PingStats;
  private target: string;
  private latencyHistory: number[] = [];

  constructor(target?: string, options?: Record<string, any>) {
    try {
      // Initialize core services
      this.logger = new Logger({
        baseDir: join(process.cwd(), "src", "logs"),
      });

      this.db = new DatabaseService({
        path: join(process.cwd(), "ping_history.sqlite"),
        maxResults: options?.loadCount || 50000,
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
          minLatency: 0,
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
    this.stats.totalPings++;
    if (isSuccessful && latency !== null) {
      this.stats.successful++;
      this.latencyHistory.push(latency);

      // Keep rolling window of latest pings for real-time display
      if (this.latencyHistory.length > this.db.queryLimit) {
        this.latencyHistory.shift();
      }

      // Calculate stats from full history for accuracy
      const allLatencies = this.latencyHistory;
      this.stats.stats = {
        maxLatency: Math.max(...allLatencies),
        minLatency: Math.min(...allLatencies),
        avgLatency: allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length,
        percentile99: this.calculatePercentile(allLatencies, 99),
      };
    } else {
      this.stats.failed++;
    }

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

      // Check for an update asynchonously
      getVersion().then(async (v) => {
        if (!v.isUpToDate) {
          this.logger.log("You are out of date, consider updating", "WARN");
          this.logger.log(`To update, launch the program with the --version (-v) flag`, "INFO");
          if (v.currentBranch !== "main") {
            this.logger.log(`You are on branch: ${v.currentBranch}`, "WARN");
            this.logger.log(`If you are a developer, you should probably update manually if needed.`, "WARN");
          }
        } else {
          this.logger.log(`Pinger is up to date: ${v.upstreamVersion}`, "INFO");
        }
        this.logger.log(`Update check took: ${v.executionTime.toFixed(2)}ms`, "DEBUG");
      });

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

          this.logger.log(`Last ${LOG_AFTER_PINGS} pings:\nAvg: ${avgLatency.toFixed(2)}ms\nMin: ${minLatency}ms\nMax: ${maxLatency}ms\n99th %ile: ${percentile99}ms`, "INFO");
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

function printHelpAndExit(extraMsg?: string) {
  const hostnameExamples = ["google.com", "1.1.1.1", "localhost", "127.0.0.1"];

  // Add examples section to help
  program.addHelpText(
    "after",
    `
Examples:
  $ bun run src/index.ts google.com
  $ bun run src/index.ts --debug ${randomString(hostnameExamples)}
  $ bun run src/index.ts -f -e          # Clean database and exit
  $ bun run src/index.ts -l 100 8.8.8.8 # Load 100 results

Valid targets:
  ${hostnameExamples.join(", ")}

${extraMsg ? `\nError: ${extraMsg}` : ""}`
  );

  program.help();
  process.exit(0);
}

export async function getVersion() {
  const startTime = performance.now();
  // Get remote sha from github latest commit
  let response = await fetch("https://api.github.com/repos/lerndmina/pinger/commits/main");
  let data = await response.json();

  const currentBranch = execSync("git branch --show-current").toString().trim();

  const upstreamSha = data.sha;

  // Get remote version from github latest release
  response = await fetch("https://api.github.com/repos/lerndmina/pinger/releases/latest");
  data = await response.json();

  const upstreamVersion = data.tag_name || "1.0.0";

  // Get local sha from git
  const localSha = execSync("git rev-parse HEAD").toString().trim();

  // Compare local and remote sha
  const isUpToDate = localSha === upstreamSha;

  const executionTime = performance.now() - startTime;

  return { localSha, upstreamVersion, upstreamSha, isUpToDate, currentBranch, executionTime };
}

async function cleanDatabase() {
  const dbPath = join(process.cwd(), "ping_history.sqlite");
  if (!existsSync(dbPath)) {
    console.log("No database found, skipping cleanup");
    return;
  }

  const oldDbPath = join(process.cwd(), "old_db");
  if (!existsSync(oldDbPath)) {
    console.log("Creating old_db folder...");
    mkdirSync(oldDbPath, { recursive: true });
  }

  // Create timestamped backup filename
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(oldDbPath, `ping_history_${timestamp}.sqlite`);

  // Copy current database to backup location
  console.log("Backing up current database...");
  copyFileSync(dbPath, backupPath);

  // Remove original database
  console.log("Removing current database...");
  unlinkSync(dbPath);

  console.log("Database cleanup complete");
}

// Application entry point
async function main() {
  program.parse();
  const options = program.opts();
  const target = program.args[0];

  // Clean database command used
  if (options.fresh) {
    cleanDatabase();
    if (options.exit) {
      process.exit(0);
    }
    // Version command used
  } else if (options.version) {
    const v = await getVersion();
    console.log(`Local Sha: ${v.localSha.slice(0, 7)}`);
    console.log(`Remote Sha: ${v.upstreamSha.slice(0, 7)}`);
    console.log(`Remote Version: ${v.upstreamVersion}`);
    if (!v.isUpToDate) {
      console.log("Your sha differs from the latest release, perhaps you are out of date.");
      console.log("Consider updating:");
      console.log(`  ${GITHUB_URL}/releases/latest`);
      console.log("");
      console.log("Would you like to update automatically? (y/n)");

      // Create readline interface
      const readline = require("readline").createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      // Handle user input
      readline.question("", async (answer: string) => {
        if (answer.toLowerCase() === "y") {
          console.log("Starting update...");
          await update();
        } else {
          console.log("Update cancelled, would you like to run the program?");
          readline.question("", async (answer: string) => {
            if (answer.toLowerCase() === "y") {
              execSync("bun src/index.ts");
            }
            readline.close();
          });
        }
        readline.close();
        process.exit(0);
      });

      return; // Prevent immediate exit
    }
    process.exit(0);
  }

  try {
    const db = new DatabaseService({
      path: join(process.cwd(), "ping_history.sqlite"),
      maxResults: options.loadCount || 50000,
    });

    const lastTarget = db.getLastTarget();
    const selectedTarget = target || lastTarget || "";

    if (!selectedTarget?.trim()) {
      printHelpAndExit("No target provided and no previous target found");
    }

    const pinger = new Pinger(selectedTarget, options);
    await pinger.start();
  } catch (error) {
    console.error("Failed to start Pinger:", error);
    process.exit(1);
  }
}

await main();
