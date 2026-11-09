export type Mode = "practice" | "sandbox";
export type Alternative = { start: number; refund: number };
export type Booking = {
  id: string;
  name: string;
  initials: string;
  service: string;
  start: number;
  duration: number;
  prepaid: number;
  refunded: number;
  color: string;
  preference: string;
  alternatives: Alternative[];
  preferenceSource: "reviewed" | "ai";
  captureId?: string;
  fundingOrderId?: string;
  fundingKey?: string;
  fundingCaptureKey?: string;
  fundingApprovalUrl?: string;
  aiDraft?: {
    message: string;
    model: string;
    alternatives: Alternative[];
    explanation: string;
    clarification: string | null;
    evidence: string[];
  };
};
export type BookingRequest = {
  name: string;
  service: string;
  start: number;
  duration: number;
  budget: number;
  base: number;
};
export type Move = {
  bookingId: string;
  name: string;
  from: number;
  to: number;
  duration: number;
  refund: number;
  consent: "waiting" | "accepted" | "declined";
  token: string;
  refundKey: string;
  refundId?: string;
  refundStatus?: string;
  refundAttemptAt?: string;
  refundError?: string;
  previousRefundIds?: string[];
};
export type Plan = {
  id: string;
  createdAt: string;
  expiresAt: string;
  request: BookingRequest;
  moves: Move[];
  totalRefund: number;
  totalCharge: number;
  status:
    | "proposed"
    | "declined"
    | "expired"
    | "authorized"
    | "captured"
    | "settling"
    | "complete"
    | "cancelled"
    | "review";
  orderKey: string;
  authorizeKey: string;
  captureKey: string;
  voidKey?: string;
  orderId?: string;
  approvalUrl?: string;
  authorizationId?: string;
  captureId?: string;
  captureStatus?: string;
  failedCaptureIds?: string[];
  committed?: boolean;
  error?: string;
  paymentAttemptAt?: string;
};
export type AuditEvent = {
  id: string;
  at: string;
  title: string;
  detail: string;
  kind: "plan" | "consent" | "payment" | "notice";
};
export type Studio = {
  version: number;
  date: string;
  mode: Mode;
  bookings: Booking[];
  request: BookingRequest;
  plan: Plan | null;
  events: AuditEvent[];
  operation?: { id: string; kind: string; startedAt: string };
};
export class DomainError extends Error {
  status: number;
  constructor(message: string, status = 409) {
    super(message);
    this.status = status;
    this.name = "DomainError";
  }
}
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
export const time = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  return `${h % 12 || 12}:${String(minutes % 60).padStart(2, "0")} ${h >= 12 ? "pm" : "am"}`;
};
export const id = () => crypto.randomUUID();
export const overlap = (a: number, ad: number, b: number, bd: number) =>
  a < b + bd && b < a + ad;
