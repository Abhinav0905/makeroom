// In-memory stand-in for lib/store.ts: one JSON row per owner with a version
// compare-and-swap, seeded on first read. Every read returns a fresh copy,
// as the D1 store does.
import { DomainError, seed, type Studio } from "../../lib/domain.ts";
export function memoryStore() {
  const rows = new Map<string, { version: number; data: string }>();
  async function readStudio(owner: string): Promise<Studio> {
    const row = rows.get(owner);
    if (row) return { ...JSON.parse(row.data), version: row.version };
    rows.set(owner, { version: 0, data: JSON.stringify(seed()) });
    return readStudio(owner);
  }
  async function updateStudio(
    owner: string,
    fn: (s: Studio) => void,
  ): Promise<Studio> {
    const s = await readStudio(owner);
    const version = s.version;
    fn(s);
    s.version = version + 1;
    if (rows.get(owner)?.version !== version)
      throw new DomainError(
        "The studio changed in another tab. Refresh and try again.",
      );
    rows.set(owner, { version: s.version, data: JSON.stringify(s) });
    return s;
  }
  /** Store a studio as-is, replacing any existing row. */
  function put(owner: string, s: Studio) {
    rows.set(owner, { version: s.version, data: JSON.stringify(s) });
  }
  /** Read the stored studio synchronously (a fresh copy). */
  function get(owner: string): Studio {
    const row = rows.get(owner);
    if (!row) throw new Error("No studio stored for " + owner);
    return { ...JSON.parse(row.data), version: row.version };
  }
  return { readStudio, updateStudio, put, get };
}
