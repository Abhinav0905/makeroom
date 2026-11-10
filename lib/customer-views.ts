// What each customer link may show. A link reveals only its holder's own
// booking: never another customer's name, a secret token or a PayPal ID.
// Pure, so node:test can check that nothing private leaks.
import { orderStarter, time, type Plan, type Studio } from "./domain.ts";
/** The view behind a moved customer's offer link. */
export function offerView(s: Studio, token: string) {
  const p = s.plan!;
  const m = p.moves.find((m) => m.token === token)!;
  return {
    name: m.name,
    from: m.from,
    to: m.to,
    duration: m.duration,
    refund: m.refund,
    date: s.date,
    mode: s.mode,
    consent: m.consent,
    status: p.status,
    expiresAt: p.expiresAt,
    service: s.bookings.find((b) => b.id === m.bookingId)!.service,
    committed: !!p.committed,
    refundStatus: m.refundStatus,
  };
}
/**
 * Where the new customer's payment stands:
 * - none: nothing started yet
 * - started: the customer opened PayPal from their checkout page
 * - studio: the studio started the PayPal payment, so there is nothing to
 *   pay on the checkout page
 * - on-hold: PayPal holds the payment until the studio confirms
 * - lapsed: a hold whose offer expired before the studio confirmed; the
 *   studio can no longer capture it and will release it
 * - checking: the studio is checking the payment with PayPal
 * - paid: booked and paid
 */
export type CheckoutPayment =
  | "none"
  | "started"
  | "studio"
  | "on-hold"
  | "lapsed"
  | "checking"
  | "paid";
export function checkoutPayment(p: Plan, now = Date.now()): CheckoutPayment {
  if (p.committed) return "paid";
  if (p.status === "review") return "checking";
  if (p.status === "authorized")
    return Date.parse(p.expiresAt) < now ? "lapsed" : "on-hold";
  if (p.status === "proposed" && orderStarter(p) === "studio") return "studio";
  if (p.status === "proposed" && p.orderId) return "started";
  return "none";
}
/** A moment as a studio clock time, e.g. "4:11 pm" (Pacific, like the day). */
export function pacificTime(iso: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const part = (type: string) =>
    Number(parts.find((x) => x.type === type)?.value ?? 0);
  return time((part("hour") % 24) * 60 + part("minute"));
}
/** The view behind the new customer's checkout link. */
export function checkoutView(s: Studio, now = Date.now()) {
  const p = s.plan!;
  const r = p.request;
  return {
    name: r.name,
    service: r.service,
    date: s.date,
    start: r.start,
    duration: r.duration,
    price: r.base,
    flexibility: p.totalRefund,
    total: p.totalCharge,
    // Counts only: the offers promise each moved customer privacy.
    accepted: p.moves.filter((m) => m.consent === "accepted").length,
    affected: p.moves.length,
    status: p.status,
    mode: s.mode,
    expiresAt: p.expiresAt,
    booked: !!p.committed,
    payment: checkoutPayment(p, now),
  };
}
export type CheckoutView = ReturnType<typeof checkoutView>;
