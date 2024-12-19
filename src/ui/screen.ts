import blessed from "blessed";
import * as contrib from "blessed-contrib";
import { Logger } from "../services/logger";
import type { PingStats } from "../types/interfaces";
import { MAX_GRAPH_SIZE } from "..";

export class ScreenManager {
  private screen: blessed.Widgets.Screen;
  private grid!: contrib.grid;
  private table: any;
  private chart: any;
  private logBox: any;
  private logBoxWidth: number = 0;
  private logger: Logger;
  private currentLayout: any[] = [];
  private stats: PingStats = {
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
  private latencyHistory: number[] = [];
  private target: string;

  constructor(target: string, logger: Logger) {
    this.target = target;
    this.logger = logger;
    this.screen = this.initScreen();
    Logger.setUIActive(true);
  }

  private initScreen(): blessed.Widgets.Screen {
    const screen = blessed.screen({
      smartCSR: true,
      title: `Pinging ${this.target}`,
      fullUnicode: true,
      autoPadding: true,
      handleUncaughtExceptions: true,
      terminal: "xterm-256color", // Force consistent terminal type
    });

    // Add robust resize handler
    let resizeTimeout: number;
    screen.on("resize", () => {
      // Debounce resize events
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = setTimeout(() => {
        // Clear and recreate everything
        this.clearScreen();
        this.createLayout();
        this.screen.render();
      }, 100) as unknown as number; // Cast the timeout ID to number
    });

    // Handle exit
    screen.key(["escape", "q", "C-c"], () => {
      this.destroy();
      process.exit(0);
    });

    return screen;
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

  private wrapText(text: string, width: number): string {
    // Handle empty or undefined text
    if (!text) return "";

    // Pre-process the text to handle existing line breaks
    const paragraphs = text.split("\n");
    const wrappedParagraphs = paragraphs.map((paragraph) => {
      // Initialize variables for current line tracking
      let currentLine = "";
      const lines: string[] = [];

      // Split into words but preserve special characters and spacing
      const tokens = paragraph.split(/(\s+)/).filter((token) => token.length > 0);

      for (const token of tokens) {
        // If adding this token would exceed width
        if ((currentLine + token).length > width) {
          // If the token itself is longer than width, split it
          if (token.length > width) {
            // Push current line if it exists
            if (currentLine) {
              lines.push(currentLine.trimEnd());
              currentLine = "";
            }
            // Split long token into chunks
            let remainingToken = token;
            while (remainingToken.length > width) {
              lines.push(remainingToken.slice(0, width));
              remainingToken = remainingToken.slice(width);
            }
            currentLine = remainingToken;
          } else {
            // Push current line and start new one with token
            if (currentLine) {
              lines.push(currentLine.trimEnd());
            }
            currentLine = token;
          }
        } else {
          // Add token to current line
          currentLine += token;
        }
      }
      // Push any remaining text
      if (currentLine) {
        lines.push(currentLine.trimEnd());
      }
      return lines.join("\n");
    });

    return wrappedParagraphs.join("\n");
  }
  public createLayout() {
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
      wrap: true,
      mouse: true,
      scrollable: true,
      alwaysScroll: true,
      scrollbar: {
        ch: "┃",
        track: {
          bg: "black",
        },
        style: {
          fg: "black",
        },
      },
    });

    this.logBoxWidth = this.logBox.width - 4; // Account for borders

    // Update log width on resize
    this.screen.on("resize", () => {
      this.logBoxWidth = this.logBox.width - 2;
    });

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
        const wrappedLogs = logs.map((log) => this.wrapText(log, this.logBoxWidth));
        this.logBox.setItems(wrappedLogs);
        this.logBox.setScrollPerc(100); // Force scroll to bottom
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

  public updateDisplay(stats: PingStats) {
    if (!this.table || !this.chart) {
      this.logger.log("Display components not initialized", "WARN");
      return;
    }

    try {
      this.stats = stats;
      const successRate = (stats.successful / stats.totalPings) * 100;
      const failRate = (stats.failed / stats.totalPings) * 100;

      // Get only the last 50 latency results
      const recentLatencies = stats.latencies.slice(-MAX_GRAPH_SIZE);

      // Update table data
      this.table.setData({
        headers: ["Metric", "Value"],
        data: [
          ["Total Pings", stats.totalPings.toString()],
          ["Successful", `${stats.successful} (${successRate.toFixed(1)}%)`],
          ["Failed", `${stats.failed} (${failRate.toFixed(1)}%)`],
          ["Max Latency", stats.stats.maxLatency.toFixed(2) + " ms"],
          ["Avg Latency", stats.stats.avgLatency.toFixed(2) + " ms"],
          ["99th %ile", stats.stats.percentile99.toFixed(2) + " ms"],
        ],
      });

      // Update chart with only the last 50 points
      this.chart.setData([
        {
          title: "Latency",
          x: [...Array(recentLatencies.length)].map((_, i) => (i + 1).toString()),
          y: recentLatencies,
        },
      ]);

      this.screen.render();
    } catch (error) {
      this.logger.error(`Display update error: ${error}`);
    }
  }

  public destroy() {
    this.clearScreen();
    Logger.setUIActive(false);
    if (this.screen) {
      this.screen.destroy();
    }
  }
}
