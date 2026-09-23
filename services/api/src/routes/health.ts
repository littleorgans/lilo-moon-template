import { Hono } from "hono";

/**
 * `/health`: unauthenticated liveness. It answers whenever the process can serve HTTP and touches
 * no dependency, so a database outage does not get the process restarted. Requests report that
 * outage themselves, as 503 `unavailable`.
 */
export function healthRoutes() {
  return new Hono().get("/", (c) => {
    c.header("cache-control", "no-store");
    return c.json({ status: "ok" });
  });
}
