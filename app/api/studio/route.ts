import { z } from "zod";
import { workspace, sameOrigin, body, json, failure } from "@/lib/http";
import { guestActionAllowed } from "@/lib/guest";
import {
  readStudio,
  updateStudio,
  saveOffers,
  reserveAIRead,
} from "@/lib/store";
import {
  DomainError,
  seed,
  assertEditable,
  propose,
  practiceSettle,
  event,
  expire,
  type BookingRequest,
  type Studio,
} from "@/lib/domain";
import { integrationStatus } from "@/lib/config";
import { interpret } from "@/lib/ai";
import * as payments from "@/lib/payments-service";
export const dynamic = "force-dynamic";
const requestSchema = z
  .object({
    name: z.string().min(1).max(80),
    service: z.string().min(1).max(120),
    start: z.number().int(),
    duration: z.number().int(),
    budget: z.number().int(),
    base: z.number().int(),
  })
  .strict();
const preferenceSchema = z
  .object({
    bookingId: z.string().max(30),
    message: z.string().max(1500),
    alternatives: z
      .array(
        z
          .object({
            start: z.number().int().min(780).max(960).multipleOf(15),
            refund: z.number().int().min(0).max(6000),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
export async function GET(req: Request) {
  try {
    const { owner, guest, cookie } = await workspace(req, true);
    let s = await readStudio(owner);
    if (
      s.plan?.status === "proposed" &&
      Date.parse(s.plan.expiresAt) < Date.now() &&
      !s.operation
    )
      s = await updateStudio(owner, (s) => expire(s));
    return json(
      { studio: s, integrations: { ...integrationStatus(), guest } },
      200,
      cookie,
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request) {
  try {
    sameOrigin(req);
    const { owner, guest } = await workspace(req);
    const b = await body(req);
    const action = z.string().max(40).parse(b.action);
    if (guest && !guestActionAllowed(action, b.mode))
      throw new DomainError(
        "Guest studios use simulated payments. Sign in or run locally to test PayPal sandbox.",
        403,
      );
    const current = await readStudio(owner);
    if (b.version !== undefined && b.version !== current.version)
      throw new DomainError(
        "The studio changed in another tab. Refresh before continuing.",
      );
    const update = (fn: (s: Studio) => void) =>
      updateStudio(owner, fn, current.version);
    const origin = new URL(req.url).origin;
    let s = current;
    if (action === "plan") {
      const r = requestSchema.parse(b.request) as BookingRequest;
      s = await update((s) => propose(s, r));
      await saveOffers(owner, s);
    } else if (action === "preference") {
      const p = preferenceSchema.parse(b.preference);
      s = await update((s) => {
        assertEditable(s);
        const booking = s.bookings.find((x) => x.id === p.bookingId);
        if (!booking) throw new DomainError("Booking not found.", 404);
        if (
          p.alternatives.some(
            (a) =>
              a.start + booking.duration > 1020 ||
              a.refund > booking.prepaid - booking.refunded,
          )
        )
          throw new DomainError(
            "The terms exceed this booking's time or refund limits.",
            400,
          );
        const fromAI =
          booking.aiDraft?.message === p.message &&
          p.alternatives.length > 0 &&
          p.alternatives.every((a) =>
            booking.aiDraft!.alternatives.some(
              (x) => x.start === a.start && x.refund === a.refund,
            ),
          );
        booking.preference = p.message;
        booking.alternatives = p.alternatives;
        booking.preferenceSource = fromAI ? "ai" : "reviewed";
        delete booking.aiDraft;
        s.plan = null;
        event(
          s,
          "Flexibility terms reviewed",
          booking.name +
            "'s exact alternatives were saved. Any earlier offer is no longer valid.",
          "consent",
        );
      });
    } else if (action === "interpret") {
      const bookingId = z.string().parse(b.bookingId);
      const message = z.string().min(3).max(1500).parse(b.message);
      assertEditable(current);
      const booking = current.bookings.find((x) => x.id === bookingId);
      if (!booking) throw new DomainError("Booking not found.", 404);
      await reserveAIRead(owner);
      const result = await interpret(message, booking);
      s = await update((s) => {
        if (s.version !== current.version)
          throw new DomainError(
            "The studio changed while the message was being read. Please try again.",
          );
        assertEditable(s);
        const target = s.bookings.find((x) => x.id === bookingId)!;
        target.aiDraft = {
          message,
          model: result.model,
          alternatives: result.draft.alternatives.map((a) => ({
            start: Number(a.start.slice(0, 2)) * 60 + Number(a.start.slice(3)),
            refund: a.refundCents,
          })),
          explanation: result.draft.explanation,
          clarification: result.draft.clarification,
          evidence: result.draft.alternatives.map((a) => a.evidence),
        };
        event(
          s,
          "AI interpretation ready",
          result.model +
            " proposed terms for " +
            booking.name +
            ". Review is still required.",
          "notice",
        );
      });
    } else if (action === "practice-settle") {
      s = await update((s) => practiceSettle(s));
    } else if (action === "reset") {
      s = await update((s) => {
        if (
          s.operation ||
          (s.mode === "sandbox" &&
            s.bookings.some((b) => b.fundingOrderId || b.captureId)) ||
          (s.mode === "sandbox" && s.plan?.orderId)
        )
          throw new DomainError(
            "Sandbox payment records cannot be reset. Keep them for reconciliation.",
          );
        const version = s.version;
        Object.assign(s, seed(), { version });
      });
    } else if (action === "mode") {
      const mode = z.enum(["practice", "sandbox"]).parse(b.mode);
      if (mode === "sandbox" && !integrationStatus().paypal)
        throw new DomainError(
          "Connect your PayPal sandbox credentials first.",
          503,
        );
      s = await update((s) => {
        if (
          s.operation ||
          (s.mode === "sandbox" &&
            (s.bookings.some((b) => b.fundingOrderId) || s.plan?.orderId))
        )
          throw new DomainError(
            "Keep this studio in sandbox mode while payment records exist.",
          );
        const version = s.version;
        Object.assign(s, seed(), { mode, version });
        if (mode === "sandbox") s.events = [];
        event(
          s,
          mode === "sandbox"
            ? "PayPal sandbox selected"
            : "Practice studio selected",
          mode === "sandbox"
            ? "Fund each original booking before creating an offer. Only test accounts are used."
            : "All payments are simulated.",
        );
      });
    } else if (action === "fund-booking")
      s = await payments.fundBooking(
        owner,
        z.string().parse(b.bookingId),
        origin,
      );
    else if (action === "finish-funding")
      s = await payments.finishFunding(
        owner,
        z.string().parse(b.bookingId),
        z.string().max(100).parse(b.orderId),
      );
    else if (action === "checkout")
      s = await payments.beginCheckout(owner, origin);
    else if (action === "finish-approval")
      s = await payments.finishApproval(
        owner,
        z.string().max(100).parse(b.orderId),
      );
    else if (action === "capture") s = await payments.captureAndSettle(owner);
    else if (action === "reconcile") s = await payments.reconcile(owner);
    else if (action === "cancel") {
      if (s.mode === "practice")
        s = await update((s) => {
          assertEditable(s);
          if (s.plan) {
            s.plan.status = "cancelled";
            event(s, "Offer cancelled", "Original bookings are unchanged.");
          }
        });
      else s = await payments.cancelCheckout(owner);
    } else throw new DomainError("Unknown studio action.", 400);
    return json({ studio: s, integrations: { ...integrationStatus(), guest } });
  } catch (e) {
    return failure(e);
  }
}
