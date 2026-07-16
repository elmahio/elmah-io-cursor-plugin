// Minimal MCP server over the Streamable HTTP transport, hand-rolled with zero
// dependencies. Backs eval scenarios with fixed synthetic data (see fixtures.mjs)
// so tests never touch a real elmah.io account.
//
// Implements just enough of the spec for a stateless server: initialize,
// notifications/initialized, tools/list, tools/call. Each POST is answered
// synchronously with a single JSON-RPC response, which is spec-legal for
// servers that never need to push unsolicited messages.

import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import * as fx from "./fixtures.mjs";

const PORT = Number(process.env.MOCK_MCP_PORT ?? 8137);
const PATH = "/mcp";

const TOOLS = [
  {
    name: "system_get_context",
    description: "Get system information like current date and time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "organizations_list",
    description: "Get a list of all organizations that the current user is a part of.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "organizations_get_details",
    description: "Get detailed information about an organization.",
    inputSchema: {
      type: "object",
      properties: {
        organizationId: { type: "string" },
        includeUsage: { type: "boolean", default: false },
      },
      required: ["organizationId"],
    },
  },
  {
    name: "logs_list",
    description: "Get a list of logs that the current user has access to.",
    inputSchema: {
      type: "object",
      properties: {
        access: { type: ["string", "null"], enum: ["Read", "Write", "Administrator", null] },
        environment: { type: ["string", "null"] },
        favorites: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "messages_list_recent",
    description: "List the most recent log messages for a specific log.",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "string" },
        count: { type: "integer", default: 10 },
        severity: { type: "string", default: "Error" },
        query: { type: ["string", "null"] },
        from: { type: ["string", "null"], format: "date-time" },
        to: { type: ["string", "null"], format: "date-time" },
        fields: { type: ["string", "null"] },
      },
      required: ["logId"],
    },
  },
  {
    name: "messages_get",
    description: "Fetch a single log message by ID.",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "string" },
        messageId: { type: "string" },
        fields: { type: ["string", "null"] },
      },
      required: ["logId", "messageId"],
    },
  },
  {
    name: "messages_list_frequent",
    description: "Identify the most frequent/common error groups in a log.",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "string" },
        count: { type: "integer", default: 5 },
        severity: { type: "string", default: "Error" },
        query: { type: ["string", "null"] },
        from: { type: ["string", "null"], format: "date-time" },
        to: { type: ["string", "null"], format: "date-time" },
        fields: { type: ["string", "null"] },
      },
      required: ["logId"],
    },
  },
  {
    name: "messages_count",
    description: "Count the number of log messages based on severity and timeframe.",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "string" },
        from: { type: ["string", "null"], format: "date-time" },
        query: { type: ["string", "null"] },
        severity: { type: ["string", "null"] },
      },
      required: ["logId"],
    },
  },
  {
    name: "deployments_list",
    description: "List recent deployments for a log.",
    inputSchema: {
      type: "object",
      properties: {
        logId: { type: "string" },
        count: { type: "integer", default: 5 },
        includeLogMessageMetrics: { type: "boolean", default: false },
      },
      required: ["logId"],
    },
  },
  {
    name: "uptime_list",
    description: "Get a list of all uptime checks for a log.",
    inputSchema: {
      type: "object",
      properties: { logId: { type: "string" } },
      required: ["logId"],
    },
  },
  {
    name: "uptime_get_details",
    description: "Fetch the latest real-time results for a specific uptime check.",
    inputSchema: {
      type: "object",
      properties: { logId: { type: "string" }, checkId: { type: "string" } },
      required: ["logId", "checkId"],
    },
  },
  {
    name: "heartbeats_list",
    description: "Get a list of all heartbeats configured for a log.",
    inputSchema: {
      type: "object",
      properties: { logId: { type: "string" } },
      required: ["logId"],
    },
  },
  {
    name: "heartbeats_get_details",
    description: "Get detailed information and recent check-in history for a specific heartbeat.",
    inputSchema: {
      type: "object",
      properties: { logId: { type: "string" }, heartbeatId: { type: "string" } },
      required: ["logId", "heartbeatId"],
    },
  },
  {
    name: "users_get_current",
    description: "Fetch the current user details.",
    inputSchema: { type: "object", properties: {} },
  },
];

function textResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

function errorResult(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

const CALL_LOG = [];

function callTool(name, args) {
  CALL_LOG.push({ name, args });
  switch (name) {
    case "system_get_context":
      return textResult({ currentDateTimeUtc: new Date().toISOString() });
    case "organizations_list":
      return textResult([fx.ORG]);
    case "organizations_get_details":
      return textResult({ ...fx.ORG, plan: "Pro", usage: args.includeUsage ? { logMessages: 12345 } : undefined });
    case "logs_list":
      return textResult(fx.LOGS);
    case "messages_list_recent":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult(fx.recentMessages().slice(0, args.count ?? 10));
    case "messages_get": {
      const msg = fx.recentMessages().find((m) => m.id === args.messageId) ?? fx.latestFatalMessage();
      return textResult(msg);
    }
    case "messages_list_frequent":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult(fx.frequentGroups().slice(0, args.count ?? 5));
    case "messages_count":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult({ count: fx.messageCount() });
    case "deployments_list":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult(fx.deployments(args.logId).slice(0, args.count ?? 5));
    case "uptime_list":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult(fx.uptimeChecks(args.logId));
    case "uptime_get_details":
      return textResult(fx.uptimeDetails(args.checkId));
    case "heartbeats_list":
      if (!fx.LOGS.some((l) => l.id === args.logId)) return errorResult(`Unknown logId: ${args.logId}`);
      return textResult(fx.heartbeats());
    case "heartbeats_get_details":
      return textResult(fx.heartbeatDetails(args.heartbeatId));
    case "users_get_current":
      return textResult(fx.USER);
    default:
      return errorResult(`Unknown tool: ${name}`);
  }
}

function handleRpc(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined;

  let result;
  let error;
  switch (method) {
    case "initialize":
      result = {
        protocolVersion: params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "elmahio-mock", version: "1.0.0" },
      };
      break;
    case "notifications/initialized":
      return null; // notification, no response
    case "ping":
      result = {};
      break;
    case "tools/list":
      result = { tools: TOOLS };
      break;
    case "tools/call":
      result = callTool(params?.name, params?.arguments ?? {});
      break;
    default:
      error = { code: -32601, message: `Method not found: ${method}` };
  }

  if (isNotification) return null;
  return error ? { jsonrpc: "2.0", id, error } : { jsonrpc: "2.0", id, result };
}

export function startServer(port = PORT) {
  const server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url.startsWith(PATH)) {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const response = handleRpc(msg);
      if (response === null) {
        res.writeHead(202).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

export function toolCallLog() {
  return CALL_LOG;
}

export function resetToolCallLog() {
  CALL_LOG.length = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().then((s) => {
    console.log(`Mock elmah.io MCP server listening on http://127.0.0.1:${PORT}${PATH}`);
  });
}
