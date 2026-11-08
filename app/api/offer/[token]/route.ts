import { z } from "zod";
import { sameOrigin, body, json, failure } from "@/lib/http";
import { offerOwner, updateStudio } from "@/lib/store";
import { consent, expire, type Studio } from "@/lib/domain";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
function view(s: Studio, token: string) {
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
export async function GET(_req: Request, ctx: Context) {
  try {
    const { token } = await ctx.params;
    const { owner, studio } = await offerOwner(token);
    const s =
      studio.plan?.status === "proposed" &&
      Date.parse(studio.plan.expiresAt) < Date.now()
        ? await updateStudio(owner, (s) => expire(s))
        : studio;
    return json(view(s, token));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: Request, ctx: Context) {
  try {
    sameOrigin(req);
    const { token } = await ctx.params;
    const { owner } = await offerOwner(token);
    const data = z
      .object({ answer: z.enum(["accepted", "declined"]) })
      .strict()
      .parse(await body(req));
    const s = await updateStudio(owner, (s) => consent(s, token, data.answer));
    return json(view(s, token));
  } catch (e) {
    return failure(e);
  }
}
