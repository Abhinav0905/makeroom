// The new customer's checkout link: who may use it and what paying does.
// Practice studios settle with the same practiceSettle as the studio's
// "Complete practice booking". Sandbox studios use the same payments core as
// the studio's "Approve with PayPal", so keys and PayPal calls are identical;
// capture and refunds stay with the studio. Storage and payments are
// injected, so node:test can drive this without Cloudflare bindings.
import {
  DomainError,
  practiceSettle,
  type Mode,
  type Plan,
  type Studio,
} from "./domain.ts";
import { guestOwner } from "./guest.ts";
import { checkoutView } from "./customer-views.ts";
import type { CheckoutPage } from "./payments-core.ts";
export const CHECKOUT_TOKEN = /^[a-f0-9-]{72}$/;
/** True when token is the checkout link of the studio's current plan planId. */
export function isCurrentCheckout(s: Studio, planId: string, token: string) {
  return (
    !!s.plan?.checkoutToken &&
    s.plan.id === planId &&
    s.plan.checkoutToken === token
  );
}
/**
 * The GitHub Pages client reaches only its own `pages:` practice studios, and
 * guest studios never reach a PayPal sandbox step.
 */
export function checkoutAccess(owner: string, mode: Mode, fromPages: boolean) {
  if (fromPages && (!owner.startsWith("pages:") || mode !== "practice"))
    throw new DomainError(
      "This link is not a GitHub Pages practice checkout.",
      403,
    );
  if (mode !== "practice" && guestOwner(owner))
    throw new DomainError("Guest studios use simulated payments.", 403);
}
/** Refuses with a plain reason unless the link's plan is still current. */
function assertCurrent(s: Studio, token: string): Plan {
  if (!s.plan?.checkoutToken || s.plan.checkoutToken !== token)
    throw new DomainError(
      "The studio has replaced this booking link. Ask for the latest one.",
      410,
    );
  return s.plan;
}
/** The checkout view, only while token is still the plan's checkout link. */
export function currentCheckoutView(s: Studio, token: string) {
  assertCurrent(s, token);
  return checkoutView(s);
}
/**
 * Why the customer cannot pay right now, in plain words, or the plan when
 * they can: every affected customer agreed, the offer is open and nothing is
 * paid yet.
 */
export function assertCheckoutOpen(s: Studio, token: string, now = Date.now()) {
  const p = assertCurrent(s, token);
  if (p.committed || ["captured", "settling", "complete"].includes(p.status))
    throw new DomainError(
      "This session is already booked and paid. There is nothing more to pay.",
    );
  if (p.status === "authorized")
    throw new DomainError(
      "Your payment is already approved. The studio confirms your booking next.",
    );
  if (p.status === "review")
    throw new DomainError(
      "The studio is checking this payment with PayPal. Please don't pay again.",
    );
  if (p.status === "declined")
    throw new DomainError(
      "A customer chose to keep their original time, so this session can't be booked. Nothing was charged.",
    );
  if (p.status === "cancelled")
    throw new DomainError(
      "The studio closed this booking request. Nothing was charged.",
    );
  if (p.status === "expired" || Date.parse(p.expiresAt) < now)
    throw new DomainError(
      "This booking link has expired. Nothing was charged. Ask the studio for a new link.",
    );
  if (s.operation)
    throw new DomainError(
      "A payment step is already running. Please wait a moment and try again.",
    );
  const waiting = p.moves.filter((m) => m.consent !== "accepted").length;
  if (waiting)
    throw new DomainError(
      `Waiting for ${waiting} more customer${waiting === 1 ? "" : "s"} to agree. You can pay once everyone has.`,
    );
  if (
    s.mode === "sandbox" &&
    s.bookings.some(
      (b) => p.moves.some((m) => m.bookingId === b.id) && !b.captureId,
    )
  )
    throw new DomainError(
      "The studio hasn't finished setting up payments for this booking. Please try again later.",
    );
  return p;
}
/** Practice "pay": the studio's own practice settlement, behind the same checks. */
export function practiceCheckout(s: Studio, token: string, now = Date.now()) {
  assertCurrent(s, token);
  if (s.mode !== "practice")
    throw new DomainError(
      "This booking uses PayPal sandbox. Choose Pay with PayPal.",
    );
  assertCheckoutOpen(s, token, now);
  practiceSettle(s);
}
/**
 * PayPal sends the buyer back to the checkout page, appending its order as
 * `token`. The checkout link token stays in the path.
 */
export function checkoutReturn(origin: string, token: string) {
  const page = origin + "/checkout/" + encodeURIComponent(token);
  return {
    returnUrl: page + "?paypal=approved",
    cancelUrl: page + "?paypal=cancel",
  };
}
export type CheckoutDeps = {
  payments: {
    beginCheckout(
      owner: string,
      origin: string,
      page?: CheckoutPage,
    ): Promise<Studio>;
    finishApproval(
      owner: string,
      orderId: string,
      check?: (s: Studio) => void,
    ): Promise<Studio>;
  };
  updateStudio(owner: string, fn: (s: Studio) => void): Promise<Studio>;
  now?(): number;
};
export function createCheckout(deps: CheckoutDeps) {
  const now = () => (deps.now ? deps.now() : Date.now());
  /**
   * The pay button. Practice settles at once. Sandbox opens (or reopens) the
   * plan's PayPal checkout and returns its approval link.
   */
  async function pay(
    owner: string,
    studio: Studio,
    token: string,
    origin: string,
  ): Promise<{ studio: Studio; approvalUrl?: string }> {
    if (studio.mode === "practice")
      return {
        studio: await deps.updateStudio(owner, (s) =>
          practiceCheckout(s, token, now()),
        ),
      };
    checkoutAccess(owner, studio.mode, false);
    const s = await deps.payments.beginCheckout(owner, origin, {
      ...checkoutReturn(origin, token),
      check(s) {
        const p = assertCheckoutOpen(s, token, now());
        // PayPal would return the buyer to the studio's page, not here.
        if (p.orderId && !p.checkoutOrder)
          throw new DomainError(
            "The studio already opened PayPal for this booking. Ask the studio to finish the payment.",
          );
      },
    });
    return { studio: s, approvalUrl: s.plan?.approvalUrl };
  }
  /** The buyer is back from PayPal: record the approved hold. */
  async function approved(
    owner: string,
    studio: Studio,
    token: string,
    orderId: string,
  ): Promise<Studio> {
    if (studio.mode === "practice")
      throw new DomainError(
        "This is a practice booking. There is no PayPal payment to approve.",
      );
    checkoutAccess(owner, studio.mode, false);
    const matches = (s: Studio) => {
      const p = assertCurrent(s, token);
      if (!p.orderId || p.orderId !== orderId)
        throw new DomainError(
          "This PayPal checkout doesn't match your booking.",
          400,
        );
      return p;
    };
    const p = matches(studio);
    // A reload of the return page: the hold is already recorded.
    if (p.authorizationId || p.committed) return studio;
    return deps.payments.finishApproval(owner, orderId, (s) => {
      const p = matches(s);
      if (p.status !== "authorized") assertCheckoutOpen(s, token, now());
    });
  }
  return { pay, approved };
}
