import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { appendFile, writeFile } from "fs/promises";
import chalk from "chalk";
import blessed from "blessed";
import ms from "ms";
import type { LoggerConfig } from "../types/interfaces";
import { DEBUG, MAX_LOG_LINES_BUFFER } from "..";

export class Logger {
  private static isBlessed = false;
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

    const now = new Date();
    const timestamp =
      [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-") +
      "_" +
      [String(now.getHours()).padStart(2, "0"), String(now.getMinutes()).padStart(2, "0")].join(";");
    this.logDir = join(logsBaseDir, timestamp);
    this.logFilePath = join(this.logDir, "pinger.log");
    this.initPromise = this.ensureLogFile();
  }

  public static setUIActive(active: boolean) {
    Logger.isBlessed = active;
  }

  private formatLogMessage(message: string): string {
    // Handle multi-line messages
    const lines = message.split("\n");
    return lines
      .map((line) => {
        if (line.length > this.maxLogLength) {
          return line.substring(0, this.maxLogLength - 3) + "...";
        }
        return line;
      })
      .join("\n");
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

    // Only show debug logs when DEBUG env variable is set
    if (!(level === "DEBUG" && !DEBUG)) {
      this.latestLogs.push(displayEntry);
      if (this.latestLogs.length > MAX_LOG_LINES_BUFFER) {
        this.latestLogs.shift();
      }
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

    // Console output (only when blessed UI is not active)
    if (!Logger.isBlessed) {
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

  public getFilesInDir(dir: string): string[] {
    if (!existsSync(dir)) {
      return [];
    }

    return readdirSync(dir);
  }

  public cleanup(age: string) {
    const ageMs = ms(age);
    if (!ageMs) {
      this.log(`Invalid age format: ${age} unable to cleanup logs`, "WARN");
      return;
    }

    const now = Date.now();
    const files = this.getFilesInDir(this.logDir);
    if (files.length === 0) {
      this.log(`No log files found in ${this.logDir}`, "DEBUG");
      return;
    }
    for (const file of files) {
      const filePath = join(this.logDir, file);
      const stats = statSync(filePath);
      if (now - stats.mtimeMs > ageMs) {
        unlinkSync(filePath);
        this.log(`Deleted log file: ${file}`, "DEBUG");
      }
    }
  }
}
