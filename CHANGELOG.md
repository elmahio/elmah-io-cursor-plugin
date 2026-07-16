# Changelog

## 1.2.0 — 2026-07-16

- Fixed an invalid `plugin.json` manifest (`agents` field pointed at a
  directory instead of file paths) that caused Claude Code to reject the
  plugin entirely — no skill or agent worked when installed through the
  marketplace
- Fixed an invalid `model: fast` value on the `deployment-watchdog` agent that
  could cause it to fail to launch
- Added an eval test suite (`tests/`) that runs every skill and the agent
  against a mock MCP server in CI on every push and PR
- Added `CONTRIBUTING.md` and `SECURITY.md`
- Synced `plugin.json` versions with this changelog — 1.1.0 below was never
  reflected in the manifests, so marketplace installs had been stuck on 1.0.0

## 1.1.0 — 2026-06-05

- Generalized from a Cursor-only plugin to a multi-editor AI plugin
- Added `.claude-plugin/plugin.json` manifest for Claude Code
- Updated README with installation instructions for Cursor, Claude Code, and other MCP-compatible editors

## 1.0.0 — 2026-05-26

Initial release.

- MCP server connection to `https://mcp.elmah.io/mcp` via HTTP/OAuth
- Skill: `debug-production-error`
- Skill: `post-deployment-check`
- Skill: `investigate-frequent-errors`
- Skill: `check-uptime-status`
- Agent: `deployment-watchdog`
