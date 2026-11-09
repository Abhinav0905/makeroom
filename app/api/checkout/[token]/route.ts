import { z } from "zod";
import { sameOrigin, body, json, failure } from "@/lib/http";
import { checkoutOwner, updateStudio } from "@/lib/store";
import { expire } from "@/lib/domain";
import { checkoutAccess, currentCheckoutView as view } from "@/lib/checkout";
import { pagesOrigin, pagesCors, pagesPreflight } from "@/lib/pages-access";
import { checkout } from "@/lib/payments-service";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pay") }).strict(),
  z
    .object({ action: z.literal("approved"), orderId: z.string().min(1).max(100) })
    .strict(),
]);
async function open(req: Request, ctx: Context) {
  const { token } = await ctx.params;
  const { owner, studio } = await checkoutOwner(token);
  checkoutAccess(owner, studio.mode, pagesOrigin(req));
  return { token, owner, studio };
}
async function get(req: Request, ctx: Context) {
  try {
    const { token, owner, studio } = await open(req, ctx);
    const s =
      studio.plan?.status === "proposed" &&
      Date.parse(studio.plan.expiresAt) < Date.now() &&
      !studio.operation
        ? await updateStudio(owner, (s) => expire(s))
        : studio;
    return json(view(s, token));
  } catch (e) {
    return failure(e);
  }
}
async function post(req: Request, ctx: Context) {
  try {
    sameOrigin(req);
    const { token, owner, studio } = await open(req, ctx);
    const data = actionSchema.parse(await body(req));
    if (data.action === "pay") {
      const r = await checkout.pay(owner, studio, token, new URL(req.url).origin);
      return json({ ...view(r.studio, token), approvalUrl: r.approvalUrl });
    }
    const s = await checkout.approved(owner, studio, token, data.orderId);
    return json(view(s, token));
  } catch (e) {
    return failure(e);
  }
}
export const OPTIONS = pagesPreflight;
export async function GET(req: Request, ctx: Context) { return pagesCors(req, await get(req, ctx)); }
export async function POST(req: Request, ctx: Context) { return pagesCors(req, await post(req, ctx)); }
