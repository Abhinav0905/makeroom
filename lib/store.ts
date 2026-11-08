import { env } from "cloudflare:workers";
import { seed, DomainError, type Studio } from "./domain";
function db() {
  if (!env.DB) throw new Error("Studio storage is unavailable.");
  return env.DB;
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
export async function saveOffers(owner: string, s: Studio) {
  if (!s.plan?.moves.length) return;
  await db().batch(
    s.plan.moves.map((m) =>
      db()
        .prepare(
          "INSERT OR REPLACE INTO offers (token,owner,plan_id,expires_at) VALUES (?,?,?,?)",
        )
        .bind(m.token, owner, s.plan!.id, s.plan!.expiresAt),
    ),
  );
}
export async function offerOwner(token: string) {
  if (!/^[a-f0-9-]{72}$/.test(token))
    throw new DomainError("Offer not found.", 404);
  const o = await db()
    .prepare("SELECT owner,plan_id FROM offers WHERE token=?")
    .bind(token)
    .first<{ owner: string; plan_id: string }>();
  if (!o) throw new DomainError("Offer not found.", 404);
  const s = await readStudio(o.owner);
  if (s.plan?.id !== o.plan_id || !s.plan.moves.some((m) => m.token === token))
    throw new DomainError(
      "The studio has replaced this offer. Ask for the latest link.",
      410,
    );
  return { owner: o.owner, studio: s };
}
