# Skylight MCP Server

An MCP (Model Context Protocol) server for the Skylight Calendar API. Enables AI assistants like Claude to interact with your Skylight family calendar, chores, lists, and more.

## Features

- **Calendar**: Query calendar events ("What's on my calendar today?")
- **Chores**: View and create chores ("Add emptying dishwasher to chores")
- **Lists**: View grocery and to-do lists ("What's on the grocery list?")
- **Tasks**: Add items to the task box ("Add XYZ to my task list")
- **Family**: View family members and devices
- **Rewards**: Check reward points and available rewards

## Quick Start

### Installation

#### Option 1: npm package (Recommended)

**mcp.json:**
```json
{
  "mcpServers": {
    "skylight": {
      "command": "npx",
      "args": ["@eaglebyte/skylight-mcp"],
      "env": {
        "SKYLIGHT_ACCESS_TOKEN": "your_access_token",
        "SKYLIGHT_REFRESH_TOKEN": "your_refresh_token",
        "SKYLIGHT_DEVICE_FINGERPRINT": "your_device_fingerprint",
        "SKYLIGHT_FRAME_ID": "your_frame_id"
      }
    }
  }
}
```

**Claude Code:**
```bash
claude mcp add skylight npx @eaglebyte/skylight-mcp \
  -e SKYLIGHT_ACCESS_TOKEN=your_access_token \
  -e SKYLIGHT_REFRESH_TOKEN=your_refresh_token \
  -e SKYLIGHT_DEVICE_FINGERPRINT=your_device_fingerprint \
  -e SKYLIGHT_FRAME_ID=your_frame_id
```

#### Option 2: From source

```bash
git clone https://github.com/TheEagleByte/skylight-mcp.git
cd skylight-mcp && npm install && npm run build
```

Then use in mcp.json:
```json
{
  "mcpServers": {
    "skylight": {
      "command": "node",
      "args": ["/path/to/skylight-mcp/dist/index.js"],
      "env": {
        "SKYLIGHT_ACCESS_TOKEN": "your_access_token",
        "SKYLIGHT_REFRESH_TOKEN": "your_refresh_token",
        "SKYLIGHT_DEVICE_FINGERPRINT": "your_device_fingerprint",
        "SKYLIGHT_FRAME_ID": "your_frame_id"
      }
    }
  }
}
```

### Instructions for AI

Copy this into your AI's custom instructions or system prompt:

> You have access to the Skylight MCP server. Skylight is a smart family calendar display that shows calendars, chores, grocery lists, meals, and rewards. Use the Skylight tools to help manage family schedules and organization.
>
> Tips:
> - Call `get_family_members` before assigning chores to get member names
> - Grocery items default to the main grocery list if no list specified
> - Dates accept "today", "tomorrow", day names, or YYYY-MM-DD format
> - Some tools (rewards, meals, photos) require Skylight Plus subscription

## Prerequisites

