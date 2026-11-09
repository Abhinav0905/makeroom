// Guest cookies identify isolated fictional practice records, never signed-in users.
export function guestId(cookie: string | null) {
  const value = cookie
    ?.split(";")
    .map((x) => x.trim())
    .find((x) => x.startsWith("makeroom_practice="))
    ?.slice(18);
  return value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      value,
    )
    ? value
    : null;
}
export function guestCookie(id: string, secure: boolean) {
  return `makeroom_practice=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400${secure ? "; Secure" : ""}`;
}
export function guestActionAllowed(action: string, mode?: unknown) {
  return (
    [
      "plan",
      "preference",
      "interpret",
      "practice-settle",
      "reset",
      "cancel",
    ].includes(action) ||
    (action === "mode" && mode === "practice")
  );
}
/** Cookie guest and GitHub Pages studios: practice only, never PayPal. */
export function guestOwner(owner: string) {
  return owner.startsWith("guest:") || owner.startsWith("pages:");
}
