// Finding the studio behind a customer link. Every link of a plan (each moved
// customer's offer and the new customer's checkout) is a row in the offers
// table: token -> owner and plan. A link works only for the studio's current
// plan and only as its own kind. Storage is injected, so node:test can check
// the 404/410 answers without Cloudflare bindings.
import { DomainError, type Studio } from "./domain.ts";
export const LINK_TOKEN = /^[a-f0-9-]{72}$/;
export type LinkRow = { owner: string; plan_id: string };
export type LinkDeps = {
  findLink(token: string): Promise<LinkRow | null>;
  readStudio(owner: string): Promise<Studio>;
};
export function createLinks(deps: LinkDeps) {
  async function find(
    token: string,
    isKind: (s: Studio) => boolean,
    notFound: string,
    replaced: string,
  ) {
    if (!LINK_TOKEN.test(token)) throw new DomainError(notFound, 404);
    const row = await deps.findLink(token);
    if (!row) throw new DomainError(notFound, 404);
    const studio = await deps.readStudio(row.owner);
    // Another plan now: the studio replaced or reset it.
    if (studio.plan?.id !== row.plan_id) throw new DomainError(replaced, 410);
    // The current plan's link of the other kind.
    if (!isKind(studio)) throw new DomainError(notFound, 404);
    return { owner: row.owner, studio };
  }
  /** A moved customer's offer link. */
  const offerOwner = (token: string) =>
    find(
      token,
      (s) => !!s.plan?.moves.some((m) => m.token === token),
      "Offer not found.",
      "The studio has replaced this offer. Ask for the latest link.",
    );
  /** The new customer's checkout link. */
  const checkoutOwner = (token: string) =>
    find(
      token,
      (s) => !!s.plan?.checkoutToken && s.plan.checkoutToken === token,
      "This booking link wasn't found.",
      "The studio has replaced this booking link. Ask for the latest one.",
    );
  return { offerOwner, checkoutOwner };
}
