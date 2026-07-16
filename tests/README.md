# Skill evals

Regression tests for the skills in `skills/` and the `deployment-watchdog` agent.
Each scenario sends a real prompt through the real `claude` CLI with this
plugin loaded, but points the MCP connection at a local mock server
(`tests/mocks/server.mjs`) instead of `https://mcp.elmah.io/mcp`, so nothing
here ever touches a real elmah.io account or real production data.

## Why a mock server

This is a public repo. GitHub Actions logs on public repos are visible to
anyone, and these scenarios print the full skill transcript. A mock server
with synthetic, fixed fixture data (`tests/mocks/fixtures.mjs`) means the logs
are safe to be public and assertions are deterministic instead of drifting
with live data. It also means no elmah.io API key is needed anywhere in CI.

## Running locally

```sh
cd tests
npm install
ANTHROPIC_API_KEY=sk-... node run-eval.mjs
```

Run a single scenario by passing a substring of its name:

```sh
node run-eval.mjs "Investigates a specific fatal error"
```

If you're already logged into Claude Code locally and don't want to use an API
key, set `EVAL_NO_BARE=1` instead of `ANTHROPIC_API_KEY`. This falls back to
your session's own OAuth/keychain login. It's not representative of how CI
runs (CI always uses `--bare` + `ANTHROPIC_API_KEY` for a clean, reproducible
environment), but it's convenient for a quick local check.

## Writing a scenario

Each skill/agent directory under `tests/` has an `eval.yaml`:

```yaml
scenarios:
  - name: "Human-readable scenario name"
    prompt: "/elmah-io:skill-name Do the thing with log id ..."
    assertions:
      - type: tool_called          # or tool_not_called
        tool: mcp__elmahio__logs_list
      - type: output_matches       # or output_not_matches
        pattern: "some regex"
        flags: "i"                 # optional, standard JS RegExp flags
    timeout: 120                   # seconds; the agent scenario needs more
```

Skills are invoked explicitly with `/elmah-io:<skill-name> <prompt text>` so
the scenario tests the skill's workflow, not whether the model chooses to
invoke it. The `deployment-watchdog` agent doesn't take that form — its
scenario uses natural language and lets Claude decide to launch it, matching
how a real user would trigger it.

## Fixture data

`tests/mocks/fixtures.mjs` defines one fixed synthetic "test world": two logs
(Production API, Staging API), a deployment on Production followed by a fatal
regression, an unrelated pre-existing noisy error, one down uptime monitor on
Production (Staging is all healthy), and a healthy heartbeat. Timestamps are
computed relative to "now" at request time so fixtures never go stale.
Staging deliberately has no deployments and no incidents, to exercise the
skills' "nothing found" guardrail paths.

## A note on flakiness

These are LLM-driven scenarios, not unit tests — a scenario can occasionally
fail because the model took a slightly different but still reasonable path,
not because anything regressed. If a scenario fails in CI, re-run it once
before treating it as a real bug. Consistent, repeated failures are the
signal worth acting on.

The `deployment-watchdog` scenario is the slowest and most expensive one (it
runs a real background subagent through several tool calls before reporting a
verdict) — expect it to take a few minutes and cost noticeably more than the
skill scenarios.
