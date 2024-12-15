import blessed from "blessed";
import * as contrib from "blessed-contrib";
import chalk from "chalk";
import Database from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appendFile, writeFile } from "fs/promises";

interface PingStats {
  totalPings: number;
  successful: number;
  failed: number;
  latencies: number[];
}

class Logger {
  private logDir: string;
  private logFilePath: string;
  private initialized: boolean = false;
  private latestLogs: string[] = [];
  private logUpdateCallback?: (logs: string[]) => void;
  private initPromise: Promise<void>;
  private maxLogLength: number = 80; // Prevent long lines from breaking layout

  constructor() {
    // Ensure logs directory exists
    const logsBaseDir = join(process.cwd(), "src", "logs");
    if (!existsSync(logsBaseDir)) {
      mkdirSync(logsBaseDir, { recursive: true });
    }

    // Create timestamped log directory
    const timestamp = new Date().toISOString().replace(/[:]/g, "-").split("T")[0] + "-" + new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
    this.logDir = join(logsBaseDir, timestamp);

    // Create log file path
    this.logFilePath = join(this.logDir, "pinger.log");

    // Initialize immediately
    this.initPromise = this.ensureLogFile();
  }

  private formatLogMessage(message: string): string {
    // Truncate long messages to prevent display issues
    if (message.length > this.maxLogLength) {
      return message.substring(0, this.maxLogLength - 3) + "...";
    }
    return message;
  }

  public setLogUpdateCallback(callback: (logs: string[]) => void) {
    this.logUpdateCallback = callback;
    // Send initial logs if any exist
    if (this.latestLogs.length > 0) {
      callback(this.latestLogs);
    }
  }

  private async ensureLogFile() {
    if (this.initialized) return;

    // Create log directory
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    // Create initial log file
    await writeFile(this.logFilePath, `Pinger Log Started: ${new Date().toISOString()}\n`, { flag: "w" });
    this.initialized = true;
  }

  public log(message: string, level: "INFO" | "WARN" | "ERROR" | "DEBUG" = "INFO") {
    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatLogMessage(message);
    const logEntry = `[${timestamp}] [${level}] ${formattedMessage}`;

    // Update latest logs with clean formatting
    this.latestLogs.push(logEntry);
    if (this.latestLogs.length > 6) {
      this.latestLogs.shift();
    }

    // Update UI with proper blessed formatting
    if (this.logUpdateCallback) {
      const colorizedLogs = this.latestLogs.map((log) => {
        if (log.includes("[ERROR]")) return `{red-fg}${log}{/red-fg}`;
        if (log.includes("[WARN]")) return `{yellow-fg}${log}{/yellow-fg}`;
        if (log.includes("[DEBUG]")) return `{blue-fg}${log}{/blue-fg}`;
        return `{green-fg}${log}{/green-fg}`;
      });
      this.logUpdateCallback(colorizedLogs);
    }

    // Handle file writing asynchronously
    this.initPromise.then(() => {
      appendFile(this.logFilePath, logEntry + "\n").catch((err) => console.error("Failed to write to log file:", err));
    });

    // Console output (only when blessed screen is not active)
    if (!blessed.Screen.global) {
      switch (level) {
        case "ERROR":
          console.error(chalk.red(logEntry));
          break;
        case "WARN":
          console.warn(chalk.yellow(logEntry));
          break;
        case "DEBUG":
          console.debug(chalk.blue(logEntry));
          break;
        default:
          console.log(logEntry);
      }
    }
  }

  public error(error: Error | string) {
    const errorMessage = error instanceof Error ? error.stack || error.message : error;
    this.log(errorMessage, "ERROR");
  }

  public getLatestLogs(): string[] {
    return this.latestLogs;
  }
}

class Pinger {
  private logger: Logger;
  private stats: PingStats = {
    totalPings: 0,
    successful: 0,
    failed: 0,
    latencies: [],
  };
  private currentLayout: any[] = [];

  private readonly DB_PATH = "ping_history.sqlite";
  private db: Database;

  private screen!: blessed.Widgets.Screen;
  private grid!: contrib.grid;
  private table: any;
  private chart: any;
  private logBox: any;
  private target!: string;
  private isRunning = true;
  private latencyHistory: number[] = [];

