# Contributing

This repo packages elmah.io as an AI plugin: skills, an agent, and MCP wiring
for Claude Code, Cursor, and any other MCP-compatible editor. Contributions —
new skills, fixes to existing ones, editor support — are welcome.

## Adding or editing a skill

Skills live in `skills/<skill-name>/SKILL.md`.

**Naming**: kebab-case, leading with the action the user is trying to take —
`debug-production-error`, `check-uptime-status`. Prefer a verb the user would
actually say over a noun describing the domain.

**Frontmatter**: every `SKILL.md` needs

```yaml
---
name: skill-name
description: What it does, and when an agent should reach for it.
---
```

`description` is what the model uses to decide whether to invoke the skill
unprompted, so be specific about the trigger ("the user shares an error ID,
message text, or stack trace") rather than generic ("helps with errors").

**Body**: follow the existing skills as the template — a "When To Use" list, a
numbered "Workflow" naming the exact MCP tools to call and in what order, an
"Output Shape" example, and a "Guardrails" section covering what not to do
(don't fabricate data, ask before guessing which log, cap list lengths, etc.).
Guardrails are load-bearing: they're usually there because an earlier version
did the wrong thing.

## Adding or editing the agent

`agents/deployment-watchdog.md` follows the same frontmatter idea, plus
`model`, `background`, and other fields documented in [Claude Code's plugin
reference](https://code.claude.com/docs/en/plugins-reference). Use a real
model identifier (`sonnet`, `opus`, `haiku`) — not `fast`, which is a Claude
Code session toggle, not a valid subagent model value.

## MCP wiring

Two files at the repo root both define the same MCP server, in the shape each
editor expects, and both are auto-discovered by convention (neither is
referenced from `plugin.json`):

- `.mcp.json` — Claude Code
- `mcp.json` — Cursor

If you change the server URL or auth shape, update both.

## Testing your change

Before opening a PR, run the eval suite in `tests/` — it drives the real
`claude` CLI against a mock MCP server with synthetic fixture data, so it
needs no elmah.io credential:

```sh
cd tests
npm install
ANTHROPIC_API_KEY=sk-... node run-eval.mjs
```

If you added or changed a skill's workflow, add or update the matching
`tests/<skill-name>/eval.yaml` scenario. See `tests/README.md` for the
assertion schema. CI runs the full suite on every push and PR.

## Manifests

`.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json` hold per-editor
metadata (name, description, keywords). Skills and agents are auto-discovered
from `skills/` and `agents/` — don't add `"skills"` or `"agents"` path fields
to `plugin.json`; a directory string there fails Claude Code's manifest
validation and breaks plugin loading entirely.

## License

Contributions are accepted under the repo's [Apache 2.0 license](LICENSE).
