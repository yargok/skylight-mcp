#!/usr/bin/env node
/**
 * Smoke test for the Skylight OAuth refresh + persistence flow.
 *
 * On each run:
 *   1. Loads the most recent refresh token (state file if present, else .env).
 *   2. Refreshes via /oauth/token.
 *   3. Persists the rotated tokens to the state file atomically.
 *   4. Calls GET /api/user with the refreshed access token.
 *   5. Re-reads the state file and asserts it contains the rotated tokens.
 *
 * Re-running this script without re-seeding .env exercises the persistence
 * path: the second run reads tokens written by the first run.
 *
 * Token values are printed as PREFIXES only (first 8 chars) — full secrets
 * never land on stdout.
 *
 * Usage:  npm run build && node scripts/test-auth.mjs
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { refreshAccessToken } from "../dist/api/auth.js";
import { BROWSER_HEADERS } from "../dist/api/headers.js";
import {
  getDefaultStatePath,
  readStateFile,
  writeStateFileAtomic,
} from "../dist/api/token-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const BASE_URL = "https://app.ourskylight.com";

function loadDotEnv() {
  const envPath = path.join(PROJECT_ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(`.env file not found at ${envPath}`);
  }
  const content = fs.readFileSync(envPath, "utf8");
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function prefix(s) {
  if (!s) return "<none>";
  return `${s.slice(0, 8)}...`;
}

async function main() {
  console.log("=== Skylight OAuth refresh + persistence smoke test ===");

  const env = loadDotEnv();
  const fingerprint = env.SKYLIGHT_DEVICE_FINGERPRINT;
  if (!fingerprint) {
    console.error("FAIL: .env is missing SKYLIGHT_DEVICE_FINGERPRINT");
    process.exit(1);
  }

  const statePath = getDefaultStatePath();
  console.log(`State file path: ${statePath}`);

  const stored = readStateFile(statePath);
  let activeRefreshToken;
  let source;
  if (stored) {
    activeRefreshToken = stored.refreshToken;
    source = `state file (rotated ${new Date(stored.rotatedAt).toISOString()})`;
  } else {
    activeRefreshToken = env.SKYLIGHT_REFRESH_TOKEN;
    source = ".env (no state file present yet)";
    if (!activeRefreshToken) {
      console.error("FAIL: no state file present and .env is missing SKYLIGHT_REFRESH_TOKEN");
      process.exit(1);
    }
  }

  console.log(`Token source: ${source}`);
  console.log(`Current refresh_token: ${prefix(activeRefreshToken)}`);
  console.log(`device_fingerprint:    ${prefix(fingerprint)}`);

  console.log("\nStep 1: POST /oauth/token (grant_type=refresh_token)");
  let refreshed;
  try {
    refreshed = await refreshAccessToken(activeRefreshToken, fingerprint);
  } catch (err) {
    console.error(`FAIL: refresh threw: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
  console.log(`  PASS new access_token:  ${prefix(refreshed.accessToken)}`);
  console.log(`  PASS new refresh_token: ${prefix(refreshed.refreshToken)}`);
  console.log(
    `  expires_in=${refreshed.expiresInSeconds}s, scope=${refreshed.scope}, token_type=${refreshed.tokenType}`
  );

  if (refreshed.refreshToken === activeRefreshToken) {
    console.warn("  WARN: new refresh_token is identical to old (no rotation observed)");
  }

  console.log("\nStep 2: persist rotated tokens to state file (atomic write)");
  try {
    writeStateFileAtomic(statePath, {
      schemaVersion: 1,
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      rotatedAt: Date.now(),
    });
    console.log(`  PASS wrote ${statePath}`);
  } catch (err) {
    console.error(`FAIL: writeStateFileAtomic threw: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  console.log("\nStep 3: GET /api/user with refreshed access token");
  const userResp = await fetch(`${BASE_URL}/api/user`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${refreshed.accessToken}`,
      Accept: "application/json",
      ...BROWSER_HEADERS,
    },
  });
  console.log(`  status=${userResp.status}`);
  if (!userResp.ok) {
    const errBody = await userResp.text();
    console.error(`FAIL: /api/user returned ${userResp.status}: ${errBody.slice(0, 300)}`);
    process.exit(1);
  }
  const userJson = await userResp.json();
  const sub = userJson?.data?.attributes?.subscription_status;
  const id = userJson?.data?.id;
  console.log(`  PASS user id=${id ?? "<missing>"}, subscription_status=${sub ?? "<missing>"}`);

  console.log("\nStep 4: re-read state file and verify it contains the rotated tokens");
  const reread = readStateFile(statePath);
  if (!reread) {
    console.error(`FAIL: state file at ${statePath} could not be read after write`);
    process.exit(1);
  }
  if (reread.accessToken !== refreshed.accessToken) {
    console.error(
      `FAIL: state file accessToken (${prefix(reread.accessToken)}) does not match refreshed (${prefix(refreshed.accessToken)})`
    );
    process.exit(1);
  }
  if (reread.refreshToken !== refreshed.refreshToken) {
    console.error(
      `FAIL: state file refreshToken (${prefix(reread.refreshToken)}) does not match refreshed (${prefix(refreshed.refreshToken)})`
    );
    process.exit(1);
  }
  console.log(`  PASS state file contains rotated tokens`);
  console.log(`  state.accessToken:  ${prefix(reread.accessToken)}`);
  console.log(`  state.refreshToken: ${prefix(reread.refreshToken)}`);
  console.log(`  state.rotatedAt:    ${new Date(reread.rotatedAt).toISOString()}`);

  console.log("\n=== ALL CHECKS PASSED ===");
}

main().catch((err) => {
  console.error("UNEXPECTED FAILURE:", err);
  process.exit(1);
});
