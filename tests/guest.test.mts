import test from "node:test";
import assert from "node:assert/strict";
import { guestId, guestCookie, guestActionAllowed, guestOwner } from "../lib/guest.ts";
test("guest identity is restricted to a random UUID and hardened cookie", () => {
  const id = "32a76fb4-2e68-465a-8c4b-a8e4f01cd365";
  assert.equal(guestId("other=x; " + guestCookie(id, true)), id);
  assert.equal(guestId("makeroom_practice=owner-user-id"), null);
  assert.equal(guestId(null), null);
  assert.match(
    guestCookie(id, true),
    /HttpOnly; SameSite=Strict; Max-Age=86400; Secure$/,
  );
});
test("guest practice cannot request any PayPal mutation", () => {
  for (const action of [
    "fund-booking",
    "finish-funding",
    "checkout",
    "finish-approval",
    "capture",
    "reconcile",
    "unknown",
  ])
    assert.equal(guestActionAllowed(action), false, action);
  assert.equal(guestActionAllowed("mode", "sandbox"), false);
  assert.equal(guestActionAllowed("mode", "practice"), true);
  for (const action of [
    "plan",
    "interpret",
    "preference",
    "practice-settle",
    "cancel",
    "reset",
  ])
    assert.equal(guestActionAllowed(action), true, action);
});
test("guest and GitHub Pages studios are recognised as practice-only owners", () => {
  const id = "32a76fb4-2e68-465a-8c4b-a8e4f01cd365";
  assert.equal(guestOwner("guest:" + id), true);
  assert.equal(guestOwner("pages:" + id), true);
  assert.equal(guestOwner("signed-in-user-id"), false);
  assert.equal(guestOwner("user-guest:" + id), false);
});
