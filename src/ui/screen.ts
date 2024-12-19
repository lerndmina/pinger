import blessed from "blessed";
import * as contrib from "blessed-contrib";
import type { PingStats } from "../types/interfaces";
import { Logger } from "../services/logger";
import { MAX_GRAPH_SIZE } from "..";

export class ScreenManager {
  private screen: blessed.Widgets.Screen;
  private grid!: contrib.grid;
  private table: any;
  private chart: any;
  private logBox: any;
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
      terminal: "xterm-256color",
    });

    let resizeTimeout: number;
    screen.on("resize", () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        this.clearScreen();
        this.createLayout();
        this.screen.render();
      }, 100) as unknown as number;
    });

    screen.key(["r"], () => {
      this.logger.log("Manual refresh triggered");
      this.clearScreen();
      this.createLayout();
      this.updateDisplay(this.stats);
    });

    screen.key(["escape", "q", "C-c"], () => {
      this.destroy();
      process.exit(0);
    });

    return screen;
  }

  public createLayout() {
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

    // Configure log box using the grid system
    this.logBox = this.grid.set(0, 6, 6, 6, blessed.log, {
      label: "Latest Logs",
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      scrollable: true,
      scrollback: 100,
      border: {
        type: "line",
        fg: "magenta",
      },
      scrollbar: {
        ch: "┃",
        style: {
          fg: "white",
        },
        track: {
          bg: "black",
        },
      },
      style: {
        fg: "green",
        border: {
          fg: "magenta",
        },
      },
    });
    this.currentLayout.push(this.logBox);

    // Add latency chart (full width of bottom section)
    this.chart = this.grid.set(6, 0, 6, 12, contrib.line, {
      style: {
        line: "yellow",
        text: "green",
        baseline: "cyan",
      },
      xLabelPadding: 3,
      xPadding: 5,
      showLegend: true,
      wholeNumbersOnly: false,
      label: "Latency History",
      border: { type: "line" },
    });
    this.currentLayout.push(this.chart);

    // Set up log update callback
    this.logger.setLogUpdateCallback((logs: string[]) => {
      if (this.logBox) {
        // Clear the log box first
        this.logBox.setContent("");

        // Add each log line with proper formatting
        logs.forEach((log) => {
          if (log.includes("[ERROR]")) {
            this.logBox.pushLine(`{red-fg}${log}{/red-fg}`);
          } else if (log.includes("[WARN]")) {
            this.logBox.pushLine(`{yellow-fg}${log}{/yellow-fg}`);
          } else if (log.includes("[DEBUG]")) {
            this.logBox.pushLine(`{blue-fg}${log}{/blue-fg}`);
          } else {
            this.logBox.pushLine(`{green-fg}${log}{/green-fg}`);
          }
        });

        this.logBox.scrollTo(this.logBox.getLines().length);
        this.screen.render();
      }
    });

    // Initialize with existing logs
    const currentLogs = this.logger.getLatestLogs();
    if (currentLogs.length > 0) {
      // Call the callback function with the current logs
      this.logger.setLogUpdateCallback((logs: string[]) => {
        if (this.logBox) {
          this.logBox.setContent("");
          logs.forEach((log) => {
            if (log.includes("[ERROR]")) {
              this.logBox.pushLine(`{red-fg}${log}{/red-fg}`);
            } else if (log.includes("[WARN]")) {
              this.logBox.pushLine(`{yellow-fg}${log}{/yellow-fg}`);
            } else if (log.includes("[DEBUG]")) {
              this.logBox.pushLine(`{blue-fg}${log}{/blue-fg}`);
            } else {
              this.logBox.pushLine(`{green-fg}${log}{/green-fg}`);
            }
          });
          this.logBox.scrollTo(this.logBox.getLines().length);
          this.screen.render();
        }
      });
    }

    this.screen.render();
  }

  private clearScreen() {
    this.currentLayout.forEach((component) => {
      if (component && typeof component.destroy === "function") {
        component.destroy();
      }
    });
    this.currentLayout = [];

    while (this.screen.children.length) {
      const child = this.screen.children[0];
      this.screen.remove(child);
    }
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

      const recentLatencies = stats.latencies.slice(-MAX_GRAPH_SIZE);

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
