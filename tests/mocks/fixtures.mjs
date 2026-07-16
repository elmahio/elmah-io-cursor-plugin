// Synthetic "test world" for the mock elmah.io MCP server.
// All data is fake and generated relative to request time so it never goes stale.
// Do not point this at any real elmah.io account or data.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const ORG = { id: "aaaaaaaa-0000-0000-0000-000000000001", name: "Acme Test Org" };

export const LOGS = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Production API", environment: "Production" },
  { id: "22222222-2222-2222-2222-222222222222", name: "Staging API", environment: "Staging" },
];

export const USER = { id: "u1", name: "Test User", email: "test@example.com" };

const PROD_LOG_ID = LOGS[0].id;
const STAGING_LOG_ID = LOGS[1].id;

function iso(offsetMs) {
  return new Date(Date.now() - offsetMs).toISOString();
}

// A deployment 50 minutes ago, followed 12 minutes later by a burst of fatal errors.
// Only the Production log has a recorded deployment; Staging has none, to exercise
// the "no deployments found" guardrail branch.
export function deployments(logId) {
  if (logId === STAGING_LOG_ID) return [];
  return [
    {
      id: "dep-1",
      version: "2.4.1",
      description: "Release 2.4.1",
      deployed: iso(50 * MINUTE),
    },
  ];
}

// The single most recent, highest-severity error: a regression introduced by the deployment above.
export function latestFatalMessage() {
  return {
    id: "msg-100",
    logId: PROD_LOG_ID,
    Type: "System.NullReferenceException",
    Message: "Object reference not set to an instance of an object.",
    Severity: "Fatal",
    Time: iso(2 * MINUTE),
    Url: "/api/orders/checkout",
    Method: "POST",
    StatusCode: 500,
    Source: "Acme.OrderService",
    ClientIp: "203.0.113.42",
    User: "user123@example.com",
    Application: "Acme.OrderService",
    Version: "2.4.1",
    IsNew: true,
    IsFixed: false,
    Detail:
      "System.NullReferenceException: Object reference not set to an instance of an object.\n" +
      "   at Acme.OrderService.Checkout.PlaceOrder(OrderRequest request) in /src/OrderService/Checkout.cs:line 88\n" +
      "   at Acme.OrderService.Controllers.OrdersController.Post(OrderRequest request) in /src/OrderService/Controllers/OrdersController.cs:line 34\n" +
      "   at Microsoft.AspNetCore.Mvc.Infrastructure.ActionMethodExecutor.TaskOfIActionResultExecutor.Execute(...)",
  };
}

// A pre-existing, unrelated noisy error unaffected by the deployment.
function noisyTimeoutGroup() {
  return {
    Type: "Acme.PaymentGatewayTimeoutException",
    Message: "Timed out waiting for payment gateway response.",
    Severity: "Error",
    count: 12,
    firstOccurrence: iso(5 * DAY),
    lastOccurrence: iso(3 * HOUR),
  };
}

export function recentMessages() {
  const fatal = latestFatalMessage();
  return [
    fatal,
    { ...fatal, id: "msg-099", Time: iso(9 * MINUTE) },
    { ...fatal, id: "msg-098", Time: iso(20 * MINUTE) },
    {
      id: "msg-097",
      logId: PROD_LOG_ID,
      Type: "Acme.PaymentGatewayTimeoutException",
      Message: "Timed out waiting for payment gateway response.",
      Severity: "Error",
      Time: iso(3 * HOUR),
      Url: "/api/payments/charge",
      Method: "POST",
      StatusCode: 504,
      Source: "Acme.PaymentService",
      IsNew: false,
      IsFixed: false,
    },
  ];
}

export function frequentGroups() {
  const fatal = latestFatalMessage();
  return [
    {
      Type: fatal.Type,
      Message: fatal.Message,
      Severity: fatal.Severity,
      count: 47,
      firstOccurrence: iso(38 * MINUTE),
      lastOccurrence: iso(2 * MINUTE),
    },
    noisyTimeoutGroup(),
  ];
}

export function messageCount() {
  return 59; // 47 + 12
}

// Production has a monitor currently down; Staging is fully healthy, to exercise
// both the incident-reporting path and the "all healthy, keep it brief" guardrail.
export function uptimeChecks(logId) {
  if (logId === STAGING_LOG_ID) {
    return [{ id: "chk-3", name: "Staging Website", status: "Up", upPercentage24h: 100, url: "https://staging.acme.example.com" }];
  }
  return [
    { id: "chk-1", name: "Website", status: "Up", upPercentage24h: 99.98, url: "https://acme.example.com" },
    { id: "chk-2", name: "Status API", status: "Down", upPercentage24h: 71.2, url: "https://status.acme.example.com" },
  ];
}

export function uptimeDetails(checkId) {
  const check = uptimeChecks(PROD_LOG_ID).find((c) => c.id === checkId) ?? uptimeChecks(PROD_LOG_ID)[0];
  return {
    ...check,
    lastCheckedAt: iso(1 * MINUTE),
    regions: [
      { region: "us-east", status: check.status, responseTimeMs: check.status === "Down" ? null : 142 },
      { region: "eu-west", status: check.status, responseTimeMs: check.status === "Down" ? null : 168 },
    ],
    incident: check.status === "Down" ? { startedAt: iso(22 * MINUTE), reason: "Connection timed out" } : null,
  };
}

export function heartbeats() {
  return [{ id: "hb-1", name: "Nightly Import Job", status: "Healthy", lastCheckIn: iso(3 * HOUR) }];
}

export function heartbeatDetails(heartbeatId) {
  const hb = heartbeats().find((h) => h.id === heartbeatId) ?? heartbeats()[0];
  return {
    ...hb,
    expectedIntervalMinutes: 1440,
    history: [
      { checkedInAt: iso(3 * HOUR), status: "Healthy" },
      { checkedInAt: iso(27 * HOUR), status: "Healthy" },
      { checkedInAt: iso(51 * HOUR), status: "Healthy" },
    ],
  };
}
