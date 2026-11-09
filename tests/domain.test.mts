import test from "node:test";
import assert from "node:assert/strict";
import {
  seed,
  solve,
  propose,
  consent,
  practiceSettle,
  commit,
  assertReady,
  expire,
} from "../lib/domain.ts";

test("the two-move plan conserves money and changes no booking before payment", () => {
  const s = seed(),
    before = structuredClone(s.bookings),
    p = propose(s, s.request);
  assert.deepEqual(
    p.moves.map((m) => [m.bookingId, m.to, m.refund]),
    [
      ["alex", 780, 1500],
      ["sam", 960, 1000],
    ],
  );
  assert.equal(p.totalCharge, 14500);
  assert.equal(p.totalCharge - p.totalRefund, 12000);
  assert.deepEqual(s.bookings, before);
  assert.throws(() => practiceSettle(s), /Every affected/);
  consent(s, p.moves[0].token, "accepted");
  assert.throws(() => practiceSettle(s), /Every affected/);
  consent(s, p.moves[1].token, "accepted");
  assert.deepEqual(s.bookings, before);
  practiceSettle(s);
  assert.deepEqual(
    s.bookings.map((b) => [b.start, b.refunded]),
    [
      [780, 1500],
      [960, 1000],
    ],
  );
  assert.equal(s.plan?.status, "complete");
  const count = s.events.length;
  commit(s);
  assert.equal(s.events.length, count);
  assert.throws(() => practiceSettle(s));
});
test("a refusal closes the entire proposal and preserves appointments", () => {
  const s = seed(),
    p = propose(s, s.request);
  consent(s, p.moves[0].token, "accepted");
  consent(s, p.moves[1].token, "declined");
  assert.equal(p.status, "declined");
  assert.deepEqual(
    s.bookings.map((b) => b.start),
    [840, 900],
  );
  assert.throws(() => assertReady(s));
  assert.throws(() => consent(s, p.moves[1].token, "accepted"));
});
test("consent is specific to a proposal, idempotent and time limited", () => {
  const s = seed(),
    p = propose(s, s.request);
  consent(s, p.moves[0].token, "accepted");
  consent(s, p.moves[0].token, "accepted");
  assert.equal(s.events.filter((e) => e.kind === "consent").length, 1);
  assert.throws(() => consent(s, p.moves[0].token, "declined"));
  propose(s, s.request);
  assert.throws(() => consent(s, p.moves[1].token, "accepted"), /no longer/);
  expire(s, Date.parse(s.plan!.expiresAt) + 1);
  assert.equal(s.plan?.status, "expired");
  assert.throws(() => assertReady(s));
});
test("budget failure explains the required cost without altering state", () => {
  const s = seed();
  assert.throws(() => propose(s, { ...s.request, budget: 2000 }), /needs \$25/);
  assert.equal(s.plan, null);
  s.bookings[0].alternatives = [];
  assert.equal(solve(s.bookings, s.request), null);
});
test("refunds cannot exceed the original remaining payment", () => {
  const s = seed();
  s.bookings[0].refunded = 5000;
  assert.equal(solve(s.bookings, s.request), null);
});
test("planner rejects overlapping alternatives and invalid prices", () => {
  const s = seed();
  s.bookings[1].alternatives = [{ start: 780, refund: 1000 }];
  assert.equal(solve(s.bookings, s.request), null);
  assert.throws(() => solve(s.bookings, { ...s.request, base: 1 }), /rate/);
  assert.throws(
    () => solve(s.bookings, { ...s.request, start: 841 }),
    /Choose/,
  );
  assert.throws(
    () => solve(s.bookings, { ...s.request, budget: NaN }),
    /whole/,
  );
});
test("a free slot needs no unnecessary customer move", () => {
  const s = seed(),
    p = propose(s, {
      ...s.request,
      start: 780,
      duration: 60,
      base: 6000,
      budget: 0,
    });
  assert.equal(p.moves.length, 0);
  assert.equal(p.totalCharge, 6000);
  practiceSettle(s);
  assert.deepEqual(
    s.bookings.map((b) => b.start),
    [840, 900],
  );
});
test("sandbox refuses simulated settlement and unfunded refunds", () => {
  const s = seed();
  s.mode = "sandbox";
  const p = propose(s, s.request);
  p.moves.forEach((m) => consent(s, m.token, "accepted"));
  assert.throws(() => practiceSettle(s), /unavailable/);
  assert.throws(() => assertReady(s), /Fund the original/);
  assert.throws(() => commit(s), /payment must be confirmed/);
});
test("an active checkout or payment operation blocks replacement plans", () => {
  const s = seed(),
    p = propose(s, s.request);
  p.orderId = "TEST";
  assert.throws(() => propose(s, s.request), /Finish or cancel/);
  delete p.orderId;
  s.operation = { id: "x", kind: "test", startedAt: new Date().toISOString() };
  assert.throws(() => propose(s, s.request), /being checked/);
});
test("all feasible grid scenarios obey consent alternatives, capacity and budget", () => {
  for (const duration of [60, 90, 120])
    for (let start = 780; start + duration <= 1020; start += 15)
      for (const budget of [0, 1000, 2000, 2500, 6000]) {
        const s = seed(),
          r = { ...s.request, start, duration, base: duration * 100, budget },
          out = solve(s.bookings, r);
        if (!out) continue;
        assert.ok(out.cost <= budget);
        assert.equal(
          out.cost,
          out.choices.reduce((n, c) => n + c.refund, 0),
        );
        const intervals = [
          { start, duration },
          ...out.choices.map((c, i) => ({
            ...c,
            duration: s.bookings[i].duration,
          })),
        ];
        for (let i = 0; i < intervals.length; i++)
          for (let j = i + 1; j < intervals.length; j++)
            assert.ok(
              intervals[i].start + intervals[i].duration <=
                intervals[j].start ||
                intervals[j].start + intervals[j].duration <=
                  intervals[i].start,
            );
        out.choices.forEach((c, i) =>
          assert.ok(
            c.start === s.bookings[i].start ||
              s.bookings[i].alternatives.some(
                (a) => a.start === c.start && a.refund === c.refund,
              ),
          ),
        );
      }
});
test("with two alternatives the planner skips the one that clashes", () => {
  const s = seed();
  assert.deepEqual(s.bookings[0].alternatives, [
    { start: 780, refund: 1500 },
    { start: 960, refund: 2000 },
  ]);
  // Even when 4 pm is the cheaper option for Alex, it clashes with Sam's only
  // alternative, and Sam staying at 3 pm overlaps Maya's 2–4 pm request.
  s.bookings[0].alternatives = [
    { start: 780, refund: 1500 },
    { start: 960, refund: 500 },
  ];
  const out = solve(s.bookings, s.request);
  assert.deepEqual(
    out?.choices.map((c) => [c.bookingId, c.start, c.refund]),
    [
      ["alex", 780, 1500],
      ["sam", 960, 1000],
    ],
  );
  assert.equal(out?.cost, 2500);
  // Once Sam can also take 1 pm, the cheaper pairing uses Alex's 4 pm.
  s.bookings[1].alternatives.push({ start: 780, refund: 1000 });
  assert.deepEqual(
    solve(s.bookings, s.request)?.choices.map((c) => [c.bookingId, c.start]),
    [
      ["alex", 960],
      ["sam", 780],
    ],
  );
});