- Node.js 18+
- A Skylight account with an active subscription
- Your Skylight Frame ID (see [Finding your Frame ID](#finding-your-frame-id))

## Authentication

Skylight migrated their API to OAuth 2.0. The previous `SKYLIGHT_EMAIL` / `SKYLIGHT_PASSWORD` endpoint (`POST /api/sessions`) now returns HTTP 401 "This version of Skylight is no longer supported" and is no longer functional. Two authentication modes are supported:

### Option 1: OAuth refresh token (Recommended)

Capture an access token, refresh token, and device fingerprint from the Skylight web app once. The server uses the refresh token to mint new access tokens automatically as they expire, and persists rotated tokens to disk so cold starts continue from the latest pair.

```env
SKYLIGHT_ACCESS_TOKEN=your_access_token
SKYLIGHT_REFRESH_TOKEN=your_refresh_token
SKYLIGHT_DEVICE_FINGERPRINT=your_device_fingerprint
SKYLIGHT_FRAME_ID=your_frame_id
```

**One-time capture procedure:**

1. Open Chrome or Edge, then open DevTools (F12) and switch to the **Network** tab.
2. Enable **Preserve log** so requests survive the post-login redirect.
3. Browse to `https://app.ourskylight.com` and log in with your Skylight account.
4. In the Network tab filter, type `oauth/token`. Find the **POST** that returned `200`.
5. Copy three values from that request:
   - **Response** tab → `access_token` → `SKYLIGHT_ACCESS_TOKEN`
   - **Response** tab → `refresh_token` → `SKYLIGHT_REFRESH_TOKEN`
   - **Payload** tab (Form Data) → `skylight_api_client_device_fingerprint` → `SKYLIGHT_DEVICE_FINGERPRINT`

You only do this once. After the first run the persistence layer (see [Token Persistence](#token-persistence) below) handles rotation transparently. Re-capture is only needed if the refresh token is invalidated by long inactivity, or if you delete the state file.

### Option 2: Manual bearer token

For users who prefer to manage tokens manually, supply a single bearer token. No automatic refresh; the token expires when Skylight expires it.

```env
SKYLIGHT_TOKEN=your_token_here
SKYLIGHT_AUTH_TYPE=bearer
SKYLIGHT_FRAME_ID=your_frame_id
```

`SKYLIGHT_AUTH_TYPE` accepts `bearer` (default) or `basic`.

### Token Persistence

When using OAuth refresh-token mode (`SKYLIGHT_ACCESS_TOKEN` / `SKYLIGHT_REFRESH_TOKEN` / `SKYLIGHT_DEVICE_FINGERPRINT`), Skylight rotates the refresh token on every refresh — the old refresh token is invalidated the moment a new one is issued. To survive process restarts, the server persists the rotated tokens to a state file on disk:

- **Windows:** `%APPDATA%\skylight-mcp\state.json`
- **macOS:** `~/Library/Application Support/skylight-mcp/state.json`
- **Linux:** `$XDG_DATA_HOME/skylight-mcp/state.json` (default `~/.local/share/skylight-mcp/state.json`)

On startup the server reads tokens from the state file first; the env-var values only **seed** the very first run (or any run after the state file is deleted). You only need to re-capture tokens when:

- The refresh token expires due to long inactivity.
- You delete the state file.
- The state file becomes corrupt (the server logs a warning and falls back to env vars).

To inspect the current state file (token prefixes only, no full secrets are printed):

```bash
node scripts/show-state.mjs
```

The state path can be overridden with the `SKYLIGHT_STATE_FILE` env var, which is useful for tests or running multiple isolated configurations side by side.

### Finding your Frame ID

You still need to find your frame ID (the household identifier):

1. Use a proxy tool ([Proxyman](https://proxyman.io/), [Charles](https://www.charlesproxy.com/), or [mitmproxy](https://mitmproxy.org/))
2. Capture any API request from the Skylight app
3. Look at the URL path: `/api/frames/{frameId}/...`
4. Example: `/api/frames/abc123/chores` → frame ID is `abc123`

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `SKYLIGHT_ACCESS_TOKEN` | Option 1 | OAuth access token captured from the Skylight web app |
| `SKYLIGHT_REFRESH_TOKEN` | Option 1 | OAuth refresh token captured from the Skylight web app |
| `SKYLIGHT_DEVICE_FINGERPRINT` | Option 1 | Device fingerprint captured from the Skylight web app |
| `SKYLIGHT_TOKEN` | Option 2 | Manual bearer token (alternative to OAuth) |
| `SKYLIGHT_AUTH_TYPE` | No | `bearer` (default) or `basic` (Option 2 only) |
| `SKYLIGHT_FRAME_ID` | Yes | Your household frame ID |
| `SKYLIGHT_TIMEZONE` | No | Default timezone (default: `America/New_York`) |
| `SKYLIGHT_STATE_FILE` | No | Override the persisted token state file path |

### Example .env file:

```env
# OAuth refresh-token mode (recommended; capture once from the web app)
SKYLIGHT_ACCESS_TOKEN=your_access_token
SKYLIGHT_REFRESH_TOKEN=your_refresh_token
SKYLIGHT_DEVICE_FINGERPRINT=your_device_fingerprint
SKYLIGHT_FRAME_ID=your_frame_id
SKYLIGHT_TIMEZONE=America/New_York
```

## Available Tools

### Calendar Tools

| Tool | Description |
|------|-------------|
| `get_calendar_events` | Get calendar events for a date range |
| `get_source_calendars` | List connected calendar sources (Google, iCloud, etc.) |

### Chore Tools

| Tool | Description |
|------|-------------|
| `get_chores` | Get chores with optional filters (date, assignee, status) |
| `create_chore` | Create a new chore with optional recurrence |

### List Tools

| Tool | Description |
|------|-------------|
| `get_lists` | Get all available lists |
| `get_list_items` | Get items from a specific list |

### Task Tools

| Tool | Description |
|------|-------------|
| `create_task` | Add a task to the task box |

### Family Tools

| Tool | Description |
|------|-------------|
| `get_family_members` | Get family member profiles |
| `get_frame_info` | Get household/frame information |
| `get_devices` | List Skylight devices |

### Reward Tools

| Tool | Description |
|------|-------------|
| `get_rewards` | Get available rewards |
| `get_reward_points` | Get reward points balance |

## Example Queries

Once configured, you can ask Claude things like:

- "What's on my calendar today?"
- "What chores do I need to do this week?"
- "Add 'take out trash' to my chores for tomorrow"
- "What's on the grocery list?"
- "Add milk to my task list"
- "Who are the family members on Skylight?"
- "How many reward points does each person have?"

## Development

```bash
# Run in development mode (with hot reload)
npm run dev

# Build
npm run build

# Run tests
npm test

# Type check
npm run typecheck
```

## API Documentation

This MCP server is built on top of the reverse-engineered Skylight API. The API endpoints were documented using the [skylight-api](https://github.com/TheEagleByte/skylight-api) project, which converts browser network traffic (HAR files) into an OpenAPI specification.

**API Resources:**
- [Interactive API Docs (Swagger UI)](https://theeaglebyte.github.io/skylight-api/swagger.html)
- [API Reference (ReDoc)](https://theeaglebyte.github.io/skylight-api/redoc.html)
- [OpenAPI Specification](https://theeaglebyte.github.io/skylight-api/openapi/openapi.yaml)

If you discover new API endpoints or find issues with the current documentation, please contribute to the [skylight-api](https://github.com/TheEagleByte/skylight-api) repository.

## Contributing

Contributions are welcome! Here's how you can help:

1. **Fork the repository** and create a feature branch
2. **Make your changes** with clear, descriptive commits
3. **Run tests** (`npm test`) and linting (`npm run lint`) before submitting
4. **Open a pull request** with a description of your changes

### Development Setup

```bash
git clone https://github.com/TheEagleByte/skylight-mcp.git
cd skylight-mcp
npm install
npm run dev  # Start with hot reload
```

### Areas for Contribution

- Adding support for new Skylight API endpoints
- Improving error handling and edge cases
- Enhancing documentation
- Writing additional tests

## Issues & Support

- **Bug reports**: [Open an issue](https://github.com/TheEagleByte/skylight-mcp/issues/new) with steps to reproduce
- **Feature requests**: [Open an issue](https://github.com/TheEagleByte/skylight-mcp/issues/new) describing the use case
- **Questions**: [Start a discussion](https://github.com/TheEagleByte/skylight-mcp/discussions) or open an issue

Please include relevant details like your Node.js version, error messages, and configuration (with sensitive values redacted).

## License

MIT

## Disclaimer

This is an unofficial integration. The Skylight API is reverse-engineered and may change without notice. Use at your own risk.
