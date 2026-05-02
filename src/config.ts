import { z } from "zod";

// Config schema supports two auth methods:
// 1. OAuth refresh — access_token + refresh_token + device_fingerprint (preferred,
//    refreshes automatically when the access token expires)
// 2. Manual bearer token — single SKYLIGHT_TOKEN (fallback; no refresh, expires
//    when the captured token expires).
//
// Email/password auth (SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD) is no longer supported
// because Skylight removed the POST /api/sessions endpoint.
const ConfigSchema = z
  .object({
    // OAuth refresh-token mode
    accessToken: z.string().min(1).optional(),
    refreshToken: z.string().min(1).optional(),
    deviceFingerprint: z.string().min(1).optional(),

    // Manual bearer-token fallback
    token: z.string().min(1).optional(),
    authType: z.enum(["bearer", "basic"]).default("bearer"),

    // Required
    frameId: z.string().min(1, "SKYLIGHT_FRAME_ID is required"),

    // Optional
    timezone: z.string().default("America/New_York"),
  })
  .refine(
    (data) => {
      const hasOAuth = !!(data.accessToken && data.refreshToken && data.deviceFingerprint);
      const hasManualToken = !!data.token;
      return hasOAuth || hasManualToken;
    },
    {
      message:
        "Provide either (SKYLIGHT_ACCESS_TOKEN + SKYLIGHT_REFRESH_TOKEN + SKYLIGHT_DEVICE_FINGERPRINT) " +
        "or SKYLIGHT_TOKEN. Email/password auth is no longer supported by the Skylight API.",
    }
  );

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  if (process.env.SKYLIGHT_EMAIL || process.env.SKYLIGHT_PASSWORD) {
    console.error(
      "[config] SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD are set but no longer supported. " +
        "Skylight migrated to OAuth 2.0; the old /api/sessions endpoint returns 401. " +
        "Capture access_token / refresh_token / device_fingerprint from the Skylight web app and use those instead."
    );
  }

  const result = ConfigSchema.safeParse({
    accessToken: process.env.SKYLIGHT_ACCESS_TOKEN,
    refreshToken: process.env.SKYLIGHT_REFRESH_TOKEN,
    deviceFingerprint: process.env.SKYLIGHT_DEVICE_FINGERPRINT,
    token: process.env.SKYLIGHT_TOKEN,
    frameId: process.env.SKYLIGHT_FRAME_ID,
    authType: process.env.SKYLIGHT_AUTH_TYPE || "bearer",
    timezone: process.env.SKYLIGHT_TIMEZONE || "America/New_York",
  });

  if (!result.success) {
    const errors = result.error.errors.map((e) => `  - ${e.message}`).join("\n");
    console.error(`
Skylight MCP Server - Configuration Error

Missing or invalid configuration:
${errors}

Authentication (choose one):
  Option 1 - OAuth refresh-token mode (recommended):
    SKYLIGHT_ACCESS_TOKEN       - Captured from the Skylight web app
    SKYLIGHT_REFRESH_TOKEN      - Captured from the Skylight web app
    SKYLIGHT_DEVICE_FINGERPRINT - Captured from the Skylight web app

  Option 2 - Manual bearer token (no automatic refresh):
    SKYLIGHT_TOKEN     - Captured access token
    SKYLIGHT_AUTH_TYPE - 'bearer' or 'basic' (default: bearer)

Required:
  SKYLIGHT_FRAME_ID - Your frame/household ID

Optional:
  SKYLIGHT_TIMEZONE - Timezone for dates (default: America/New_York)

Email/password auth (SKYLIGHT_EMAIL / SKYLIGHT_PASSWORD) is no longer supported.
The Skylight API migrated to OAuth 2.0; the old /api/sessions endpoint returns 401.
`);
    process.exit(1);
  }

  return result.data;
}

let cachedConfig: Config | null = null;

export function getConfig(): Config {
  if (!cachedConfig) {
    cachedConfig = loadConfig();
  }
  return cachedConfig;
}

/**
 * Check whether config uses OAuth refresh-token mode.
 * False means we're in manual-token fallback mode (no refresh available).
 */
export function usesOAuthRefresh(config: Config): boolean {
  return !!(config.accessToken && config.refreshToken && config.deviceFingerprint);
}
