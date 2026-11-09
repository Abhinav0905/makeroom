import test from "node:test";
import assert from "node:assert/strict";
import { PAGES_ORIGIN, PRACTICE_HEADER, pagesIdentity, pagesPreflight, pagesCors } from "../lib/pages-access.ts";
const id = "32a76fb4-2e68-465a-8c4b-a8e4f01cd365";
function request(origin = PAGES_ORIGIN, session = id) {
  return new Request("https://api.example/api/studio", { headers: { origin, [PRACTICE_HEADER]: session } });
}
test("Pages identities never overlap signed-in or cookie guest studios", () => {
  assert.equal(pagesIdentity(request()), "pages:" + id);
  assert.equal(pagesIdentity(request("https://unrelated.example")), null);
  assert.equal(pagesIdentity(request(PAGES_ORIGIN, "owner-user-id")), null);
  assert.equal(pagesIdentity(request(PAGES_ORIGIN, "guest:" + id)), null);
});
test("Pages preflight allows only its origin, methods and explicit headers", () => {
  const preflight = (origin: string, method: string, headers: string) => pagesPreflight(new Request("https://api.example/api/studio", { method: "OPTIONS", headers: { origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": headers } }));
  const ok = preflight(PAGES_ORIGIN, "POST", "Content-Type, X-MakeRoom-Practice");
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), PAGES_ORIGIN);
  assert.equal(ok.headers.has("Access-Control-Allow-Credentials"), false);
  assert.equal(preflight("https://attacker.example", "POST", "X-MakeRoom-Practice").status, 403);
  assert.equal(preflight(PAGES_ORIGIN, "DELETE", "X-MakeRoom-Practice").status, 403);
  assert.equal(preflight(PAGES_ORIGIN, "POST", "Authorization").status, 403);
});
test("Pages responses cannot set cookies or grant credentialed access", () => {
  const response = pagesCors(request(), new Response("ok", { headers: { "Set-Cookie": "private=example" } }));
  assert.equal(response.headers.has("Set-Cookie"), false);
  assert.equal(response.headers.has("Access-Control-Allow-Credentials"), false);
  assert.equal(response.headers.get("Vary"), "Origin");
  assert.equal(pagesCors(request("https://attacker.example"), new Response("no")).headers.has("Access-Control-Allow-Origin"), false);
});
