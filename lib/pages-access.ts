// GitHub Pages has no server runtime. Its public practice client calls the
// existing API without cookies, using a separate, practice-only namespace.
export const PAGES_ORIGIN = "https://abhinav0905.github.io";
export const PRACTICE_HEADER = "X-MakeRoom-Practice";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function pagesOrigin(req: Request) {
  return req.headers.get("origin") === PAGES_ORIGIN;
}
export function pagesIdentity(req: Request) {
  const id = req.headers.get(PRACTICE_HEADER);
  return pagesOrigin(req) && id && UUID.test(id) ? "pages:" + id : null;
}
export function pagesCors(req: Request, response: Response) {
  if (!pagesOrigin(req)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", PAGES_ORIGIN);
  headers.set("Vary", "Origin");
  // Cookies and other browser credentials are deliberately never permitted.
  headers.delete("Set-Cookie");
  return new Response(response.body, { status: response.status, headers });
}
export function pagesPreflight(req: Request) {
  const method = req.headers.get("access-control-request-method");
  const requested = (req.headers.get("access-control-request-headers") || "")
    .toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  if (!pagesOrigin(req) || !["GET", "POST"].includes(method || "") ||
      requested.some((x) => !["content-type", PRACTICE_HEADER.toLowerCase()].includes(x)))
    return new Response(null, { status: 403 });
  return pagesCors(req, new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, " + PRACTICE_HEADER,
      "Access-Control-Max-Age": "600",
      "Cache-Control": "no-store",
    },
  }));
}
