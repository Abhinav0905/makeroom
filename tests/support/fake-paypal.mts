// A scripted PayPal sandbox for tests. Replies are queued per "METHOD path" and
// each one is used once. Every non-token request is recorded with its
// PayPal-Request-Id and body. Only the sandbox host is accepted, and nothing
// leaves the process.
export type Reply =
  | { status?: number; body?: unknown; headers?: Record<string, string> }
  | typeof TIMEOUT;
export type Call = {
  method: string;
  path: string;
  key: string | null;
  body: unknown;
};
export const TIMEOUT = Symbol("timeout");
export const USD = (value: string) => ({ currency_code: "USD", value });
/** A successful JSON reply. */
export const ok = (body: unknown, status = 200): Reply => ({ status, body });
/** A PayPal error reply with an issue code and a debug id header. */
export const err = (status: number, issue: string): Reply => ({
  status,
  body: { name: "ERROR", details: [{ issue }] },
  headers: { "paypal-debug-id": "debug-" + issue.toLowerCase() },
});
export function fakePayPal() {
  const queues = new Map<string, Reply[]>();
  const calls: Call[] = [];
  const unexpected: string[] = [];
  let tokens = 0;
  const send: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== "api-m.sandbox.paypal.com")
      throw new Error("Test PayPal refused host " + url.hostname);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.pathname === "/v1/oauth2/token") {
      tokens++;
      return Response.json({ access_token: "test-token", expires_in: 300 });
    }
    const route = method + " " + url.pathname;
    calls.push({
      method,
      path: url.pathname,
      key: new Headers(init?.headers).get("PayPal-Request-Id"),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const reply = queues.get(route)?.shift();
    if (!reply) {
      unexpected.push(route);
      return Response.json(
        { name: "UNEXPECTED", details: [{ issue: "UNEXPECTED_TEST_CALL" }] },
        { status: 400 },
      );
    }
    if (reply === TIMEOUT) throw new Error("simulated timeout");
    const status = reply.status ?? 200;
    return status === 204
      ? new Response(null, { status, headers: reply.headers })
      : Response.json(reply.body ?? {}, { status, headers: reply.headers });
  };
  return {
    send,
    calls,
    unexpected,
    get tokens() {
      return tokens;
    },
    /** Queue replies for one route, e.g. on("GET /v2/checkout/orders/ORD", ok(order)). */
    on(route: string, ...replies: Reply[]) {
      const queue = queues.get(route) ?? [];
      queue.push(...replies);
      queues.set(route, queue);
      return this;
    },
    /** "METHOD path" for every recorded call, in order. */
    routes() {
      return calls.map((c) => c.method + " " + c.path);
    },
    /** Calls made to one route. */
    to(route: string) {
      return calls.filter((c) => c.method + " " + c.path === route);
    },
    /** Replies that were queued but never requested. */
    pending() {
      return [...queues].flatMap(([route, q]) => q.map(() => route));
    },
    reset() {
      calls.length = 0;
      unexpected.length = 0;
      queues.clear();
    },
  };
}
