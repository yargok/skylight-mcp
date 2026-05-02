#!/usr/bin/env node
/**
 * Print the location and contents of the Skylight token state file.
 * Token values are shown as PREFIXES only (first 8 chars) — full secrets
 * are never printed.
 *
 * Usage:  npm run build && node scripts/show-state.mjs
 */

import * as fs from "node:fs";
import { getDefaultStatePath, readStateFile } from "../dist/api/token-store.js";

function prefix(s) {
  if (!s) return "<none>";
  return `${s.slice(0, 8)}...`;
}

const filePath = getDefaultStatePath();
console.log(`State file path: ${filePath}`);

if (!fs.existsSync(filePath)) {
  console.log("State file does not exist.");
  console.log(
    "  This is normal on first run — the server will write to this path the first time it refreshes a token."
  );
  console.log("  Until then, tokens are seeded from SKYLIGHT_ACCESS_TOKEN / SKYLIGHT_REFRESH_TOKEN.");
  process.exit(0);
}

const stat = fs.statSync(filePath);
console.log(`File size: ${stat.size} bytes`);
console.log(`Modified:  ${stat.mtime.toISOString()}`);

const stored = readStateFile(filePath);
if (!stored) {
  console.log("State file exists but is malformed.");
  console.log("  The server will fall back to env vars on the next run.");
  console.log("  To recover: delete this file, then provide fresh SKYLIGHT_ACCESS_TOKEN / SKYLIGHT_REFRESH_TOKEN values.");
  process.exit(1);
}

console.log("");
console.log(`Schema version: ${stored.schemaVersion}`);
console.log(`Access token:   ${prefix(stored.accessToken)}`);
console.log(`Refresh token:  ${prefix(stored.refreshToken)}`);
console.log(
  `Rotated at:     ${new Date(stored.rotatedAt).toISOString()} (${stored.rotatedAt} ms since epoch)`
);
