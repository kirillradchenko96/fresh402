import type { ServiceId } from "./contracts";

export type TrafficClass = "technical" | "unclassified";
export type AnalyticsEvent = "discovery" | "documentation" | "registration_created" | "registration_existing" | "initial_402" | "payment_attempt" | "payment_verified" | "payment_settled" | "paid_result" | "repeat_paid_call" | "operation_failed";
export function trafficClass(request: Request): TrafficClass {
  const agent = request.headers.get("user-agent") ?? "";
  return request.headers.get("x-fresh402-purpose") === "probe" || /healthcheck|uptime|probe|monitoring|test\/|vitest/i.test(agent) ? "technical" : "unclassified";
}
export function analytics(db: D1Database, transport: "rest" | "mcp", traffic: TrafficClass) {
  return async (service: ServiceId | "register" | "discovery", event: AnalyticsEvent) => {
    try {
      await db.prepare(`INSERT INTO analytics_daily(day, service, transport, event, traffic_class, count)
        VALUES (?, ?, ?, ?, ?, 1) ON CONFLICT(day, service, transport, event, traffic_class) DO UPDATE SET count = count + 1`)
        .bind(new Date().toISOString().slice(0, 10), service, transport, event, traffic).run();
    } catch { console.error("fresh402_analytics_write_failed"); }
  };
}
