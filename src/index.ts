import blessed from "blessed";
import * as contrib from "blessed-contrib";
import chalk from "chalk";

interface PingStats {
  totalPings: number;
  successful: number;
  failed: number;
  latencies: number[];
}

class Pinger {
  private stats: PingStats = {
    totalPings: 0,
    successful: 0,
    failed: 0,
    latencies: [],
  };

  private currentDimensions = {
    width: process.stdout.columns,
    height: process.stdout.rows,
  };

  private screen: blessed.Widgets.Screen;
  private grid!: contrib.grid;
  private table: any;
  private chart: any;
  private target: string;
  private isRunning = true;
  private latencyHistory: number[] = [];

  constructor(target: string) {
    this.target = target;

    // Initialize blessed screen
    this.screen = blessed.screen({
      smartCSR: true,
      title: `Pinging ${target}`,
      fullUnicode: true,
      autoPadding: true,
      // Add handler directly in options
      handleUncaughtExceptions: true,
    });

    this.createLayout();

    // Handle exit
    this.screen.key(["escape", "q", "C-c"], () => {
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

    // Add stats table
    this.table = this.grid.set(0, 0, 6, 6, contrib.table, {
      keys: true,
      fg: "white",
      selectedFg: "white",
      selectedBg: "blue",
      interactive: false,
      label: "Statistics",
      width: "50%",
      height: "50%",
      border: { type: "line", fg: "cyan" },
      columnSpacing: 2,
      columnWidth: [15, 20],
    });

    // Add latency chart
    this.chart = this.grid.set(6, 0, 6, 12, contrib.line, {
      style: { line: "yellow", text: "green", baseline: "cyan" },
      xLabelPadding: 3,
      xPadding: 5,
      showLegend: true,
      wholeNumbersOnly: false,
      label: "Latency History",
    });
  }

  private calculatePercentile(arr: number[], percentile: number): number {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index];
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

  private updateDisplay() {
    const successRate = (this.stats.successful / this.stats.totalPings) * 100;
    const failRate = (this.stats.failed / this.stats.totalPings) * 100;

    // Update table data
    this.table.setData({
      headers: ["Metric", "Value"],
      data: [
        ["Total Pings", this.stats.totalPings.toString()],
        ["Successful", `${this.stats.successful} (${successRate.toFixed(1)}%)`],
        ["Failed", `${this.stats.failed} (${failRate.toFixed(1)}%)`],
        ["Min Latency", this.stats.latencies.length ? Math.min(...this.stats.latencies).toFixed(2) + " ms" : "N/A"],
        ["Max Latency", this.stats.latencies.length ? Math.max(...this.stats.latencies).toFixed(2) + " ms" : "N/A"],
        ["Avg Latency", this.stats.latencies.length ? (this.stats.latencies.reduce((a, b) => a + b, 0) / this.stats.latencies.length).toFixed(2) + " ms" : "N/A"],
        ["99th %ile", this.stats.latencies.length ? this.calculatePercentile(this.stats.latencies, 99).toFixed(2) + " ms" : "N/A"],
      ],
    });

    // Update chart data
    this.latencyHistory.push(this.stats.latencies[this.stats.latencies.length - 1] || 0);
    if (this.latencyHistory.length > 30) this.latencyHistory.shift();

    this.chart.setData([
      {
        title: "Latency",
        x: [...Array(this.latencyHistory.length)].map((_, i) => (i + 1).toString()),
        y: this.latencyHistory,
      },
    ]);

    this.screen.render();
  }

  public async start() {
    while (this.isRunning) {
      try {
        const latency = await this.ping();
        this.stats.successful++;
        this.stats.latencies.push(latency);
      } catch {
        this.stats.failed++;
      }
      this.stats.totalPings++;
      this.updateDisplay();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  public stop() {
    this.isRunning = false;
  }
}

// Handle command line arguments
const target = process.argv[2];
if (!target) {
  console.error(chalk.red("Please provide a target URL or IP address"));
  process.exit(1);
}

const pinger = new Pinger(target);
pinger.start();
