#!/usr/bin/env node
// Runs every tests/<skill>/eval.yaml scenario against the mock elmah.io MCP
// server (tests/mocks) using the real `claude` CLI, and checks the transcript
// against each scenario's assertions. Exits non-zero if anything fails.
//
// Requires ANTHROPIC_API_KEY (bare mode auth) unless EVAL_NO_BARE=1, which
// falls back to the ambient session's own OAuth/keychain login for local runs
// without a key — not representative of CI, but useful for a quick local check.
//
// Usage: node run-eval.mjs [scenario-name-substring]

import { spawn } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import yaml from "js-yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const MOCK_SERVER = join(__dirname, "mocks", "server.mjs");
const MCP_CONFIG = join(__dirname, "mocks", "mcp-config.json");

const NO_BARE = process.env.EVAL_NO_BARE === "1";
const FILTER = process.argv[2];

function findEvalFiles() {
  const entries = readdirSync(__dirname, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    if (!e.isDirectory() || e.name === "mocks") continue;
    const p = join(__dirname, e.name, "eval.yaml");
    if (existsSync(p)) files.push({ skill: e.name, path: p });
  }
  return files.sort((a, b) => a.skill.localeCompare(b.skill));
}

function startMockServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, [MOCK_SERVER], { stdio: ["ignore", "pipe", "pipe"] });
    let started = false;
    const onData = (data) => {
      if (!started && data.toString().includes("listening")) {
        started = true;
        proc.stdout.off("data", onData);
        resolve(proc);
      }
    };
    proc.stdout.on("data", onData);
    proc.on("error", reject);
    proc.on("exit", (code) => {
      if (!started) reject(new Error(`Mock MCP server exited early with code ${code}`));
    });
    setTimeout(() => {
      if (!started) reject(new Error("Mock MCP server did not start within 5s"));
    }, 5000);
  });
}

// On Windows, `claude` on PATH resolves to a .cmd shim. Spawning it with
// shell:true routes through cmd.exe, whose batch-file argument escaping is
// broken for shell-metacharacters (parentheses, etc.) on Node < 20.11
// (CVE-2024-27980). Routing through Git Bash's `claude` shell script instead
// avoids cmd.exe entirely and matches how this was verified to work manually.
function spawnClaude(args) {
  if (process.platform === "win32") {
    const quoted = ["claude", ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
    return spawn("bash", ["-c", quoted], { cwd: REPO_ROOT });
  }
  return spawn("claude", args, { cwd: REPO_ROOT });
}

function runClaude(prompt, timeoutSec) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", prompt,
      "--plugin-dir", REPO_ROOT,
      "--mcp-config", MCP_CONFIG,
      "--strict-mcp-config",
      "--permission-mode", "bypassPermissions",
      "--output-format", "stream-json",
      "--verbose",
    ];
    if (!NO_BARE) args.unshift("--bare");

    const proc = spawnClaude(args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error(`timed out after ${timeoutSec}s`));
    }, timeoutSec * 1000);

    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(0, 2000)}`));
        return;
      }
      resolve(stdout);
    });
  });
}

function parseTranscript(stdout) {
  const toolCalls = [];
  const textParts = [];
  for (const line of stdout.split("\n")) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.type === "assistant") {
      for (const block of msg.message?.content ?? []) {
        if (block.type === "tool_use") toolCalls.push(block.name);
        if (block.type === "text") textParts.push(block.text);
      }
    }
    if (msg.type === "result" && typeof msg.result === "string") {
      textParts.push(msg.result);
    }
  }
  return { toolCalls, output: textParts.join("\n\n") };
}

function checkAssertion(assertion, { toolCalls, output }) {
  switch (assertion.type) {
    case "tool_called":
      return toolCalls.includes(assertion.tool)
        ? { pass: true }
        : { pass: false, detail: `expected a call to ${assertion.tool}, saw: ${toolCalls.join(", ") || "(none)"}` };
    case "tool_not_called":
      return !toolCalls.includes(assertion.tool)
        ? { pass: true }
        : { pass: false, detail: `expected no call to ${assertion.tool}, but it was called` };
    case "output_matches": {
      const re = new RegExp(assertion.pattern, assertion.flags ?? "");
      return re.test(output)
        ? { pass: true }
        : { pass: false, detail: `output did not match /${assertion.pattern}/${assertion.flags ?? ""}` };
    }
    case "output_not_matches": {
      const re = new RegExp(assertion.pattern, assertion.flags ?? "");
      return !re.test(output)
        ? { pass: true }
        : { pass: false, detail: `output unexpectedly matched /${assertion.pattern}/${assertion.flags ?? ""}` };
    }
    default:
      return { pass: false, detail: `unknown assertion type: ${assertion.type}` };
  }
}

async function runScenario(scenario) {
  const timeoutSec = scenario.timeout ?? 120;
  let stdout;
  try {
    stdout = await runClaude(scenario.prompt.trim(), timeoutSec);
  } catch (err) {
    // One retry: the claude CLI occasionally hits a transient spawn/self-update
    // race (binary briefly missing) when invoked back-to-back.
    try {
      stdout = await runClaude(scenario.prompt.trim(), timeoutSec);
    } catch (err2) {
      return { pass: false, failures: [`claude invocation failed: ${err2.message.slice(0, 500)}`] };
    }
  }

  const parsed = parseTranscript(stdout);
  const failures = [];
  for (const assertion of scenario.assertions ?? []) {
    const result = checkAssertion(assertion, parsed);
    if (!result.pass) failures.push(result.detail);
  }
  return { pass: failures.length === 0, failures };
}

async function main() {
  if (!NO_BARE && !process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is not set. Bare mode requires it (see file header). " +
      "Set the env var, or set EVAL_NO_BARE=1 to use an already-logged-in local session instead.");
    process.exit(1);
  }

  const files = findEvalFiles();
  if (files.length === 0) {
    console.error("No eval.yaml files found under tests/");
    process.exit(1);
  }

  console.log("Starting mock elmah.io MCP server...");
  const server = await startMockServer();

  let allPassed = true;
  try {
    for (const { skill, path } of files) {
      const doc = yaml.load(readFileSync(path, "utf8"));
      const scenarios = (doc.scenarios ?? []).filter((s) => !FILTER || s.name.includes(FILTER));
      if (scenarios.length === 0) continue;
      console.log(`\n=== ${skill} ===`);
      for (const scenario of scenarios) {
        process.stdout.write(`  - ${scenario.name} ... `);
        const result = await runScenario(scenario);
        if (result.pass) {
          console.log("PASS");
        } else {
          allPassed = false;
          console.log("FAIL");
          for (const f of result.failures) console.log(`      ${f}`);
        }
      }
    }
  } finally {
    server.kill();
  }

  console.log("");
  if (!allPassed) {
    console.log("Some eval scenarios failed.");
    process.exit(1);
  }
  console.log("All eval scenarios passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
