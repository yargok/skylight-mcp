/**
 * Persistent storage for OAuth tokens across process restarts.
 *
 * Skylight rotates refresh tokens on every refresh — the old refresh_token is
 * invalidated the moment a new one is issued. So we cannot rely on the .env
 * value beyond the first successful refresh; subsequent process starts must
 * read the rotated tokens from disk.
 *
 * State file lives in the user data directory:
 *   Windows: %APPDATA%\skylight-mcp\state.json
 *   macOS:   ~/Library/Application Support/skylight-mcp/state.json
 *   Linux:   $XDG_DATA_HOME/skylight-mcp/state.json (default ~/.local/share/...)
 *
 * The path can be overridden via the SKYLIGHT_STATE_FILE env var (used by tests
 * and by ops tooling that wants to inspect a specific file).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface StoredTokens {
  schemaVersion: 1;
  accessToken: string;
  refreshToken: string;
  rotatedAt: number;
}

const APP_DIR_NAME = "skylight-mcp";
const STATE_FILE_NAME = "state.json";

/**
 * Resolve the platform-appropriate state file path.
 * Honors SKYLIGHT_STATE_FILE env var override (tests, debugging).
 */
export function getDefaultStatePath(): string {
  const override = process.env.SKYLIGHT_STATE_FILE;
  if (override && override.length > 0) {
    return override;
  }

  const home = os.homedir();
  let baseDir: string;

  if (process.platform === "win32") {
    baseDir = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support");
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  }

  return path.join(baseDir, APP_DIR_NAME, STATE_FILE_NAME);
}

/**
 * Read tokens from the state file.
 * Returns null when the file is missing, unreadable, malformed, or schema-incompatible.
 * Callers fall back to env-var seed values.
 */
export function readStateFile(filePath: string): StoredTokens | null {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(
      `[token-store] Could not read state file at ${filePath}: ${(err as Error).message}. Falling back to env vars.`
    );
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(
      `[token-store] State file at ${filePath} is not valid JSON: ${(err as Error).message}. Falling back to env vars.`
    );
    return null;
  }

  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "accessToken" in parsed &&
    "refreshToken" in parsed
  ) {
    const obj = parsed as Record<string, unknown>;
    if (
      typeof obj.accessToken === "string" &&
      typeof obj.refreshToken === "string" &&
      obj.accessToken.length > 0 &&
      obj.refreshToken.length > 0
    ) {
      return {
        schemaVersion: 1,
        accessToken: obj.accessToken,
        refreshToken: obj.refreshToken,
        rotatedAt: typeof obj.rotatedAt === "number" ? obj.rotatedAt : Date.now(),
      };
    }
  }

  console.error(
    `[token-store] State file at ${filePath} is missing required fields (accessToken, refreshToken). Falling back to env vars.`
  );
  return null;
}

/**
 * Write tokens to the state file atomically: write to a temp file, fsync,
 * then rename onto the final path. Prevents half-written files if the process
 * is killed mid-write. Sets file mode 0600 on POSIX (no-op on Windows, which
 * uses ACLs rather than POSIX bits).
 */
export function writeStateFileAtomic(filePath: string, tokens: StoredTokens): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const data = JSON.stringify(tokens, null, 2);

  const fd = fs.openSync(tmpPath, "w", 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  fs.renameSync(tmpPath, filePath);
}
