import { env } from "cloudflare:workers";
import { seed, DomainError, type Studio } from "./domain";
import { createLinks, type LinkRow } from "./links";
function db() {
  if (!env.DB) throw new Error("Studio storage is unavailable.");
  return env.DB;
}
export async function reserveAIRead(owner: string) {
  const day = new Date().toISOString().slice(0, 10);
  // Atomic increments enforce both limits even across concurrent requests.
  for (const [key, limit] of [
    [day + ":all", 200],
    [day + ":" + owner, 20],
  ] as const) {
    const result = await db()
      .prepare(
        "INSERT INTO ai_usage (bucket,count) VALUES (?,1) ON CONFLICT(bucket) DO UPDATE SET count=count+1 WHERE count < ? RETURNING count",
      )
      .bind(key, limit)
      .first<{ count: number }>();
    if (!result)
      throw new DomainError(
        "The demo's AI allowance is used for today. You can still review terms manually and try the full practice flow.",
        429,
      );
  }
}
export async function readStudio(owner: string): Promise<Studio> {
  const row = await db()
    .prepare("SELECT version,data FROM studios WHERE owner=?")
    .bind(owner)
    .first<{ version: number; data: string }>();
  if (row) return { ...JSON.parse(row.data), version: row.version };
  const initial = seed();
  await db()
    .prepare(
      "INSERT OR IGNORE INTO studios (owner,version,data,updated_at) VALUES (?,0,?,?)",
    )
    .bind(owner, JSON.stringify(initial), new Date().toISOString())
    .run();
  return readStudio(owner);
}
export async function updateStudio(
  owner: string,
  fn: (s: Studio) => void,
  expectedVersion?: number,
): Promise<Studio> {
  const s = await readStudio(owner);
  const version = s.version;
  if (expectedVersion !== undefined && version !== expectedVersion)
    throw new DomainError(
      "The studio changed in another tab. Refresh and try again.",
    );
  fn(s);
  s.version = version + 1;
  const result = await db()
    .prepare(
      "UPDATE studios SET data=?,version=?,updated_at=? WHERE owner=? AND version=?",
    )
    .bind(
      JSON.stringify(s),
      s.version,
      new Date().toISOString(),
      owner,
      version,
    )
    .run();
  if (result.meta.changes !== 1)
    throw new DomainError(
      "The studio changed in another tab. Refresh and try again.",
    );
  return s;
}
// Registers every link of the current plan: each moved customer's offer and
// the new customer's checkout. A plan with no moves still has a checkout.
export async function saveOffers(owner: string, s: Studio) {
  const p = s.plan;
  if (!p) return;
  const tokens = p.moves.map((m) => m.token);
  if (p.checkoutToken) tokens.push(p.checkoutToken);
  if (!tokens.length) return;
  await db().batch(
    tokens.map((token) =>
      db()
        .prepare(
          "INSERT OR REPLACE INTO offers (token,owner,plan_id,expires_at) VALUES (?,?,?,?)",
        )
        .bind(token, owner, p.id, p.expiresAt),
    ),
  );
}
// Offer and checkout links: only the current plan's link of the right kind.
export const { offerOwner, checkoutOwner } = createLinks({
  findLink: (token) =>
    db()
      .prepare("SELECT owner,plan_id FROM offers WHERE token=?")
      .bind(token)
      .first<LinkRow>(),
  readStudio,
});
