import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "fs";
import { join } from "path";
import { appendFile, writeFile } from "fs/promises";
import chalk from "chalk";
import blessed from "blessed";
import ms from "ms";
import type { LoggerConfig, LogLevel } from "../types/interfaces";
import { DEBUG, MAX_LOG_LINES_BUFFER } from "..";

export class Logger {
  private static isBlessed = false;
  private logDir: string;
  private logFilePath: string;
  private initialized: boolean = false;
  private latestLogs: string[] = [];
  private logUpdateCallback?: (logs: string[]) => void;
  private initPromise: Promise<void>;

  constructor(config?: LoggerConfig) {
    // Set defaults or use provided config
    const logsBaseDir = config?.baseDir || join(process.cwd(), "src", "logs");

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
    const lines = message.split("\n");
    return lines
      .map((line, index) => {
        // Add indentation for all lines except first
        return index === 0 ? line : "    " + line;
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

  public log(message: string, level: LogLevel = "INFO") {
    const timestamp = new Date().toISOString();
    const formattedMessage = this.formatLogMessage(message);
    const logEntry = `[${timestamp}] [${level}] ${formattedMessage}`;

    // Split multiline entry and strip timestamp from each line
    const displayLines = logEntry.split("\n").map((line) => line.replace(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\]\s/, ""));

    if (!(level === "DEBUG" && !DEBUG)) {
      this.latestLogs.push(...displayLines);
      while (this.latestLogs.length > MAX_LOG_LINES_BUFFER) {
        this.latestLogs.shift();
      }
    }

    // Update UI with proper blessed formatting for each line
    if (this.logUpdateCallback) {
      const colorizedLogs = this.latestLogs.map((log) => {
        if (log.includes("[ERROR]")) return `{red-fg}${log}{/red-fg}`;
        if (log.includes("[WARN]")) return `{yellow-fg}${log}{/yellow-fg}`;
        if (log.includes("[DEBUG]")) return `{blue-fg}${log}{/blue-fg}`;
        return `{green-fg}${log}{/green-fg}`;
      });
      this.logUpdateCallback(colorizedLogs);
    }

    // File writing with preserved formatting
    this.initPromise.then(() => {
      appendFile(this.logFilePath, logEntry + "\n").catch((err) => console.error("Failed to write to log file:", err));
    });
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
