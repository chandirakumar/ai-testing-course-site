// Three jobs.
// 1) Serve the public site: requests for existing files are answered by Cloudflare's asset handling
//    before this code runs, so fetch() only sees misses.
// 2) Gate the course area: /learn/<course>/... is served from the COURSE_FILES KV namespace, only to a
//    signed-in learner whose account holds that course. The check is Supabase's own has_course() run
//    with the learner's token, so row-level security decides, not this file.
// 3) Keep the Supabase free-tier project awake with a daily read (free projects pause after seven idle days).
// On the dev site (SITE_ENV = "dev", dev.aiskillszone.com) it also asks for a password on every request, tells
// search engines to stay away, and points every page at the dev Supabase project instead of the live one.

const GATE = /^\/learn\/([a-z0-9-]+)\/(.*)$/;
const TYPES = { html: "text/html; charset=utf-8", txt: "text/plain; charset=utf-8", css: "text/css", js: "text/javascript", json: "application/json", svg: "image/svg+xml", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", pdf: "application/pdf", zip: "application/zip", ico: "image/x-icon" };
const COOKIE = "sb_access";

export default {
  async fetch(request, env) {
    if (env.SITE_ENV === "dev") return devSite(request, env);
    return serve(request, env);
  },

  async scheduled(_event, env) {
    const res = await fetch(env.SUPABASE_URL + "/rest/v1/courses?select=slug&limit=1", { headers: anon(env) });
    console.log("supabase keep-alive", res.status, await res.text());
  },
};

async function serve(request, env) {
    const url = new URL(request.url);
    const bare = /^\/learn\/([a-z0-9-]+)$/.exec(url.pathname);   // /learn/<course> without the slash
    if (bare) return Response.redirect(`${url.origin}${url.pathname}/${url.search}`, 301);
    const m = GATE.exec(url.pathname);
    if (!m) return env.ASSETS.fetch(request);

    const [, course, rest] = m;
    const token = readCookie(request.headers.get("cookie"), COOKIE);
    const signIn = () => Response.redirect(`${url.origin}/learn/?next=${encodeURIComponent(url.pathname + url.search)}`, 302);
    if (!token) return signIn();

    const allowed = await hasCourse(env, token, course);
    if (allowed === null) return signIn();                      // token missing, expired or forged: sign in again
    if (allowed === false) return Response.redirect(`${url.origin}/learn/?missing=${encodeURIComponent(course)}`, 302);

    const path = rest === "" ? "START-HERE.html" : rest.replace(/\/$/, "/index.html");
    const body = await env.COURSE_FILES.get(`${course}/${path}`, { type: "stream" });
    if (!body) return env.ASSETS.fetch(new Request(`${url.origin}/__missing__`, request)); // the site's 404 page
    const ext = (path.split(".").pop() || "").toLowerCase();
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[ext] || "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "same-origin",
      },
    });
}

// ---------------------------------------------------------------- dev site
async function devSite(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  if (!devAuthorised(request, env)) {
    return new Response("Dev site. Ask the owner for the password.", {
      status: 401, headers: { "WWW-Authenticate": 'Basic realm="AI Skills Zone dev", charset="UTF-8"', "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" },
    });
  }
  const res = await serve(request, env);
  const headers = new Headers(res.headers);
  headers.set("X-Robots-Tag", "noindex, nofollow");
  headers.set("Cache-Control", "private, no-store");   // nothing on dev is cached anywhere, course pages included
  if (!(headers.get("Content-Type") || "").includes("text/html")) return new Response(res.body, { status: res.status, headers });
  // Same HTML as the live site, pointed at the dev project, with a ribbon so nobody mistakes it for live.
  let html = await res.text();
  html = html.split(env.LIVE_SUPABASE_URL).join(env.SUPABASE_URL).split(env.LIVE_SUPABASE_PUBLISHABLE_KEY).join(env.SUPABASE_PUBLISHABLE_KEY);
  const ribbon = '<div style="position:fixed;left:0;right:0;top:0;z-index:2147483647;height:4px;background:repeating-linear-gradient(45deg,#F97316 0 12px,#111 12px 24px)"></div>'
    + '<div style="position:fixed;left:8px;bottom:8px;z-index:2147483647;padding:3px 8px;border-radius:6px;font:700 11px/1.4 system-ui,sans-serif;color:#111;background:#FBBF24;pointer-events:none">DEV · test payments only</div>';
  html = html.replace(/<body([^>]*)>/i, (m) => m + ribbon);
  headers.delete("Content-Length"); headers.delete("ETag");
  return new Response(html, { status: res.status, headers });
}

function devAuthorised(request, env) {
  const h = request.headers.get("Authorization") || "";
  if (!h.startsWith("Basic ") || !env.DEV_PASSWORD) return false;
  let decoded = "";
  try { decoded = atob(h.slice(6)); } catch { return false; }
  const pass = decoded.slice(decoded.indexOf(":") + 1);
  if (pass.length !== env.DEV_PASSWORD.length) return false;
  let diff = 0;
  for (let i = 0; i < pass.length; i++) diff |= pass.charCodeAt(i) ^ env.DEV_PASSWORD.charCodeAt(i);
  return diff === 0;
}

function anon(env, bearer) {
  return { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: "Bearer " + (bearer || env.SUPABASE_PUBLISHABLE_KEY) };
}

function readCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** true / false from has_course(); null when the token is not accepted.
 *  A "yes" is remembered for 60 seconds per token in this isolate, so a learner clicking through
 *  lessons costs one database round-trip a minute instead of one per page. Revoking access or a
 *  token therefore takes effect within a minute. A "no" is never remembered: someone who was turned
 *  away and then buys gets in on their very next click. */
const ACCESS_CACHE = new Map();
async function hasCourse(env, token, course) {
  const key = course + ":" + token.slice(-48);
  const hit = ACCESS_CACHE.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = await hasCourseUncached(env, token, course);
  if (value === true) {
    if (ACCESS_CACHE.size > 5000) ACCESS_CACHE.clear();
    ACCESS_CACHE.set(key, { value, until: Date.now() + 60000 });
  }
  return value;
}
async function hasCourseUncached(env, token, course) {
  const res = await fetch(env.SUPABASE_URL + "/rest/v1/rpc/has_course", {
    method: "POST",
    headers: { ...anon(env, token), "Content-Type": "application/json" },
    body: JSON.stringify({ course }),
  });
  if (!res.ok) return null;
  return (await res.json()) === true;
}
