import { getChatGPTUser } from "@/app/chatgpt-auth";
import { DomainError } from "./domain";
import { PayPalError } from "./paypal";
import { guestId, guestCookie } from "./guest";
export async function workspace(req: Request, create = false) {
  const user = await getChatGPTUser();
  if (user) return { owner: user.userId, guest: false, cookie: undefined };
  const existing = guestId(req.headers.get("cookie"));
  if (!existing && !create)
    throw new DomainError("Open the studio first, then try again.", 401);
  const id = existing || crypto.randomUUID();
  return {
    owner: "guest:" + id,
    guest: true,
    cookie: existing
      ? undefined
      : guestCookie(id, new URL(req.url).protocol === "https:"),
  };
}
export function sameOrigin(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin || origin !== new URL(req.url).origin)
    throw new DomainError(
      "Please make this change from the MakeRoom app.",
      403,
    );
}
export async function body(req: Request) {
  if (Number(req.headers.get("content-length") || 0) > 20000)
    throw new DomainError("Request is too large.", 413);
  const text = await req.text();
  if (text.length > 20000) throw new DomainError("Request is too large.", 413);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed;
  } catch {
    throw new DomainError("Please send a valid JSON object.", 400);
  }
}
export const json = (value: unknown, status = 200, cookie?: string) =>
  Response.json(value, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...(cookie ? { "Set-Cookie": cookie } : {}),
    },
  });
export function failure(e: unknown) {
  if (e instanceof DomainError) return json({ error: e.message }, e.status);
  if (e instanceof PayPalError)
    return json({ error: e.message, debugId: e.debugId }, 502);
  if (e instanceof Error && e.name === "ZodError")
    return json({ error: "Please check the details and try again." }, 400);
  console.error(
    "MakeRoom request failed",
    e instanceof Error ? e.name : "unknown",
  );
  return json(
    {
      error:
        "That step didn't finish. Your saved records are still available. Refresh and try again.",
    },
    500,
  );
}
