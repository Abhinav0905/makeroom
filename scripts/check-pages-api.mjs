// Exercises only new fictional practice records. Never touches sandbox money.
import assert from "node:assert/strict";
const base = process.argv[2] || "http://127.0.0.1:5180";
const origin = "https://abhinav0905.github.io";
const id = crypto.randomUUID(), other = crypto.randomUUID();
let checks = 0;
async function api(path = "/api/studio", data, session = id, extra = {}) {
  const r = await fetch(base + path, {
    method: data ? "POST" : "GET",
    headers: { Origin: origin, "X-MakeRoom-Practice": session,
      ...(data ? { "Content-Type": "application/json" } : {}), ...extra },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const text = await r.text();
  let b; try { b = JSON.parse(text); } catch { throw Error(`Non-JSON response: ${r.status}`); }
  return { r, b };
}
const start = await api();
assert.equal(start.r.status, 200);
assert.equal(start.b.integrations.guest, true);
assert.equal(start.r.headers.get("Access-Control-Allow-Origin"), origin);
assert.equal(start.r.headers.has("set-cookie"), false); checks++;
const plan = await api("/api/studio", { action: "plan", version: start.b.studio.version, request: start.b.studio.request });
assert.equal(plan.r.status, 200); assert.equal(plan.b.studio.plan.moves.length, 2); checks++;
for (const move of plan.b.studio.plan.moves) {
  const accepted = await api("/api/offer/" + move.token, { answer: "accepted" }, other);
  assert.equal(accepted.r.status, 200); assert.equal(accepted.b.consent, "accepted"); checks++;
}
const done = await api("/api/studio", { action: "practice-settle" });
assert.equal(done.r.status, 200); assert.equal(done.b.studio.plan.status, "complete"); checks++;
assert.equal((await api("/api/studio", undefined, other)).b.studio.plan, null); checks++;
for (const action of ["capture", "checkout", "fund-booking", "reconcile"]) {
  assert.equal((await api("/api/studio", { action })).r.status, 403); checks++;
}
assert.equal((await api("/api/studio", { action: "mode", mode: "sandbox" })).r.status, 403); checks++;
const evil = await api("/api/studio", { action: "reset" }, id, { Origin: "https://attacker.example" });
assert.equal(evil.r.status, 403); assert.equal(evil.r.headers.has("Access-Control-Allow-Origin"), false); checks++;
const preflight = await fetch(base + "/api/studio", { method: "OPTIONS", headers: { Origin: origin,
  "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-makeroom-practice" } });
assert.equal(preflight.status, 204); checks++;
console.log(JSON.stringify({ base, checks, passed: true, description: "Pages: plan, separate consent, practice settlement, isolation, CORS and PayPal denial" }));