export function event(
  s: Studio,
  title: string,
  detail: string,
  kind: AuditEvent["kind"] = "notice",
) {
  s.events.unshift({
    id: id(),
    at: new Date().toISOString(),
    title,
    detail,
    kind,
  });
  s.events = s.events.slice(0, 200);
}
export function seed(): Studio {
  return {
    version: 0,
    date: "2026-11-12",
    mode: "practice",
    bookings: [
      {
        id: "alex",
        name: "Alex Morgan",
        initials: "AM",
        service: "Headshot session",
        start: 840,
        duration: 60,
        prepaid: 6000,
        refunded: 0,
        color: "apricot",
        preference: "I can move to 1 pm for $15 back.",
        alternatives: [{ start: 780, refund: 1500 }],
        preferenceSource: "reviewed",
      },
      {
        id: "sam",
        name: "Sam Rivera",
        initials: "SR",
        service: "Portrait session",
        start: 900,
        duration: 60,
        prepaid: 6000,
        refunded: 0,
        color: "sage",
        preference: "4 pm works for me for $10 back. I can't do earlier.",
        alternatives: [{ start: 960, refund: 1000 }],
        preferenceSource: "reviewed",
      },
    ],
    request: {
      name: "Maya Chen",
      service: "Editorial portrait session",
      start: 840,
      duration: 120,
      budget: 2500,
      base: 12000,
    },
    plan: null,
    events: [
      {
        id: id(),
        at: new Date().toISOString(),
        title: "Your practice studio is ready",
        detail:
          "Alex and Sam are fictional customers with reviewed flexibility terms. No money has moved.",
        kind: "notice",
      },
    ],
  };
}
export function assertEditable(s: Studio) {
  if (s.operation)
    throw new DomainError(
      "A payment is being checked. Please wait before changing the calendar.",
    );
  if (s.plan?.orderId && !["cancelled", "complete"].includes(s.plan.status))
    throw new DomainError(
      "Finish or cancel the current checkout before changing these bookings.",
    );
  if (s.plan?.committed)
    throw new DomainError(
      "This booking is already confirmed. Start a new practice studio to try another scenario.",
    );
}
export function expire(s: Studio, now = Date.now()) {
  const p = s.plan;
  if (
    p &&
    p.status === "proposed" &&
    Date.parse(p.expiresAt) < now &&
    !s.operation
  ) {
    p.status = "expired";
    event(s, "Offer expired", "The original bookings are unchanged.", "notice");
  }
}
export function validateRequest(r: BookingRequest) {
  if (
    !r.name.trim() ||
    r.name.length > 80 ||
    !r.service.trim() ||
    r.service.length > 120
  )
    throw new DomainError("Add a customer name and session type.", 400);
  for (const n of [r.start, r.duration, r.budget, r.base])
    if (!Number.isSafeInteger(n))
      throw new DomainError(
        "Times and prices must be whole minutes and cents.",
        400,
      );
  if (
    r.start < 780 ||
    r.start + r.duration > 1020 ||
    r.start % 15 ||
    ![60, 90, 120].includes(r.duration)
  )
    throw new DomainError(
      "Choose a 60, 90 or 120 minute session between 1 and 5 pm.",
      400,
    );
  if (r.budget < 0 || r.budget > 10000 || r.base !== r.duration * 100)
    throw new DomainError(
      "The studio rate is $60 per hour. Flexibility budget must be $0–$100.",
      400,
    );
}
export type Candidate = { bookingId: string; start: number; refund: number };
export function solve(
  bookings: Booking[],
  request: BookingRequest,
): { choices: Candidate[]; cost: number } | null {
  validateRequest(request);
  let best: { choices: Candidate[]; cost: number } | null = null;
  function visit(i: number, choices: Candidate[], cost: number, moves: number) {
    if (cost > request.budget || moves > 2) return;
    if (i === bookings.length) {
      if (
        !best ||
        cost < best.cost ||
        (cost === best.cost &&
          choices.filter((c, j) => c.start !== bookings[j].start).length <
            best.choices.filter((c, j) => c.start !== bookings[j].start).length)
      )
        best = { choices: [...choices], cost };
      return;
    }
    const b = bookings[i];
    const opts = [
      { start: b.start, refund: 0 },
      ...b.alternatives.filter((a) => a.start !== b.start),
    ];
    for (const o of opts) {
      if (
        !Number.isSafeInteger(o.start) ||
        !Number.isSafeInteger(o.refund) ||
        o.start < 780 ||
        o.start + b.duration > 1020 ||
        o.start % 15 ||
        o.refund < 0 ||
        o.refund > b.prepaid - b.refunded
      )
        continue;
      if (overlap(o.start, b.duration, request.start, request.duration))
        continue;
      if (
        choices.some((c, j) =>
          overlap(o.start, b.duration, c.start, bookings[j].duration),
        )
      )
        continue;
      visit(
        i + 1,
        [...choices, { bookingId: b.id, ...o }],
        cost + o.refund,
        moves + (o.start !== b.start ? 1 : 0),
      );
    }
  }
  visit(0, [], 0, 0);
  return best;
}
export function propose(
  s: Studio,
  request: BookingRequest,
  now = Date.now(),
): Plan {
  assertEditable(s);
  validateRequest(request);
  const result = solve(s.bookings, request);
  if (!result) {
    const unlimited = solve(s.bookings, { ...request, budget: 10000 });
    if (unlimited)
      throw new DomainError(
        `The least expensive arrangement needs ${money(unlimited.cost)} in refunds, above your ${money(request.budget)} budget. Increase the budget or review the customers' terms.`,
        422,
      );
    throw new DomainError(
      "No arrangement fits these customer-approved alternatives. Try a different time or ask about another option.",
      422,
    );
  }
  const moves: Move[] = result.choices.flatMap((c, i) =>
    c.start === s.bookings[i].start
      ? []
      : [
          {
            bookingId: c.bookingId,
            name: s.bookings[i].name,
            from: s.bookings[i].start,
            to: c.start,
            duration: s.bookings[i].duration,
            refund: c.refund,
            consent: "waiting" as const,
            token: id() + id(),
            refundKey: id(),
          },
        ],
  );
  const p: Plan = {
    id: id(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30 * 60_000).toISOString(),
    request: { ...request },
    moves,
    totalRefund: result.cost,
    totalCharge: request.base + result.cost,
    status: "proposed",
    orderKey: id(),
    authorizeKey: id(),
    captureKey: id(),
    voidKey: id(),
  };
  s.request = { ...request };
  s.plan = p;
  event(
    s,
    "An arrangement is ready",
    `${moves.length} voluntary move${moves.length === 1 ? "" : "s"} could open ${time(request.start)}–${time(request.start + request.duration)} for ${money(result.cost)} in refunds.`,
    "plan",
  );
  return p;
}
export function consent(
  s: Studio,
  token: string,
  answer: "accepted" | "declined",
  now = Date.now(),
) {
  expire(s, now);
  const p = s.plan;
  const m = p?.moves.find((x) => x.token === token);
  if (!p || !m)
    throw new DomainError("This offer is no longer available.", 404);
  if (p.status !== "proposed" || p.orderId || s.operation)
    throw new DomainError("This offer has closed. Please contact the studio.");
  if (m.consent !== "waiting") {
    if (m.consent === answer) return;
    throw new DomainError(
      "Your response is already recorded. Contact the studio to change it.",
    );
  }
  m.consent = answer;
  if (answer === "declined") p.status = "declined";
  event(
    s,
    `${m.name.split(" ")[0]} ${answer === "accepted" ? "accepted" : "declined"} the move`,
    answer === "accepted"
      ? `${time(m.from)} → ${time(m.to)}, with ${money(m.refund)} back.`
      : "The original appointments are unchanged.",
    "consent",
  );
}
export function assertReady(s: Studio) {
  expire(s);
  const p = s.plan;
  if (
    !p ||
    p.status !== "proposed" ||
    p.moves.some((m) => m.consent !== "accepted")
  )
    throw new DomainError(
      "Every affected customer must accept the current offer before checkout.",
    );
  if (
    s.mode === "sandbox" &&
    s.bookings.some(
      (b) => p.moves.some((m) => m.bookingId === b.id) && !b.captureId,
    )
  )
    throw new DomainError(
      "Fund the original bookings through PayPal sandbox before requesting a paid move.",
    );
  return p;
}
export function commit(s: Studio) {
  const p = s.plan;
  if (!p?.captureId || p.captureStatus !== "COMPLETED")
    throw new DomainError(
      "The new payment must be confirmed before moving appointments.",
    );
  if (p.committed) return;
  for (const m of p.moves) {
    const b = s.bookings.find((b) => b.id === m.bookingId);
    if (!b || b.start !== m.from)
      throw new DomainError(
        "The calendar changed. This payment needs manual review.",
      );
    b.start = m.to;
  }
  p.committed = true;
  p.status = "settling";
  event(
    s,
    "Booking confirmed",
    `${p.request.name}'s ${p.request.duration}-minute session is booked. The agreed refunds are now due.`,
    "payment",
  );
}
export function practiceSettle(s: Studio) {
  if (s.mode !== "practice")
    throw new DomainError(
      "Practice checkout is unavailable for a PayPal sandbox studio.",
      403,
    );
  const p = assertReady(s);
  p.orderId = "PRACTICE-" + id();
  p.authorizationId = "PRACTICE-" + id();
  p.captureId = "PRACTICE-" + id();
  p.captureStatus = "COMPLETED";
  commit(s);
  for (const m of p.moves) {
    m.refundId = "PRACTICE-" + id();
    m.refundStatus = "COMPLETED";
    s.bookings.find((b) => b.id === m.bookingId)!.refunded += m.refund;
  }
  p.status = "complete";
  event(
    s,
    "Practice payments complete",
    `Simulated charge: ${money(p.totalCharge)}. Simulated refunds: ${money(p.totalRefund)}. No real or sandbox money moved.`,
    "payment",
  );
}
