import { getConfig, usesOAuthRefresh, type Config } from "../config.js";
import { refreshAccessToken, TokenRefreshError } from "./auth.js";
import { BROWSER_HEADERS } from "./headers.js";
import {
  getDefaultStatePath,
  readStateFile,
  writeStateFileAtomic,
} from "./token-store.js";
import {
  AuthenticationError,
  NotFoundError,
  RateLimitError,
  SkylightError,
} from "../utils/errors.js";

const BASE_URL = "https://app.ourskylight.com";

export type SubscriptionStatus = "plus" | "free" | "trial" | null;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  params?: Record<string, string | boolean | number | undefined>;
  body?: unknown;
}

interface UserResponse {
  data?: {
    id?: string;
    attributes?: {
      subscription_status?: string;
    };
  };
}

/**
 * Skylight API client. Handles OAuth Bearer auth with automatic
 * refresh-on-401 + single retry, or static manual-token mode.
 */
export class SkylightClient {
  private config: Config;
  private statePath: string;
  private accessToken: string;
  private refreshToken: string | null;
  private refreshPromise: Promise<void> | null = null;
  private subscriptionStatus: SubscriptionStatus = null;

  constructor(config?: Config, statePath?: string) {
    this.config = config ?? getConfig();
    this.statePath = statePath ?? getDefaultStatePath();

    if (usesOAuthRefresh(this.config)) {
      // Prefer persisted (rotated) tokens over env-var seed values.
      const stored = readStateFile(this.statePath);
      if (stored) {
        console.error(
          `[client] Using persisted tokens from ${this.statePath} (rotated ${new Date(stored.rotatedAt).toISOString()})`
        );
        this.accessToken = stored.accessToken;
        this.refreshToken = stored.refreshToken;
      } else {
        console.error("[client] No valid persisted state; seeding tokens from env vars.");
        this.accessToken = this.config.accessToken!;
        this.refreshToken = this.config.refreshToken!;
      }
    } else {
      this.accessToken = this.config.token!;
      this.refreshToken = null;
    }
  }

  private getAuthHeader(): string {
    if (usesOAuthRefresh(this.config)) {
      return `Bearer ${this.accessToken}`;
    }
    if (this.config.authType === "basic") {
      return `Basic ${this.accessToken}`;
    }
    return `Bearer ${this.accessToken}`;
  }

  private async performRefresh(): Promise<void> {
    if (!usesOAuthRefresh(this.config) || !this.refreshToken) {
      throw new AuthenticationError(
        "API request returned 401 and no refresh token is available. " +
          "If using SKYLIGHT_TOKEN, capture a fresh token. Otherwise set " +
          "SKYLIGHT_ACCESS_TOKEN / SKYLIGHT_REFRESH_TOKEN / SKYLIGHT_DEVICE_FINGERPRINT for automatic refresh."
      );
    }

    try {
      const result = await refreshAccessToken(this.refreshToken, this.config.deviceFingerprint!);
      this.accessToken = result.accessToken;
      this.refreshToken = result.refreshToken;

      // Persist the rotated pair before releasing the refresh lock so any
      // concurrent waiters that retry next will see a consistent on-disk state.
      try {
        writeStateFileAtomic(this.statePath, {
          schemaVersion: 1,
          accessToken: this.accessToken,
          refreshToken: this.refreshToken,
          rotatedAt: Date.now(),
        });
        console.error(`[client] Persisted rotated tokens to ${this.statePath}`);
      } catch (writeErr) {
        // Don't fail the refresh — in-memory tokens are valid for this process.
        // Cold-start recovery will fall back to env vars (which may be stale).
        console.error(
          `[client] Failed to persist rotated tokens to ${this.statePath}: ${
            writeErr instanceof Error ? writeErr.message : String(writeErr)
          }. Subsequent process starts may need fresh env-var tokens.`
        );
      }
    } catch (err) {
      if (err instanceof TokenRefreshError) {
        throw new AuthenticationError(err.message);
      }
      throw err;
    }
  }

  private buildUrl(
    endpoint: string,
    params?: Record<string, string | boolean | number | undefined>
  ): string {
    const url = new URL(endpoint, BASE_URL);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }

