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
  exitData?: ExitData;
}

interface ExitData {
  exitCode: string;
  message: string;
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
      return new Response(
        `
Pinger Analytics API Documentation
================================

This API endpoint collects analytics data from Pinger sessions and forwards them to PostHog.

Endpoint:
---------
POST /

Headers:
--------
Content-Type: application/json

Request Body:
------------
{
    "sessionId": string,    // Unique identifier for the session
    "timestamp": number,    // Unix timestamp of the session
    "duration": number,     // Session duration in milliseconds
    "totalPings": number,   // Total number of pings in the session
    "successRate": number,  // Success rate as a decimal (0-1)
    "avgLatency": number,   // Average latency in milliseconds
    "platform": string      // Platform identifier
}

Response:
---------
200 OK: Successfully processed
400 Bad Request: Invalid payload
405 Method Not Allowed: Wrong HTTP method

CORS:
-----
The API supports CORS with the following:
- Allowed Origins: *
- Allowed Methods: POST
- Allowed Headers: Content-Type

Note: Analytics collection may be disabled by the server configuration.
        `,
        { status: 405 }
      );
    }

    // Skip if analytics disabled
    if (!env.ANALYTICS_ALLOWED) {
      return new Response("OK", { status: 200 });
    }

    try {
      const data: AnalyticsEvent = await request.json();

      // Check that data is valid
      if (!data.sessionId || !data.timestamp || !data.duration || !data.totalPings || !data.successRate || !data.avgLatency || !data.platform) {
        throw new Error("Invalid payload, missing required fields. Request GET / for documentation.");
      }

      console.log(data);

      // Send to PostHog
      const res = await fetch("https://eu.i.posthog.com/capture", {
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
            exitData: data.exitData,
          },
        }),
      });

      if (!res.ok) {
        console.log("error", "Failed to send data to PostHog", res.status, await res.text());
        throw new Error("Failed to send data to PostHog");
      }

      return new Response("OK", { status: 200 });
    } catch (error) {
      return new Response("Invalid request", { status: 400 });
    }
  },
};
