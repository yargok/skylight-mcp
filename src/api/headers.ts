/**
 * Shared outbound headers for Skylight API requests.
 *
 * Skylight's API gates on both a date-based version header and on
 * web-client-shaped Origin/Referer/User-Agent. Requests missing these
 * are rejected with 401 "This version of Skylight is no longer supported".
 * Applied to the OAuth refresh call (auth.ts) and authenticated API calls (client.ts).
 */

export const SKYLIGHT_API_VERSION = "2026-04-15";

export const BROWSER_HEADERS: Record<string, string> = {
  "skylight-api-version": SKYLIGHT_API_VERSION,
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  Origin: "https://ourskylight.com",
  Referer: "https://ourskylight.com/",
};