  private async handleResponseError(response: Response, url: string): Promise<never> {
    const status = response.status;

    if (status === 401) {
      console.error(`[client] 401 Unauthorized for ${url}`);
      throw new AuthenticationError(
        "API request returned 401 even after token refresh. Your refresh token may be expired/revoked, " +
          "or your SKYLIGHT_FRAME_ID may not belong to this account."
      );
    }

    if (status === 404) {
      throw new NotFoundError("Resource");
    }

    if (status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      throw new RateLimitError(retryAfter ? parseInt(retryAfter, 10) : undefined);
    }

    let errorMessage = `HTTP ${status}`;
    try {
      const errorBody = await response.text();
      if (errorBody) {
        errorMessage += `: ${errorBody.slice(0, 200)}`;
      }
    } catch {
      // ignore
    }

    throw new SkylightError(errorMessage, "HTTP_ERROR", status, status >= 500);
  }

  async request<T>(endpoint: string, options: RequestOptions = {}, isRetry = false): Promise<T> {
    const { method = "GET", params, body } = options;

    const resolvedEndpoint = endpoint.replace("{frameId}", this.config.frameId);
    const url = this.buildUrl(resolvedEndpoint, params);

    console.error(`[client] ${method} ${url}`);

    const headers: Record<string, string> = {
      Authorization: this.getAuthHeader(),
      Accept: "application/json",
      ...BROWSER_HEADERS,
    };

    if (body) {
      headers["Content-Type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    console.error(`[client] Response: ${response.status}`);

    if (!response.ok) {
      if (response.status === 401 && usesOAuthRefresh(this.config) && !isRetry) {
        console.error("[client] Got 401, attempting OAuth token refresh...");
        // Coalesce concurrent 401s onto a single in-flight refresh.
        if (!this.refreshPromise) {
          this.refreshPromise = this.performRefresh().finally(() => {
            this.refreshPromise = null;
          });
        }
        await this.refreshPromise;
        return this.request<T>(endpoint, options, true);
      }
      await this.handleResponseError(response, url);
    }

    if (response.status === 304) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  async get<T>(
    endpoint: string,
    params?: Record<string, string | boolean | number | undefined>
  ): Promise<T> {
    return this.request<T>(endpoint, { method: "GET", params });
  }

  async post<T>(endpoint: string, body: unknown): Promise<T> {
    return this.request<T>(endpoint, { method: "POST", body });
  }

  get frameId(): string {
    return this.config.frameId;
  }

  get timezone(): string {
    return this.config.timezone;
  }

  hasPlus(): boolean {
    return this.subscriptionStatus === "plus";
  }

  getSubscriptionStatus(): SubscriptionStatus {
    return this.subscriptionStatus;
  }

  /**
   * Snapshot of the currently-active OAuth tokens (useful after a refresh
   * has rotated them, so callers can persist the new refresh_token).
   */
  getTokens(): { accessToken: string; refreshToken: string | null } {
    return { accessToken: this.accessToken, refreshToken: this.refreshToken };
  }

  /**
   * Initialize the client. Calls GET /api/user to determine subscription
   * status — also serves as a connectivity / token-validity check, since a
   * stale access_token will trigger the standard refresh-on-401 path here.
   */
  async initialize(): Promise<void> {
    const user = await this.get<UserResponse>("/api/user");
    const raw = user?.data?.attributes?.subscription_status;
    if (raw === "plus" || raw === "free" || raw === "trial") {
      this.subscriptionStatus = raw;
    } else {
      console.error(
        `[client] /api/user returned unrecognized subscription_status=${JSON.stringify(raw)}; defaulting to 'free'.`
      );
      this.subscriptionStatus = "free";
    }
    console.error(`[client] Subscription status: ${this.subscriptionStatus}`);
  }
}

let clientInstance: SkylightClient | null = null;

export function getClient(): SkylightClient {
  if (!clientInstance) {
    clientInstance = new SkylightClient();
  }
  return clientInstance;
}

/**
 * Initialize the client singleton (fetches /api/user, refreshing the token
 * first if it has already expired) and return it.
 */
export async function initializeClient(): Promise<SkylightClient> {
  const client = getClient();
  await client.initialize();
  return client;
}
