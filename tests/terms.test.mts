import test from "node:test";
import assert from "node:assert/strict";
import { seed, type Booking } from "../lib/domain.ts";
import {
  MAX_TERMS,
  canAddTerm,
  noMoveNote,
  saveTerms,
} from "../lib/terms.ts";
const message =
  "Thursday's a bit tight with school pickup. I can come in at 1 for $15 back. 4 would work too, but I'd want $20 for that one. 4:30 is fine as well, same $20.";
const quotes = [
  "I can come in at 1 for $15 back.",
  "4 would work too, but I'd want $20 for that one.",
];
function readByAI(): Booking {
  const b = structuredClone(seed().bookings[0]);
  b.aiDraft = {
    message,
    model: "gemini-2.5-flash",
    alternatives: [
      { start: 780, refund: 1500 },
      { start: 960, refund: 2000 },
    ],
    explanation: "Two times fit.",
    clarification: null,
    evidence: quotes,
    rejected: [
      {
        start: 990,
        refund: 2000,
        evidence: "4:30 is fine as well, same $20.",
        reason: "4:30 pm would end at 5:30 pm, after the 5 pm close",
      },
    ],
  };
  return b;
}
const both = [
  { start: 780, refund: 1500 },
  { start: 960, refund: 2000 },
];
test("saving AI terms keeps their quotes and drops the draft", () => {
  const b = readByAI();
  saveTerms(b, message, both);
  assert.equal(b.preferenceSource, "ai");
  assert.deepEqual(b.quotes, quotes);
  assert.equal(b.aiDraft, undefined);
});
test("saving the same AI terms again keeps quotes and the AI badge", () => {
  const b = readByAI();
  saveTerms(b, message, both);
  saveTerms(b, message, structuredClone(both));
  assert.equal(b.preferenceSource, "ai");
  assert.deepEqual(b.quotes, quotes);
  // Unticking one row still keeps the quote that belongs to the other.
  saveTerms(b, message, [{ start: 960, refund: 2000 }]);
  assert.equal(b.preferenceSource, "ai");
  assert.deepEqual(b.quotes, [quotes[1]]);
  saveTerms(b, message, [{ start: 960, refund: 2000 }]);
  assert.deepEqual(b.quotes, [quotes[1]]);
});
test("changed terms, a changed message or no moves are owner-reviewed", () => {
  const changed = readByAI();
  saveTerms(changed, message, both);
  saveTerms(changed, message, [{ start: 780, refund: 1600 }]);
  assert.equal(changed.preferenceSource, "reviewed");
  assert.equal(changed.quotes, undefined);
  // A time the customer did not offer cannot borrow AI provenance later.
  saveTerms(changed, message, [{ start: 780, refund: 1500 }]);
  assert.equal(changed.preferenceSource, "reviewed");
  const edited = readByAI();
  saveTerms(edited, message, both);
  saveTerms(edited, message + " Thanks!", both);
  assert.equal(edited.preferenceSource, "reviewed");
  assert.equal(edited.quotes, undefined);
  const none = readByAI();
  saveTerms(none, message, []);
  assert.equal(none.preferenceSource, "reviewed");
  assert.equal(none.quotes, undefined);
  const setAside = readByAI();
  saveTerms(setAside, message, [{ start: 990, refund: 2000 }]);
  assert.equal(setAside.preferenceSource, "reviewed");
});
test("reviewed seed terms stay reviewed when saved unchanged", () => {
  const b = structuredClone(seed().bookings[0]);
  saveTerms(b, b.preference, structuredClone(b.alternatives));
  assert.equal(b.preferenceSource, "reviewed");
  assert.equal(b.quotes, undefined);
});
test("a new AI read of the same message supplies fresh quotes", () => {
  const b = readByAI();
  saveTerms(b, message, both);
  b.aiDraft = {
    ...readByAI().aiDraft!,
    evidence: ["I can come in at 1", quotes[1]],
  };
  saveTerms(b, message, both);
  assert.equal(b.preferenceSource, "ai");
  assert.deepEqual(b.quotes, ["I can come in at 1", quotes[1]]);
});
test("the AI box says when every offered time broke a rule", () => {
  assert.equal(
    noMoveNote(readByAI().aiDraft!),
    "None of the offered times fit the studio's rules.",
  );
  assert.equal(
    noMoveNote({ rejected: [] }),
    "Keeps the original time. No move offered.",
  );
  assert.equal(noMoveNote({}), "Keeps the original time. No move offered.");
});
test("the editor stops adding time rows at the route's limit", () => {
  assert.equal(MAX_TERMS, 16);
  assert.equal(canAddTerm(0), true);
  assert.equal(canAddTerm(15), true);
  assert.equal(canAddTerm(16), false);
  assert.equal(canAddTerm(17), false);
});
