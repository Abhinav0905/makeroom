declare global {
  interface Window {
    __MAKEROOM_STATIC__?: { basePath: string; apiOrigin: string };
  }
}
export function staticRuntime() {
  return typeof window === "undefined" ? undefined : window.__MAKEROOM_STATIC__;
}
export function appHref(path: string) {
  const config = staticRuntime();
  if (!config || !path.startsWith("/")) return path;
  if (path === "/") return config.basePath;
  if (path === "/proof") return config.basePath + "?view=proof";
  if (path.startsWith("/offer/")) return config.basePath + "?offer=" + encodeURIComponent(path.slice(7));
  if (path.startsWith("/checkout/")) return config.basePath + "?checkout=" + encodeURIComponent(path.slice(10));
  if (path.startsWith("/signin-with-chatgpt")) return config.apiOrigin + path;
  return config.basePath + path.slice(1);
}
export function apiFetch(path: string, init: RequestInit = {}) {
  const config = staticRuntime();
  if (!config) return fetch(path, init);
  let id = localStorage.getItem("makeroom-pages-practice");
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    id = crypto.randomUUID();
    localStorage.setItem("makeroom-pages-practice", id);
  }
  const headers = new Headers(init.headers);
  headers.set("X-MakeRoom-Practice", id);
  return fetch(config.apiOrigin + path, { ...init, headers, credentials: "omit" });
}
