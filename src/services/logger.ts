import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { appendFile, writeFile } from "fs/promises";
import chalk from "chalk";
import blessed from "blessed";
import type { LoggerConfig } from "../types/interfaces";

export class Logger {
  private logDir: string;
  private logFilePath: string;
  private initialized: boolean = false;
  private latestLogs: string[] = [];
  private logUpdateCallback?: (logs: string[]) => void;
  private initPromise: Promise<void>;
  private maxLogLength: number;

  constructor(config?: LoggerConfig) {
    // Set defaults or use provided config
    const logsBaseDir = config?.baseDir || join(process.cwd(), "src", "logs");
    this.maxLogLength = config?.maxLogLength || 80;

    if (!existsSync(logsBaseDir)) {
      mkdirSync(logsBaseDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:]/g, "-").split("T")[0] + "-" + new Date().toTimeString().split(" ")[0].replace(/:/g, "-");
    this.logDir = join(logsBaseDir, timestamp);
    this.logFilePath = join(this.logDir, "pinger.log");
    this.initPromise = this.ensureLogFile();
  }

  private formatLogMessage(message: string): string {
    if (message.length > this.maxLogLength) {
      return message.substring(0, this.maxLogLength - 3) + "...";
    }
    return message;
  }

  public setLogUpdateCallback(callback: (logs: string[]) => void) {
    this.logUpdateCallback = callback;
    if (this.latestLogs.length > 0) {
      callback(this.latestLogs);
    }
  }

  private async ensureLogFile() {
    if (this.initialized) return;

    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }

    await writeFile(this.logFilePath, `Pinger Log Started: ${new Date().toISOString()}\n`, { flag: "w" });
    this.initialized = true;
  }

  public log(message: string, level: "INFO" | "WARN" | "ERROR" | "DEBUG" = "INFO") {
    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatLogMessage(message);
    const logEntry = `[${timestamp}] [${level}] ${formattedMessage}`;

    // Strip timestamp for display using regex
    const displayEntry = logEntry.replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]\s/, "");
    this.latestLogs.push(displayEntry);
    if (this.latestLogs.length > 12) {
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
