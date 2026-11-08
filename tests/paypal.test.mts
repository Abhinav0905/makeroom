import test from "node:test";
import assert from "node:assert/strict";
import { PayPal, PayPalError } from "../lib/paypal.ts";
test("sandbox adapter uses exact cents and stable idempotency on mutations", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const send: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      String(url).endsWith("/token")
        ? { access_token: "test-token" }
        : { id: "sandbox-resource", status: "COMPLETED" },
    );
  };
  const api = new PayPal(
    { clientId: "test-client", secret: "test-secret" },
    send,
  );
  await api.createOrder(
    14500,
    "AUTHORIZE",
    "order-key",
    "https://example.test/return",
    "https://example.test/cancel",
    "Test",
  );
  await api.refund("CAPTURE-A", 1500, "refund-key");
  await api.refund("CAPTURE-A", 1500, "refund-key");
  const mutations = calls.filter((c) => !c.url.endsWith("/token"));
  assert.ok(
    calls.every((c) => new URL(c.url).hostname === "api-m.sandbox.paypal.com"),
  );
  assert.equal(
    JSON.parse(mutations[0].init!.body as string).purchase_units[0].amount
      .value,
    "145.00",
  );
  for (const c of mutations.slice(1)) {
    assert.equal(
      new Headers(c.init!.headers).get("PayPal-Request-Id"),
      "refund-key",
    );
    assert.equal(JSON.parse(c.init!.body as string).amount.value, "15.00");
  }
});
test("a mutation timeout is marked uncertain instead of failed payment", async () => {
  const send: typeof fetch = async (url) => {
    if (String(url).endsWith("/token"))
      return Response.json({ access_token: "test" });
    throw Error("timeout");
  };
  const api = new PayPal({ clientId: "test", secret: "test" }, send);
  await assert.rejects(
    api.capture("AUTH", "key"),
    (e: unknown) => e instanceof PayPalError && e.uncertain && e.status === 504,
  );
  await assert.rejects(
    api.getCapture("CAPTURE"),
    (e: unknown) => e instanceof PayPalError && !e.uncertain,
  );
});
test("provider failure retains its debug reference without leaking credentials", async () => {
  const send: typeof fetch = async (url) =>
    String(url).endsWith("/token")
      ? Response.json({ access_token: "test" })
      : Response.json(
          { details: [{ issue: "INTERNAL_SERVER_ERROR" }] },
          { status: 500, headers: { "paypal-debug-id": "debug-test" } },
        );
  const api = new PayPal(
    { clientId: "test", secret: "never-print-this" },
    send,
  );
  await assert.rejects(
    api.refund("CAPTURE", 100, "key"),
    (e: unknown) =>
      e instanceof PayPalError &&
      e.uncertain &&
      e.debugId === "debug-test" &&
      !e.message.includes("never-print-this"),
  );
});
