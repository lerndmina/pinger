import { Toucan } from "toucan-js";

interface Env {
  POSTHOG_API_KEY: string;
  ANALYTICS_ALLOWED: boolean;
}

interface AnalyticsEvent {
  sessionId: string;
  timestamp: number;
  duration: number;
  totalPings: number;
  successRate: number;
  avgLatency: number;
  platform: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Basic CORS setup
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    // Only allow POST
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    // Skip if analytics disabled
    if (!env.ANALYTICS_ALLOWED) {
      return new Response("OK", { status: 200 });
    }

    try {
      const data: AnalyticsEvent = await request.json();

      // Send to PostHog
      await fetch("https://app.posthog.com/capture", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: env.POSTHOG_API_KEY,
          event: "pinger_session",
          properties: {
            distinct_id: data.sessionId,
            timestamp: new Date(data.timestamp).toISOString(),
            duration_ms: data.duration,
            total_pings: data.totalPings,
            success_rate: data.successRate,
            avg_latency: data.avgLatency,
            platform: data.platform,
          },
        }),
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      return new Response("Invalid request", { status: 400 });
    }
  },
};
