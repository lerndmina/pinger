import { join } from "path";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { createInterface } from "readline";
import type { PingStats } from "../types/interfaces";
import { Logger } from "./logger";
import { ANALYTICS_SESSION_ID, PROGRAM_START_TIME } from "..";

const ANALYTICS_FILE = join(process.cwd(), "analytics-enabled.txt");
const ANALYTICS_ENDPOINT = "pinger-analytics.lerndmina.workers.dev";

export enum AnalyticsConsent {
  CONSENT = "consent",
  NO_CONSENT = "no-consent",
  NOT_SET = "not-set",
}

const logger = new Logger({
  baseDir: join(process.cwd(), "src", "logs"),
});

export async function writeAnalyticsConsent(consent: boolean): Promise<boolean> {
  writeFileSync(ANALYTICS_FILE, consent.toString());
  logger.log(`Analytics consent set to: ${consent}`);
  return true;
}

export async function askAnalyticsConsent(): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  logger.log("\nWould you like to share anonymous usage statistics to help improve Pinger?");
  logger.log("We only collect session duration, ping counts, and success rates. No personal data is collected.");
  logger.log("You can change this setting later by editing 'analytics-enabled.txt'");

  return new Promise((resolve) => {
    rl.question("Enable analytics? (y/N): ", (answer) => {
      const consent = answer.toLowerCase() === "y";
      writeAnalyticsConsent(consent);
      rl.close();
      resolve(consent);
    });
  });
}

export function checkAnalyticsConsent(): AnalyticsConsent {
  if (!existsSync(ANALYTICS_FILE)) {
    return AnalyticsConsent.NOT_SET;
  }
  return readFileSync(ANALYTICS_FILE, "utf8").trim().toLowerCase() === "true" ? AnalyticsConsent.CONSENT : AnalyticsConsent.NO_CONSENT;
}

interface OtherStatsData {
  platform: string;
  exitData: ExitData | null;
}

interface ExitData {
  exitCode: string;
  message: string;
}

export async function sendAnalytics(stats: PingStats, otherData: OtherStatsData = { platform: process.platform, exitData: null }): Promise<void> {
  if (checkAnalyticsConsent() !== AnalyticsConsent.CONSENT) return;

  const duration = Date.now() - PROGRAM_START_TIME;

  otherData.platform = otherData.platform || process.platform;

  try {
    await fetch(ANALYTICS_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: ANALYTICS_SESSION_ID,
        timestamp: Date.now(),
        duration,
        totalPings: stats.totalPings,
        successRate: stats.successful / stats.totalPings,
        avgLatency: stats.stats.avgLatency,
        platform: otherData.platform,
        exitData: otherData.exitData,
      }),
    });
  } catch (error) {
    // Silently fail analytics
    logger.error("Failed to send analytics data: " + error);
  }
}