  constructor(target?: string) {
    // Initialize logger
    this.logger = new Logger();

    try {
      // Initialize SQLite database
      this.db = new Database(this.DB_PATH);
      this.initDatabase();

      // Log startup
      this.logger.log(`Pinger started with target: ${target}`, "INFO");

      // Load last target and historical data
      const lastTargetResult = this.db.query("SELECT value FROM settings WHERE key = 'last_target'").get() as { value: string } | null;
      this.target = target || lastTargetResult?.value;

      if (!this.target) {
        throw new Error("No target provided and no previous target found");
      }

      // Log target selection
      this.logger.log(`Target selected: ${this.target}`, "INFO");

      // Load historical stats if same target
      if (lastTargetResult?.value === this.target) {
        this.loadHistoricalStats();
      }

      // Save current target
      this.db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('last_target', ?)", [this.target]);

      // Set up global error handling
      this.setupGlobalErrorHandling();
    } catch (error) {
      this.logger.error(error as Error);
      process.exit(1);
    }
  }

  private clearScreen() {
    // Properly destroy all existing components
    this.currentLayout.forEach((component) => {
      if (component && typeof component.destroy === "function") {
        component.destroy();
      }
    });
    this.currentLayout = [];

    // Clear the screen's children
    while (this.screen.children.length) {
      const child = this.screen.children[0];
      this.screen.remove(child);
    }
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

  private loadHistoricalStats() {
    // Load last 5000 successful pings for in-memory history
    const latencyResults = this.db
      .query(
        `
      SELECT latency 
      FROM ping_results 
      WHERE is_successful = 1 
      ORDER BY id DESC 
      LIMIT 5000
    `
      )
      .all() as { latency: number }[];

    this.latencyHistory = latencyResults.map((r) => r.latency).reverse();

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

    this.stats = {
      totalPings: statsResult.total_pings,
      successful: statsResult.successful_pings,
      failed: statsResult.failed_pings,
      latencies: this.latencyHistory,
    };
  }

  private initScreen() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: `Pinging ${this.target}`,
      fullUnicode: true,
      autoPadding: true,
      handleUncaughtExceptions: true,
      terminal: "xterm-256color", // Force consistent terminal type
    });

    // Initial layout creation
    this.createLayout();

    // Add robust resize handler
    let resizeTimeout: NodeJS.Timeout;
    this.screen.on("resize", () => {
      // Debounce resize events
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = setTimeout(() => {
        // Clear and recreate everything
        this.clearScreen();
        this.createLayout();
        this.updateDisplay();
        this.screen.render();
      }, 100); // Wait for 100ms after last resize event
    });

    // Handle exit with save
    this.screen.key(["escape", "q", "C-c"], () => {
      this.clearScreen();
      this.stop();
      process.exit(0);
    });
  }

  private createLayout() {
    // Create layout grid
    this.grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    // Add stats table (left half of top section)
    this.table = this.grid.set(0, 0, 6, 6, contrib.table, {
      keys: true,
      fg: "white",
      selectedFg: "white",
      selectedBg: "blue",
      interactive: false,
      label: "Statistics",
      border: { type: "line", fg: "cyan" },
      columnSpacing: 2,
      columnWidth: [15, 20],
    });
    this.currentLayout.push(this.table);

    // Configure log box with proper formatting
    this.logBox = this.grid.set(0, 6, 6, 6, contrib.log, {
      fg: "green",
      selectedFg: "green",
      label: "Latest Logs",
      border: { type: "line", fg: "magenta" },
      tags: true,
      style: {
        fg: "green",
        border: {
          fg: "magenta",
        },
      },
      screen: this.screen,
      bufferLength: 6,
    });
    this.currentLayout.push(this.logBox);

    // Add latency chart (full width of bottom section)
    this.chart = this.grid.set(6, 0, 6, 12, contrib.line, {
      style: { line: "yellow", text: "green", baseline: "cyan" },
      xLabelPadding: 3,
      xPadding: 5,
      showLegend: true,
      wholeNumbersOnly: false,
      label: "Latency History",
      border: { type: "line" },
    });
    this.currentLayout.push(this.chart);

    // Set up log update callback with proper screen rendering
    this.logger.setLogUpdateCallback((logs: string[]) => {
      if (this.logBox) {
        this.logBox.setItems(logs);
        this.screen.render();
      }
    });

    // Initialize with existing logs
    const currentLogs = this.logger.getLatestLogs();
    if (currentLogs.length > 0) {
      this.logBox.setItems(currentLogs);
    }

    // Force a clean render
    this.screen.render();
  }

  private calculatePercentile(arr: number[], percentile: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
  }

  private saveResult(latency: number | null, isSuccessful: boolean) {
    // Insert ping result
    this.db.run("INSERT INTO ping_results (latency, is_successful) VALUES (?, ?)", [latency, isSuccessful ? 1 : 0]);

    // Maintain only the last 50,000 results in the database
    this.db.run(`
      DELETE FROM ping_results 
      WHERE id NOT IN (
        SELECT id FROM (
          SELECT id 
          FROM ping_results 
          ORDER BY id DESC 
          LIMIT 50000
        )
      )
    `);
  }

  private updateDisplay() {
    if (!this.table || !this.chart) {
      this.logger.log("Display components not initialized", "WARN");
      return;
    }

    try {
      const successRate = (this.stats.successful / this.stats.totalPings) * 100;
      const failRate = (this.stats.failed / this.stats.totalPings) * 100;

      // Update table data
      this.table.setData({
        headers: ["Metric", "Value"],
        data: [
          ["Total Pings", this.stats.totalPings.toString()],
          ["Successful", `${this.stats.successful} (${successRate.toFixed(1)}%)`],
          ["Failed", `${this.stats.failed} (${failRate.toFixed(1)}%)`],
          ["Max Latency", this.stats.latencies.length ? Math.max(...this.stats.latencies).toFixed(2) + " ms" : "N/A"],
          ["Avg Latency", this.stats.latencies.length ? (this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length).toFixed(2) + " ms" : "N/A"],
          ["99th %ile", this.stats.latencies.length ? this.calculatePercentile(this.stats.latencies, 99).toFixed(2) + " ms" : "N/A"],
        ],
      });

      // Update chart data with last 5000 results
      this.latencyHistory.push(this.stats.latencies[this.stats.latencies.length - 1] || 0);
      if (this.latencyHistory.length > 5000) this.latencyHistory.shift();

      this.chart.setData([
        {
          title: "Latency",
          x: [...Array(this.latencyHistory.length)].map((_, i) => (i + 1).toString()),
          y: this.latencyHistory,
        },
      ]);

      // Ensure clean render
      this.screen.clearRegion(0, this.screen.width, 0, this.screen.height);
      this.screen.render();
    } catch (error) {
      this.logger.error(`Display update error: ${error}`);
    }
  }

  private getPingArgs(): string[] {
    switch (process.platform) {
      case "win32":
        return ["ping", "-n", "1", this.target];
      case "linux":
      case "darwin":
        return ["ping", "-c", "1", this.target];
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  }

  private async ping(): Promise<number> {
    try {
      const proc = Bun.spawn(this.getPingArgs(), {
        stdout: "pipe",
      });

      const output = await new Response(proc.stdout).text();
      const timeMatch = process.platform === "win32" ? output.match(/time[=<](\d+)ms/) : output.match(/time=(\d+\.\d+) ms/);

      if (!timeMatch) throw new Error("Could not parse ping time");
      return parseFloat(timeMatch[1]);
    } catch (err) {
      throw err;
    }
  }

  public async start() {
    try {
      // Initialize screen after data load
      this.initScreen();

      while (this.isRunning) {
        try {
          const latency = await this.ping();
          this.stats.successful++;
          this.stats.latencies.push(latency);
          this.saveResult(latency, true);
          this.logger.log(`Ping successful: ${latency}ms`, "INFO"); // Removed await
        } catch (err) {
          this.stats.failed++;
          this.saveResult(null, false);
          this.logger.log(`Ping failed: ${err}`, "WARN"); // Removed await
        }
        this.stats.totalPings++;
        this.updateDisplay();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (error) {
      this.logger.error(error as Error);
      this.stop();
    }
  }

  public stop() {
    try {
      this.isRunning = false;
      this.db.close();
      this.logger.log("Pinger stopped gracefully", "INFO");
    } catch (error) {
      this.logger.error(error as Error);
    }
  }

  private setupGlobalErrorHandling() {
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
  }
}

// Handle command line arguments
const target = process.argv[2];
const pinger = new Pinger(target);
pinger.start();
