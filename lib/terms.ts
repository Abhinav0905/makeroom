import type { Alternative, Booking } from "./domain.ts";
/** Most times one customer's terms can list. The save route accepts no more. */
export const MAX_TERMS = 16;
export const sameTerms = (a: Alternative, b: Alternative) =>
  a.start === b.start && a.refund === b.refund;
/** Whether the editor may add another time row. */
export const canAddTerm = (rows: number) => rows < MAX_TERMS;
type AIDraft = NonNullable<Booking["aiDraft"]>;
/** The line shown when an AI read has no clarification and no usable move. */
export function noMoveNote(draft: Pick<AIDraft, "rejected">) {
  return draft.rejected?.length
    ? "None of the offered times fit the studio's rules."
    : "Keeps the original time. No move offered.";
}
/**
 * Saves reviewed terms onto a booking. The terms count as AI-sourced only when
 * every saved time matches a time from the stored AI read of the same message,
 * or a time that was already saved as AI-sourced for the same message. Quotes
 * come only from those stored records, never from the client.
 */
export function saveTerms(
  booking: Booking,
  message: string,
  alternatives: Alternative[],
) {
  const known: { terms: Alternative; quote: string }[] = [];
  const draft = booking.aiDraft;
  if (draft?.message === message)
    draft.alternatives.forEach((terms, i) =>
      known.push({ terms, quote: draft.evidence[i] ?? "" }),
    );
  if (booking.preferenceSource === "ai" && booking.preference === message)
    booking.alternatives.forEach((terms, i) =>
      known.push({ terms, quote: booking.quotes?.[i] ?? "" }),
    );
  const matches = alternatives.map(
    (a) =>
      known.find((k) => k.quote && sameTerms(k.terms, a)) ??
      known.find((k) => sameTerms(k.terms, a)),
  );
  const fromAI = alternatives.length > 0 && matches.every((m) => m);
  booking.preference = message;
  booking.alternatives = alternatives;
  booking.preferenceSource = fromAI ? "ai" : "reviewed";
  if (fromAI) booking.quotes = matches.map((m) => m?.quote ?? "");
  else delete booking.quotes;
  delete booking.aiDraft;
}
