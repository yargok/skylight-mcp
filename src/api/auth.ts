/**
 * Skylight OAuth 2.0 token refresh.
 *
 * Skylight migrated from a custom POST /api/sessions login (email/password)
 * to OAuth 2.0 with /oauth/token. We never run grant_type=authorization_code
 * from this codebase — the user captures access+refresh tokens once via the
 * web app and supplies them via env. We refresh using grant_type=refresh_token
 * whenever the access token expires (signaled by a 401).
 */

import { BROWSER_HEADERS } from "./headers.js";

const BASE_URL = "https://app.ourskylight.com";
const OAUTH_TOKEN_PATH = "/oauth/token";

const OAUTH_CLIENT_ID = "skylight-mobile";
const OAUTH_SCOPE = "everything";

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string;
  expiresInSeconds: number;
  createdAt: number;
}

interface RawOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  scope: string;
  expires_in: number;
  created_at: number;
}

export class TokenRefreshError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string
  ) {
    super(message);
    this.name = "TokenRefreshError";
  }
}

/**
 * Refresh an access token using the OAuth 2.0 refresh_token grant.
 * Skylight rotates BOTH access_token and refresh_token in the response,
 * so callers must persist the new refresh_token if they want continuity
 * across process restarts.
 */
export async function refreshAccessToken(
  refreshToken: string,
  deviceFingerprint: string
): Promise<OAuthTokenResponse> {
  console.error("[auth] Refreshing OAuth access token...");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OAUTH_CLIENT_ID,
    scope: OAUTH_SCOPE,
    skylight_api_client_device_fingerprint: deviceFingerprint,
    skylight_api_client_device_platform: "web",
    skylight_api_client_device_name: "unknown",
    skylight_api_client_device_os_version: "10",
    skylight_api_client_device_app_version: "unknown",
    skylight_api_client_device_hardware: "3",
    source: "js-mobile",
  });

  const response = await fetch(`${BASE_URL}${OAUTH_TOKEN_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...BROWSER_HEADERS,
    },
    body: body.toString(),
  });

  console.error(`[auth] Refresh response status: ${response.status}`);

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new TokenRefreshError(
      `OAuth token refresh failed (HTTP ${response.status}). Your refresh token may be expired or revoked. ` +
        `Re-capture SKYLIGHT_ACCESS_TOKEN and SKYLIGHT_REFRESH_TOKEN from the Skylight web app and update your .env.` +
        (errorBody ? ` Server response: ${errorBody.slice(0, 200)}` : ""),
      response.status,
      errorBody
    );
  }

  const raw = (await response.json()) as RawOAuthTokenResponse;
  console.error(
    `[auth] Refresh successful. new access_token=${raw.access_token.substring(0, 8)}..., ` +
      `new refresh_token=${raw.refresh_token.substring(0, 8)}...`
  );

  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token,
    tokenType: raw.token_type,
    scope: raw.scope,
    expiresInSeconds: raw.expires_in,
    createdAt: raw.created_at,
  };
}
